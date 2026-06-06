# WireChat LAN Chat

WireChat is a desktop LAN chat application built with Electron, React, Vite, Fluent UI, Socket.IO, and a local persistence layer for sessions and attachments.

It is designed for local network communication, so one machine can host a chat session and other machines on the same LAN can join by IP address and port.

## Features

- Host a chat session on your local network
- Join an existing host using IP address and port
- Group chat and direct messages
- Create, edit, and delete groups as the host
- Reply to messages
- Send file attachments
- Download attachments from messages
- Native Windows notifications for new messages
- Tray support with minimize-to-tray behavior
- Session persistence across restarts
- Saved login details with auto-reconnect

## Tech Stack

- Electron
- React 19
- Vite
- Fluent UI
- Socket.IO
- Node.js HTTP server

## Requirements

- Node.js 18 or newer
- npm
- Windows for the packaged desktop build

## Getting Started

Install dependencies:

```bash
npm install
```

Run the Vite dev server:

```bash
npm run dev
```

Run the desktop app with Electron during development:

```bash
npm run electron:dev
```

## Hosting a Chat Session

1. Open WireChat on the machine that will act as the host.
2. Enter a display name and a port.
3. Select **Start Host**.
4. Share the host machine's LAN IP address and port with other users.

## Joining a Chat Session

1. Open WireChat on another machine connected to the same network.
2. Enter a display name.
3. Enter the host IP address and port.
4. Select **Join Host**.

## Build for Windows

Create the production build:

```bash
npm run build
```

Create a Windows installer:

```bash
npm run dist:win
```

The installer target is configured through `electron-builder`.

## LAN Auto Updates

WireChat checks for updates from the connected LAN host at:

```text
http://<host-ip>:<port>/updates/
```

On the host machine, place the release files in the WireChat user data update folder:

```text
%APPDATA%\WireChat\wirechat-updates
```

For each release, copy these generated files into that folder:

```text
latest.yml
WireChat-Setup-<version>.exe
WireChat-Setup-<version>.exe.blockmap
```

Then bump `version` in `package.json`, build the new installer, and replace the files in the host update folder. Connected packaged apps check automatically and show update state in the titlebar.

## Project Structure

- `src/` - React UI
- `src/components/` - chat layout, sidebar, dialogs, and message UI
- `electron/` - Electron main process and preload bridge
- `public/` - app icons and static assets
- `dist/` - production web build output

## Notes

- The app stores a local device ID and session state in the Electron user data directory.
- Attachments are served from the local host session, not from a cloud backend.
- The app is intended for LAN use, not public internet exposure.

## License

No license has been defined yet.
