param(
    [string]$AgeExecutable = (Join-Path $env:USERPROFILE '.codex/tools/age/v1.3.2/windows/age/age.exe')
)
$ErrorActionPreference = 'Stop'
$keygen = Join-Path (Split-Path -Parent $AgeExecutable) 'age-keygen.exe'
if ((Get-FileHash -LiteralPath $AgeExecutable -Algorithm SHA256).Hash -ne '2821a4ed191da07372acd302e5f6feae7a7985e285e1417765ebe74025af45f0' -or
    (Get-FileHash -LiteralPath $keygen -Algorithm SHA256).Hash -ne '1549c7049be32695594bedd09bbd352a94b6013a9d5c43364f3c6cd7a09ab61c') {
    throw 'Synthetic tests require the reviewed Windows age 1.3.2 binaries'
}
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('schoolbus-owner-fixture-' + [guid]::NewGuid().ToString('N'))
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$privateAcl = New-Object Security.AccessControl.DirectorySecurity
$privateAcl.SetAccessRuleProtection($true, $false)
$privateAcl.SetOwner($ownerSid)
foreach ($sid in @($ownerSid, $systemSid)) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $privateAcl.AddAccessRule($rule)
}
[void][IO.Directory]::CreateDirectory($fixtureRoot, $privateAcl)
$results = @()
function Invoke-FixtureTool([string]$Executable, [string]$Arguments) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.Arguments = $Arguments
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    $started = $false
    try {
        $started = $process.Start()
        if (-not $started) { throw 'Synthetic tool did not start' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000) -or $process.ExitCode -ne 0) {
            throw 'Synthetic tool failed'
        }
        [void]$stderr.GetAwaiter().GetResult()
        return $stdout.GetAwaiter().GetResult()
    } finally {
        if ($started -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
        $process.Dispose()
    }
}
try {
    $identity = Join-Path $fixtureRoot 'synthetic-identity.txt'
    $wrong = Join-Path $fixtureRoot 'synthetic-wrong-identity.txt'
    # Windows age may warn about Unix file mode even with a private Windows
    # ACL. Capture stderr as data; the verifier checks the actual Windows ACL.
    [void](Invoke-FixtureTool $keygen ('-o "' + $identity + '"'))
    [void](Invoke-FixtureTool $keygen ('-o "' + $wrong + '"'))
    $recipient = (Invoke-FixtureTool $keygen ('-y "' + $identity + '"')).Trim()
    $plain = Join-Path $fixtureRoot 'synthetic-input.txt'
    [IO.File]::WriteAllBytes($plain, [Text.Encoding]::UTF8.GetBytes('SYNTHETIC ONLY: owner stream fixture'))
    $cipher = Join-Path $fixtureRoot 'synthetic.age'
    [void](Invoke-FixtureTool $AgeExecutable ('-r ' + $recipient + ' -o "' + $cipher + '" "' + $plain + '"'))
    $plainSha = (Get-FileHash -LiteralPath $plain -Algorithm SHA256).Hash
    $cipherSha = (Get-FileHash -LiteralPath $cipher -Algorithm SHA256).Hash
    $verifier = Join-Path $PSScriptRoot 'verify-encrypted-backup-owner.ps1'
    function Check-Case([string]$Name, [string]$CipherFile, [string]$IdentityFile, [string]$PlainHash, [string]$CipherHash, [bool]$ExpectedSuccess) {
        $filesBefore = @(Get-ChildItem -LiteralPath $fixtureRoot -File | ForEach-Object Name)
        $reply = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $verifier -CipherPath $CipherFile -IdentityPath $IdentityFile -ExpectedPlainSha256 $PlainHash -ExpectedCipherSha256 $CipherHash -AgeExecutable $AgeExecutable
        $exitCode = $LASTEXITCODE
        $parsed = $reply | ConvertFrom-Json
        if (($exitCode -eq 0) -ne $ExpectedSuccess -or $parsed.plaintext_written_to_disk -ne $false) {
            throw ('Owner verifier did not satisfy synthetic case: ' + $Name)
        }
        if ($ExpectedSuccess -and $parsed.authenticated_decryption_verified -ne $true) {
            throw 'Authenticated synthetic decryption was not verified'
        }
        $filesAfter = @(Get-ChildItem -LiteralPath $fixtureRoot -File | ForEach-Object Name)
        if (Compare-Object $filesBefore $filesAfter) { throw 'Verifier created an unexpected file' }
        [PSCustomObject]@{ case=$Name; passed=$true }
    }
    $results += Check-Case 'roundtrip' $cipher $identity $plainSha $cipherSha $true
    $results += Check-Case 'wrong plaintext hash' $cipher $identity ('0' * 64) $cipherSha $false
    $results += Check-Case 'wrong ciphertext hash' $cipher $identity $plainSha ('0' * 64) $false
    $results += Check-Case 'wrong identity' $cipher $wrong $plainSha $cipherSha $false
    $broken = Join-Path $fixtureRoot 'synthetic-broken.age'
    $body = [IO.File]::ReadAllBytes($cipher)
    $body[$body.Length - 12] = $body[$body.Length - 12] -bxor 1
    [IO.File]::WriteAllBytes($broken, $body)
    $brokenSha = (Get-FileHash -LiteralPath $broken -Algorithm SHA256).Hash
    $results += Check-Case 'tamper with matching ciphertext hash' $broken $identity $plainSha $brokenSha $false
    $broadAcl = Get-Acl -LiteralPath $identity
    $everyoneSid = New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
    $broadAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($everyoneSid, 'Read', 'Allow')))
    Set-Acl -LiteralPath $identity -AclObject $broadAcl
    $results += Check-Case 'broad identity permissions' $cipher $identity $plainSha $cipherSha $false
    $results | ConvertTo-Json -Compress
} finally {
    # Delete only this newly created, private fixture within the OS temp folder.
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedFixture) -notmatch '^schoolbus-owner-fixture-[0-9a-f]{32}$') {
        throw 'Refused cleanup outside the synthetic fixture directory'
    }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
