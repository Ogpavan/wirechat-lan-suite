# Security Policy

WireChat includes screen sharing, remote control, LAN file transfer, local persistence, and LAN-hosted updates. Please treat security reports carefully.

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| < 0.2.0 | No |

## Reporting A Vulnerability

Do not open a public issue with exploit details, remote-control bypass steps, file traversal payloads, or update-chain attack details.

Preferred reporting paths:

1. Use GitHub private vulnerability reporting if it is enabled for the repository.
2. Contact the repository owner through their GitHub profile.
3. If no private channel is available, open a minimal public issue labeled `security` that says a private report is needed. Do not include reproduction details publicly.

Please include:

- Affected version or commit.
- Operating system and network setup.
- Whether the issue requires same-LAN access.
- Clear impact statement.
- Minimal reproduction details in a private channel.
- Suggested fix, if known.

## Security Scope

In scope:

- Remote-control permission bypass.
- Screen-sharing consent bypass.
- IPC exposure between renderer and Electron main process.
- Attachment upload or download path traversal.
- Unsafe content type handling for attachments.
- LAN update tampering or unsafe update file serving.
- Unauthorized access to local session files or attachment storage.
- Denial of service from malformed LAN messages.

Out of scope:

- Reports requiring physical access to an unlocked machine.
- Social engineering a user to install a modified build.
- Issues only present in unsupported versions.
- Generic dependency reports without a practical WireChat impact.

## Safety Expectations

- WireChat is intended for trusted LAN environments, not public internet exposure.
- Remote control must remain explicit, permission-based, and visible to the controlled user.
- Screen sharing must require user action and must be stoppable by the sharing user.
- File storage and update serving must not allow access outside the intended WireChat data folders.
- The app should fail closed when remote-control helper startup, IPC validation, or update validation fails.

## Disclosure

After a fix is available, the project may publish a short security note with affected versions, impact, and upgrade guidance. Reporter credit can be included if requested.
