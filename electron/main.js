const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage } = require('electron');
const { createServer } = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Server } = require('socket.io');

let mainWindow;
let chatServer;
let tray;
let isQuitting = false;

if (process.platform === 'win32') {
  app.setAppUserModelId('com.wirechat.app');
}
app.setName('WireChat');

function getDeviceIdFilePath() {
  return path.join(app.getPath('userData'), 'device-id.json');
}

function getSessionStateFilePath() {
  return path.join(app.getPath('userData'), 'wirechat-session.json');
}

function getOrCreateDeviceId() {
  const filePath = getDeviceIdFilePath();

  try {
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof existing?.deviceId === 'string' && existing.deviceId.trim()) {
      return existing.deviceId;
    }
  } catch {}

  const deviceId = crypto.randomUUID();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ deviceId }, null, 2), 'utf8');
  return deviceId;
}

function getInitialSession() {
  return {
    groups: [
      {
        id: 'g1',
        name: 'General',
        description: 'Team updates',
        color: 'blue',
        unread: 0,
        memberIds: [],
      },
    ],
    messagesByGroup: {
      g1: [],
    },
    directMessagesByThread: {},
    users: [],
  };
}

function loadPersistedSession() {
  const filePath = getSessionStateFilePath();

  try {
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!persisted || typeof persisted !== 'object') {
      return getInitialSession();
    }

    return {
      ...getInitialSession(),
      ...persisted,
      users: Array.isArray(persisted.users)
        ? persisted.users.map((user) => ({
            ...user,
            presence: 'offline',
            status: 'Offline',
            socketId: null,
          }))
        : [],
    };
  } catch {
    return getInitialSession();
  }
}

function persistSession(session) {
  const filePath = getSessionStateFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        groups: session.groups,
        messagesByGroup: session.messagesByGroup,
        directMessagesByThread: session.directMessagesByThread,
        users: session.users.map(({ socketId, ...user }) => user),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function getInitials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getLanAddress() {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }

  return '127.0.0.1';
}

function getAppIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'logo.ico');
  }

  return path.join(__dirname, '..', 'public', 'logo.ico');
}

function getAttachmentStorePath() {
  return path.join(app.getPath('userData'), 'attachments');
}

function sanitizeAttachmentName(name) {
  return path
    .basename(`${name ?? ''}`.trim())
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 180) || 'file';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function readAttachmentMeta(attachmentsDir, attachmentId) {
  const metaPath = path.join(attachmentsDir, `${attachmentId}.json`);
  const dataPath = path.join(attachmentsDir, `${attachmentId}.bin`);

  if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) {
    return null;
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return {
      ...meta,
      dataPath,
    };
  } catch {
    return null;
  }
}

function handleAttachmentUpload(req, res) {
  if (!chatServer?.attachmentsDir) {
    sendJson(res, 503, { message: 'Attachment service is not ready.' });
    return;
  }

  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  const name = sanitizeAttachmentName(requestUrl.searchParams.get('name') || 'file');
  const type = `${requestUrl.searchParams.get('type') ?? 'application/octet-stream'}`.trim() ||
    'application/octet-stream';

  const attachmentId = crypto.randomUUID();
  const dataPath = path.join(chatServer.attachmentsDir, `${attachmentId}.bin`);
  const metaPath = path.join(chatServer.attachmentsDir, `${attachmentId}.json`);
  const output = fs.createWriteStream(dataPath);
  let totalBytes = 0;
  let settled = false;

  function fail(statusCode, message) {
    if (settled) return;
    settled = true;
    output.destroy();
    fs.rm(dataPath, { force: true }, () => {});
    fs.rm(metaPath, { force: true }, () => {});
    sendJson(res, statusCode, { message });
  }

  req.on('data', (chunk) => {
    totalBytes += chunk.length;
  });

  req.on('aborted', () => {
    fail(499, 'Upload aborted.');
  });

  output.on('error', () => {
    fail(500, 'Unable to store attachment.');
  });

  output.on('finish', () => {
    if (settled) return;
    settled = true;

    const attachment = {
      id: attachmentId,
      name,
      size: totalBytes,
      type,
    };

    fs.writeFileSync(metaPath, JSON.stringify(attachment, null, 2), 'utf8');
    sendJson(res, 201, attachment);
  });

  req.pipe(output);
}

