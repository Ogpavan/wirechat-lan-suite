# WireChat

<p align="center">
  <a href="https://github.com/Ogpavan/wirechat-lan-suite/releases/latest/download/WireChat-Setup-0.2.0.exe">
    <img src="https://img.shields.io/badge/Download-WireChat%20for%20Windows-2563EB?style=for-the-badge&logo=windows&logoColor=white" alt="Download WireChat for Windows" />
  </a>
  <a href="https://github.com/Ogpavan/wirechat-lan-suite/releases/latest">
    <img src="https://img.shields.io/badge/View-Latest%20Release-111827?style=for-the-badge&logo=github&logoColor=white" alt="View latest WireChat release" />
  </a>
</p>

![WireChat desktop collaboration workspace](public/homepage.png)

**WireChat is a LAN-first desktop collaboration suite for teams that need fast local communication without a cloud server.**

It started as a chat app, but it has grown into a private local-network workspace with group chat, direct messages, file sharing, screen sharing, remote control, native notifications, presence, read receipts, and LAN-hosted updates.

No hosted backend. No account system. One machine hosts, everyone else joins over the same network.

![Electron](https://img.shields.io/badge/Electron-desktop-47848F?style=for-the-badge&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![LAN First](https://img.shields.io/badge/LAN-first-2563EB?style=for-the-badge)
![Windows](https://img.shields.io/badge/Windows-ready-0078D4?style=for-the-badge&logo=windows&logoColor=white)

## Why This Matters

Most team tools assume the internet is always available, accounts are already created, and data can leave the building. WireChat is built for the opposite scenario.

- **Works without cloud** - one local machine hosts the workspace; other machines join over LAN.
- **Useful for schools, labs, and offices** - quick setup for rooms full of machines without account provisioning.
- **Local-only collaboration** - messages, files, and updates stay on the local network.
- **Avoids SaaS dependency** - no hosted backend, no login provider, no external workspace setup.
- **Practical for support** - chat, file transfer, screen sharing, and remote control live in one desktop app.

## Screenshots And Flows

### Host Or Join A LAN Workspace

![WireChat start screen](public/loginpage.png)

Start a host with a display name and port, then share the LAN address with teammates. Joiners use the host address and the same port.

### Chat And File Sharing

![WireChat main workspace](public/homepage.png)

Group chat, direct messages, attachments, image previews, read states, and native notifications run through the LAN host.

### Screen Sharing And Remote Control

Screen sharing is started from a direct conversation. Remote control can be requested only after a screen share is active, and the sharing user can stop control at any time.

```text
User A opens a direct chat
  -> requests screen share
  -> User B accepts
  -> peer screen stream starts
  -> User A requests remote control
  -> User B accepts or rejects
  -> User B can stop sharing or control
```

## Features

- **LAN hosting and joining** - start a workspace on one machine and let others join using IP address and port.
- **Group chat** - create team rooms for departments, projects, classes, or support queues.
- **Direct messages** - talk privately with any connected member.
- **File sharing** - upload, preview, download, and share attachments over the local host.
- **Image previews** - inspect shared images without leaving the conversation.
- **Message replies** - keep context attached to the message you are answering.
- **Read and delivered states** - know whether messages reached and were read by recipients.
- **Typing indicators** - see when someone is actively replying.
- **Presence and avatars** - identify users quickly with online status and emoji avatars.
- **Screen sharing** - request or share a desktop view with another user.
- **Remote control** - request permission to control a shared Windows desktop.
- **Native Windows notifications** - receive system notifications for new messages.
- **Tray behavior** - keep WireChat running quietly in the background.
- **Session persistence** - keep users, groups, messages, and attachments across restarts.
- **Saved login flow** - reconnect faster on the same device.
- **LAN auto updates** - packaged clients can pull updates from the connected LAN host.

## Use Cases

- **IT support on a local network** - message a user, request screen sharing, and help from your desk.
- **Classrooms and computer labs** - let students join one local session without accounts or public links.
- **Small office coordination** - keep internal chat and file exchange inside the building network.
- **Training rooms and workshops** - share files, announcements, and live help across machines.
- **Offline or restricted networks** - collaborate when internet access is blocked, unstable, or not desired.
- **Local release distribution** - host update files from one machine and let packaged clients update over LAN.

## Tech Stack

- Electron
- React 19
- Vite
- Fluent UI
- Socket.IO
- Node.js HTTP service
- electron-builder
- electron-updater

## Architecture

```text
WireChat Desktop App
├─ Electron main process
│  ├─ Creates the desktop window, tray, notifications, and IPC handlers
│  ├─ Starts and supervises the LAN chat service
│  ├─ Handles Windows screen capture permission and update status
│  └─ Runs the remote-control helper when control is explicitly allowed
├─ React renderer
│  ├─ Host/join screen
│  ├─ Chat workspace, groups, direct messages, attachments, and receipts
│  ├─ Screen-share and remote-control UI
│  └─ Update, profile, notification, and connection state
├─ Socket.IO LAN server
│  ├─ Hosts real-time session state on one local machine
│  ├─ Broadcasts users, groups, messages, typing, receipts, and presence
│  └─ Relays screen-share and remote-control signaling between LAN clients
├─ File storage
│  ├─ Stores uploaded attachments on the host machine
│  ├─ Serves attachment downloads over the host LAN HTTP service
│  └─ Persists sessions, groups, users, read state, and attachment metadata
├─ Remote-control helper
│  ├─ Windows PowerShell helper launched by Electron only when needed
│  ├─ Receives normalized pointer and keyboard input
│  └─ Stops when remote control ends or the app exits
└─ Updater flow
   ├─ Windows installer is built with electron-builder
   ├─ Host serves latest.yml, installer, and blockmap from the update folder
   ├─ Clients check http://<host-ip>:<port>/updates/
   └─ electron-updater downloads and installs the LAN-hosted release
```

## Requirements

- Node.js 18 or newer
- npm
- Windows for the packaged desktop build and remote-control helper
- All users must be on the same LAN or reachable private network

## Quick Start

Install dependencies:

```bash
npm install
```

Run the Electron app in development:

```bash
npm run electron:dev
```

Build the web app:

```bash
npm run build
```

Create a Windows installer:

```bash
npm run dist:win
```

## How To Use

### Start A Host

1. Open WireChat on the machine that will host the workspace.
2. Enter your display name.
3. Choose a port, for example `3001`.
4. Click **Start Host**.
5. Share the host IP address and port with other users on the same LAN.

### Join A Host

1. Open WireChat on another machine connected to the same network.
2. Enter your display name.
3. Enter the host address, for example `192.168.1.120`.
4. Enter the same port used by the host.
5. Click **Join Host**.

### Share Files

1. Open a group or direct message.
2. Click the attachment button near the message composer.
3. Select one or more files.
4. Send the message.
5. Other users can preview supported images or download the file.

### Share Screen Or Request Control

1. Open a direct conversation with a connected member.
2. Start or request screen sharing from the conversation toolbar.
3. The other user accepts the request.
4. For remote control, request control after the screen share is active.
5. The controlled user can stop control at any time.

## LAN Auto Updates

WireChat can serve packaged Windows updates from the LAN host. Connected packaged clients check:

```text
http://<host-ip>:<port>/updates/
```

On the host machine, place generated release files in:

```text
%APPDATA%\WireChat\wirechat-updates
```

For each release, copy:

```text
latest.yml
WireChat-Setup-<version>.exe
WireChat-Setup-<version>.exe.blockmap
```

Then bump `version` in `package.json`, build the new installer, and replace the files in the host update folder. Connected packaged apps show update status in the title bar and can install after download.

## Project Structure

```text
src/                 React UI
src/components/      Chat layout, dialogs, sidebars, messages, avatars
electron/            Electron main process, preload bridge, LAN service, helpers
public/              Icons, screenshots, and static assets
dist/                Production web build output
```

## GitHub Metadata

Recommended repository description:

```text
LAN-first desktop collaboration suite with chat, file sharing, screen sharing, remote control, and local updates.
```

Recommended topics:

```text
electron, react, socket-io, lan-chat, screen-sharing, remote-control, offline-first, windows, collaboration-tool
```

Issue templates are included for `good first issue`, `help wanted`, `security`, and `documentation` workflows.

## Security Notes

- WireChat is designed for trusted LAN environments, not public internet exposure.
- Remote control is permission-based and intended for Windows desktop support scenarios.
- Attachments are stored and served by the local host machine.
- There is no cloud sync, hosted database, or external account provider.

## Roadmap Ideas

- Installer download page for LAN users.
- Admin controls for room permissions.
- Better release notes inside the updater.
- Optional encrypted local message storage.
- Portable build for quick lab deployment.

## License

MIT License. See [LICENSE](LICENSE) for details.
