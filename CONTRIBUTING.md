# Contributing to WireChat

Thanks for helping improve WireChat. This project is a LAN-first desktop collaboration app, so changes should keep reliability, local-network behavior, and user consent in mind.

## Good First Setup

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run electron:dev
```

Build the renderer:

```bash
npm run build
```

Create a Windows installer:

```bash
npm run dist:win
```

## What To Work On

Good contribution areas:

- UI polish for the chat, file sharing, and screen-sharing flows.
- Better onboarding for host and join setup.
- Documentation, screenshots, and release notes.
- Security hardening around remote control, file serving, update delivery, and LAN exposure.
- Small bugs with clear reproduction steps.

## Pull Request Checklist

Before opening a pull request:

- Run `npm run build`.
- Keep changes focused on one feature or fix.
- Update README or docs when behavior changes.
- Avoid committing generated installers, `dist/`, `win-unpacked/`, logs, or local config.
- For screen sharing or remote control changes, explain the consent and safety impact.
- For file handling changes, mention how paths, file names, and content types are validated.

## Code Guidelines

- Prefer the existing Electron, React, Fluent UI, and Socket.IO patterns.
- Keep Electron main-process changes small and explicit.
- Treat IPC boundaries as security-sensitive.
- Never trust data from another LAN client without validation.
- Keep remote-control behavior permission-based and visible to the controlled user.
- Do not add a cloud dependency unless the feature still works locally without it.

## Issue Labels

- `good first issue` - small, scoped work suitable for new contributors.
- `help wanted` - useful work where maintainer help is welcome.
- `security` - hardening, review, or vulnerability-related work.
- `documentation` - README, release notes, screenshots, guides, or examples.

## Security Reports

Do not publish exploit details in a public issue. Follow [SECURITY.md](SECURITY.md) for vulnerability reporting.
