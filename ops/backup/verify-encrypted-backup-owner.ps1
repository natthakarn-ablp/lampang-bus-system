param(
    [Parameter(Mandatory=$true)][string]$CipherPath,
    [Parameter(Mandatory=$true)][string]$IdentityPath,
    [Parameter(Mandatory=$true)][string]$ExpectedPlainSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedCipherSha256,
    [string]$AgeExecutable = (Join-Path $env:USERPROFILE '.codex/tools/age/v1.3.2/windows/age/age.exe')
)
$ErrorActionPreference = 'Stop'
$ageExe = $AgeExecutable
$child = $null
$childStarted = $false
$sha = $null
try {
    if ((Get-FileHash -LiteralPath $ageExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne '2821a4ed191da07372acd302e5f6feae7a7985e285e1417765ebe74025af45f0') {
        throw 'Reviewed age executable changed'
    }
    if ($ExpectedPlainSha256 -notmatch '^[0-9a-fA-F]{64}$' -or $ExpectedCipherSha256 -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'Trusted expected digests are required'
    }
    $cipher = Get-Item -LiteralPath $CipherPath
    $identity = Get-Item -LiteralPath $IdentityPath
    foreach ($item in @($cipher, $identity)) {
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Regular files are required'
        }
    }
    $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($entry in (Get-Acl -LiteralPath $identity.FullName).Access) {
        if ($entry.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {
            $sid = $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($sid -ne $ownerSid -and $sid -ne 'S-1-5-18') {
                throw 'Identity key has broad access permissions'
            }
        }
    }
    if ((Get-FileHash -LiteralPath $cipher.FullName -Algorithm SHA256).Hash -ne $ExpectedCipherSha256) {
        throw 'Ciphertext digest mismatch'
    }
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $ageExe
    # These are literal Windows file arguments, not a shell command. Quotes are
    # invalid inside Windows filenames; file paths cannot end in a backslash.
    $psi.Arguments = '--decrypt --identity "' + $identity.FullName + '" "' + $cipher.FullName + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $child = New-Object Diagnostics.Process
    $child.StartInfo = $psi
    if (-not $child.Start()) { throw 'Age verifier failed to start' }
    $childStarted = $true
    $errorTask = $child.StandardError.ReadToEndAsync()
    $sha = [Security.Cryptography.SHA256]::Create()
    $buffer = New-Object byte[] 65536
    $stream = $child.StandardOutput.BaseStream
    while ($true) {
        $readTask = $stream.ReadAsync($buffer, 0, $buffer.Length)
        if (-not $readTask.Wait(30000)) { throw 'Decryption read timed out' }
        $count = $readTask.Result
        if ($count -eq 0) { break }
        [void]$sha.TransformBlock($buffer, 0, $count, $null, 0)
    }
    [void]$sha.TransformFinalBlock((New-Object byte[] 0), 0, 0)
    if (-not $child.WaitForExit(30000) -or $child.ExitCode -ne 0) {
        throw 'Decryption/authentication failed'
    }
    [void]$errorTask.GetAwaiter().GetResult()
    $actual = ([BitConverter]::ToString($sha.Hash)).Replace('-', '').ToLowerInvariant()
    if ($actual -ne $ExpectedPlainSha256.ToLowerInvariant()) { throw 'Plaintext archive digest mismatch' }
    [PSCustomObject]@{
        authenticated_decryption_verified = $true
        plaintext_archive_digest_matches = $true
        plaintext_written_to_disk = $false
        whole_server_restore_proven = $false
    } | ConvertTo-Json -Compress
} catch {
    # Never expose age error text, decrypted bytes, or identity contents.
    [PSCustomObject]@{ verification_passed=$false; plaintext_written_to_disk=$false } | ConvertTo-Json -Compress
    exit 1
} finally {
    if ($child) {
        if ($childStarted -and -not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
    if ($sha) { $sha.Dispose() }
}