function handleAttachmentDownload(req, res, attachmentId) {
  if (!chatServer?.attachmentsDir) {
    sendJson(res, 503, { message: 'Attachment service is not ready.' });
    return;
  }

  const attachment = readAttachmentMeta(chatServer.attachmentsDir, attachmentId);
  if (!attachment) {
    sendJson(res, 404, { message: 'Attachment not found.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': attachment.type || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${attachment.name.replace(/"/g, '\\"')}"`,
    'Content-Length': attachment.size,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });

  fs.createReadStream(attachment.dataPath).pipe(res);
}

function handleHttpRequest(req, res) {
  const requestUrl = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/attachments') {
    handleAttachmentUpload(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname.startsWith('/attachments/')) {
    const attachmentId = decodeURIComponent(requestUrl.pathname.slice('/attachments/'.length));
    if (!attachmentId) {
      sendJson(res, 400, { message: 'Attachment id is required.' });
      return;
    }

    handleAttachmentDownload(req, res, attachmentId);
    return;
  }

  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('Not found');
}

function showNativeNotification({ title, body }) {
  if (!title || !body) {
    return false;
  }

  const notification = new Notification({
    title,
    body,
    icon: getAppIconPath(),
  });

  notification.show();
  return true;
}

function createSnapshot(session) {
  return {
    groups: session.groups,
    messagesByGroup: session.messagesByGroup,
    directMessagesByThread: session.directMessagesByThread,
    users: session.users,
  };
}

function ensureGroupMembership(session) {
  const userIds = new Set(session.users.map((user) => user.id));
  session.groups = session.groups.map((group) => ({
    ...group,
    memberIds: group.memberIds.filter((memberId) => userIds.has(memberId)),
  }));
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== 'object') {
        return null;
      }

      const name = `${attachment.name ?? ''}`.trim();
      const dataUrl = `${attachment.dataUrl ?? ''}`.trim();
      const id = `${attachment.id ?? attachment.attachmentId ?? ''}`.trim();

      if (!name || (!id && !dataUrl)) {
        return null;
      }

      return {
        id: id || crypto.randomUUID(),
        name,
        size: Number.isFinite(attachment.size) ? attachment.size : 0,
        type: `${attachment.type ?? 'application/octet-stream'}`,
        ...(dataUrl ? { dataUrl } : {}),
      };
    })
    .filter(Boolean);
}

function normalizeReplyTo(replyTo) {
  if (!replyTo || typeof replyTo !== 'object') {
    return null;
  }

  const messageId = `${replyTo.messageId ?? ''}`.trim();
  const author = `${replyTo.author ?? ''}`.trim();

  if (!messageId || !author) {
    return null;
  }

  return {
    messageId,
    author,
    body: `${replyTo.body ?? ''}`.trim(),
    attachmentCount: Number.isFinite(replyTo.attachmentCount) ? replyTo.attachmentCount : 0,
    attachmentName: `${replyTo.attachmentName ?? ''}`.trim(),
  };
}

function getDirectThreadId(userIdA, userIdB) {
  return [userIdA, userIdB].map((value) => `${value ?? ''}`.trim()).sort().join('::');
}

function canDeleteMessage(requestingUser, message) {
  return Boolean(requestingUser?.id && message?.userId && requestingUser.id === message.userId);
}

function broadcastSession() {
  if (!chatServer) return;
  ensureGroupMembership(chatServer.session);
  persistSession(chatServer.session);
  chatServer.io.emit('session:update', createSnapshot(chatServer.session));
}

