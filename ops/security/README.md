# Restricted maintenance access

Owner approved the end-to-end hardening workflow on 13 October 2026.

Install schoolbus-ops as root-owned 0755 under /usr/local/sbin. Its parent
directory and every executable it calls must be root-owned and unwritable by
schoolbus. Do not allow it to execute application scripts: those are writable
by schoolbus and would restore arbitrary root execution.

Validate the sudoers file with visudo before installing it as
/etc/sudoers.d/90-schoolbus-codex, mode 0440. The user's normal password-based
sudo rights remain available for owner-controlled administration.

Validate and reload SSH configuration before replacing the broad sudo policy.
Keep an existing SSH session open, verify a separate key-only login succeeds,
and only then remove NOPASSWD: ALL. Preserve the previous files in a protected
backup directory. Key changes never require sending a private key or password
through chat.

Allowed unattended actions: nginx-test, nginx-reload, service-status.
Unknown actions and extra arguments are rejected. Routine PM2, backend deploy
and application backup commands run as schoolbus and need no root privileges.

Recovery: an owner with password sudo or a separate administrator can restore
the saved sudoers/SSH files, validate with visudo and sshd -t, then reload ssh.
Do not relax the policy as an automatic response to a denied command.