async function stopChatServer() {
  if (!chatServer) return;

  const activeServer = chatServer;
  chatServer = null;

  await new Promise((resolve) => activeServer.io.close(resolve));
  await new Promise((resolve, reject) =>
    activeServer.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}

async function startChatServer(port) {
  if (chatServer?.port === port) {
    return {
      address: chatServer.address,
      port: chatServer.port,
    };
  }

  await stopChatServer();

  const httpServer = createServer((req, res) => {
    handleHttpRequest(req, res);
  });
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const session = loadPersistedSession();
  const attachmentsDir = getAttachmentStorePath();
  fs.mkdirSync(attachmentsDir, { recursive: true });

  io.on('connection', (socket) => {
    socket.on('session:join', ({ name, deviceId }) => {
      const trimmedName = `${name ?? ''}`.trim();
      const normalizedDeviceId = `${deviceId ?? ''}`.trim();
      if (!trimmedName) {
        socket.emit('session:error', { message: 'Name is required.' });
        return;
      }
      if (!normalizedDeviceId) {
        socket.emit('session:error', { message: 'Device ID is required.' });
        return;
      }

      const existingUser = session.users.find((user) => user.id === normalizedDeviceId);
      const isHost = !existingUser && session.users.length === 0;
      const user = existingUser
        ? {
            ...existingUser,
            name: trimmedName,
            initials: getInitials(trimmedName),
            presence: 'available',
            status: 'Available',
            socketId: socket.id,
            isHost: Boolean(existingUser.isHost),
          }
        : {
            id: normalizedDeviceId,
            socketId: socket.id,
            name: trimmedName,
            initials: getInitials(trimmedName),
            presence: 'available',
            status: 'Available',
            isHost,
          };

      socket.data.userId = normalizedDeviceId;
      socket.data.socketId = socket.id;
      if (existingUser) {
        session.users = session.users.map((entry) => (entry.id === normalizedDeviceId ? user : entry));
      } else {
        session.users.push(user);
      }
      session.groups = session.groups.map((group) => ({
        ...group,
        memberIds: Array.from(new Set([...group.memberIds, normalizedDeviceId])),
      }));

      socket.emit('session:joined', {
        profile: {
          id: user.id,
          name: user.name,
          initials: user.initials,
          mode: user.isHost ? 'Hosting' : 'Joined',
          deviceId: user.id,
          isHost: Boolean(user.isHost),
        },
        session: createSnapshot(session),
      });

      broadcastSession();
    });

    socket.on('group:create', ({ name, description }) => {
      socket.emit('group:error', { message: 'Use group:upsert for create or update.' });
    });

    socket.on('group:upsert', ({ groupId, name, description, memberIds }) => {
      const userId = socket.data.userId;
      const requestingUser = session.users.find((user) => user.id === userId);
      if (!requestingUser?.isHost) {
        socket.emit('group:error', { message: 'Only the host can manage groups.' });
        return;
      }

      const trimmedName = `${name ?? ''}`.trim();
      if (!trimmedName) return;

      const normalizedMemberIds = Array.from(
        new Set(
          (Array.isArray(memberIds) ? memberIds : [])
            .map((memberId) => `${memberId ?? ''}`.trim())
            .filter((memberId) => session.users.some((user) => user.id === memberId)),
        ),
      );

      if (groupId) {
        const existingGroup = session.groups.find((group) => group.id === groupId);
        if (!existingGroup) return;

        session.groups = session.groups.map((group) =>
          group.id === groupId
            ? {
                ...group,
                name: trimmedName,
                description: `${description ?? ''}`.trim() || 'New group',
                memberIds: normalizedMemberIds,
              }
            : group,
        );
        broadcastSession();
        return;
      }

      const group = {
        id: crypto.randomUUID(),
        name: trimmedName,
        description: `${description ?? ''}`.trim() || 'New group',
        color: 'amber',
        unread: 0,
        memberIds: normalizedMemberIds.length > 0 ? normalizedMemberIds : session.users.map((user) => user.id),
      };

      session.groups.push(group);
      session.messagesByGroup[group.id] = [];
      broadcastSession();
    });

    socket.on('group:delete', ({ groupId }) => {
      const userId = socket.data.userId;
      const requestingUser = session.users.find((user) => user.id === userId);
      if (!requestingUser?.isHost) {
        socket.emit('group:error', { message: 'Only the host can manage groups.' });
        return;
      }

      const normalizedGroupId = `${groupId ?? ''}`.trim();
      if (!normalizedGroupId || normalizedGroupId === 'g1') return;

      session.groups = session.groups.filter((group) => group.id !== normalizedGroupId);
      delete session.messagesByGroup[normalizedGroupId];
      broadcastSession();
    });

    socket.on('message:send', ({ groupId, body, attachments, replyTo, clientMessageId }) => {
      const userId = socket.data.userId;
      if (!userId || !groupId) return;

      const author = session.users.find((user) => user.id === userId);
      if (!author) return;

      const nextBody = `${body ?? ''}`.trim();
      const nextAttachments = normalizeAttachments(attachments);
      const nextReplyTo = normalizeReplyTo(replyTo);
      if (!nextBody && nextAttachments.length === 0) return;

      const message = {
        id: crypto.randomUUID(),
        clientMessageId: `${clientMessageId ?? ''}`.trim() || undefined,
        author: author.name,
        time: new Intl.DateTimeFormat('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date()),
        body: nextBody,
        attachments: nextAttachments,
        replyTo: nextReplyTo,
        userId: author.id,
        isOwn: false,
      };

      session.messagesByGroup[groupId] = [...(session.messagesByGroup[groupId] ?? []), message];
      broadcastSession();
    });

    socket.on('message:delete', ({ groupId, recipientId, messageId }) => {
      const userId = socket.data.userId;
      const requestingUser = session.users.find((user) => user.id === userId);
      const normalizedMessageId = `${messageId ?? ''}`.trim();
      if (!requestingUser || !normalizedMessageId) return;

      if (groupId) {
        const normalizedGroupId = `${groupId ?? ''}`.trim();
        const groupMessages = session.messagesByGroup[normalizedGroupId] ?? [];
        const targetMessage = groupMessages.find((message) => message.id === normalizedMessageId);
        if (!targetMessage || !canDeleteMessage(requestingUser, targetMessage)) return;

        session.messagesByGroup[normalizedGroupId] = groupMessages.filter(
          (message) => message.id !== normalizedMessageId,
        );
        broadcastSession();
        return;
      }

      const normalizedRecipientId = `${recipientId ?? ''}`.trim();
      if (!normalizedRecipientId) return;

      const threadId = getDirectThreadId(requestingUser.id, normalizedRecipientId);
      const threadMessages = session.directMessagesByThread[threadId] ?? [];
      const targetMessage = threadMessages.find((message) => message.id === normalizedMessageId);
      if (!targetMessage || !canDeleteMessage(requestingUser, targetMessage)) return;

      session.directMessagesByThread[threadId] = threadMessages.filter(
        (message) => message.id !== normalizedMessageId,
      );
      broadcastSession();
    });

    socket.on('messages:clear', ({ groupId, recipientId }) => {
      const userId = socket.data.userId;
      const requestingUser = session.users.find((user) => user.id === userId);
      if (!requestingUser) return;

      if (groupId) {
        const normalizedGroupId = `${groupId ?? ''}`.trim();
        if (!normalizedGroupId) return;

        const targetGroup = session.groups.find((group) => group.id === normalizedGroupId);
        if (!targetGroup || (!requestingUser.isHost && !targetGroup.memberIds.includes(requestingUser.id))) {
          return;
        }

        session.messagesByGroup[normalizedGroupId] = [];
        broadcastSession();
        return;
      }

      const normalizedRecipientId = `${recipientId ?? ''}`.trim();
      if (!normalizedRecipientId) return;

      const threadId = getDirectThreadId(requestingUser.id, normalizedRecipientId);
      session.directMessagesByThread[threadId] = [];
      broadcastSession();
    });

    socket.on('direct:send', ({ recipientId, body, attachments, replyTo, clientMessageId }) => {
      const senderId = socket.data.userId;
      const normalizedRecipientId = `${recipientId ?? ''}`.trim();
      if (!senderId || !normalizedRecipientId || normalizedRecipientId === senderId) return;

      const sender = session.users.find((user) => user.id === senderId);
      const recipient = session.users.find((user) => user.id === normalizedRecipientId);
      if (!sender || !recipient) return;

      const nextBody = `${body ?? ''}`.trim();
      const nextAttachments = normalizeAttachments(attachments);
      const nextReplyTo = normalizeReplyTo(replyTo);
      if (!nextBody && nextAttachments.length === 0) return;

      const threadId = getDirectThreadId(sender.id, recipient.id);
      const message = {
        id: crypto.randomUUID(),
        clientMessageId: `${clientMessageId ?? ''}`.trim() || undefined,
        author: sender.name,
        time: new Intl.DateTimeFormat('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date()),
        body: nextBody,
        attachments: nextAttachments,
        replyTo: nextReplyTo,
        userId: sender.id,
        recipientId: recipient.id,
        threadId,
        isOwn: false,
      };

      session.directMessagesByThread[threadId] = [...(session.directMessagesByThread[threadId] ?? []), message];
      broadcastSession();
    });

    socket.on('disconnect', () => {
      const userId = socket.data.userId;
      if (!userId) return;

      session.users = session.users.map((user) =>
        user.id === userId && user.socketId === socket.id
          ? {
              ...user,
              presence: 'offline',
              status: 'Offline',
              socketId: null,
            }
          : user,
      );
      broadcastSession();
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  chatServer = {
    httpServer,
    io,
    port,
    address: getLanAddress(),
    session,
    attachmentsDir,
  };

  return {
    address: chatServer.address,
    port: chatServer.port,
  };
}

function createWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    icon: getAppIconPath(),
    backgroundColor: '#F3F3F3',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = 'http://127.0.0.1:5174';

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(devServerUrl);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('minimize', (event) => {
    if (isQuitting) return;

    event.preventDefault();
    mainWindow.hide();
  });

  return mainWindow;
}

function createTray() {
  if (tray) return tray;

  const trayImage = nativeImage.createFromPath(getAppIconPath());

  tray = new Tray(trayImage);
  tray.setToolTip('WireChat');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open WireChat',
        click: () => {
          const win = createWindow();
          win.show();
          win.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );

  tray.on('double-click', () => {
    const win = createWindow();
    win.show();
    win.focus();
  });

  return tray;
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      path: app.getPath('exe'),
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createTray();
    } else {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray.
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('chat:start-host', async (_, { port }) => {
  const parsedPort = Number.parseInt(port, 10);

  if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
    throw new Error('Choose a port between 1024 and 65535.');
  }

  return startChatServer(parsedPort);
});

ipcMain.handle('chat:get-device-id', () => ({
  deviceId: getOrCreateDeviceId(),
}));

ipcMain.handle('notification:show', (_, payload = {}) => showNativeNotification(payload));

app.on('before-quit', () => {
  isQuitting = true;
  tray?.destroy();
  tray = null;
  if (chatServer) {
    chatServer.io.close();
    chatServer.httpServer.close();
    chatServer = null;
  }
});
