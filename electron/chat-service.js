const { createServer } = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Server } = require('socket.io');

const userDataDir = process.env.WIRECHAT_USER_DATA_DIR;

if (!userDataDir) {
  throw new Error('WIRECHAT_USER_DATA_DIR is required.');
}

const updateDir = process.env.WIRECHAT_UPDATE_DIR || path.join(userDataDir, 'wirechat-updates');

const AVATAR_EMOJIS = [
  '😀',
  '😎',
  '🙂',
  '😊',
  '😌',
  '🤓',
  '😺',
  '🫠',
  '😇',
  '🤠',
  '🦊',
  '🐼',
];

function getSessionStateFilePath() {
  return path.join(userDataDir, 'wirechat-session.json');
}

function getServiceStatusFilePath() {
  return path.join(userDataDir, 'wirechat-service.json');
}

function hashString(value) {
  return `${value ?? ''}`.split('').reduce((hash, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return ((hash << 5) - hash + codePoint) | 0;
  }, 0);
}

function getDefaultAvatarEmoji(seed) {
  const index = Math.abs(hashString(seed)) % AVATAR_EMOJIS.length;
  return AVATAR_EMOJIS[index];
}

function normalizeAvatarEmoji(avatarEmoji, seed) {
  const trimmed = `${avatarEmoji ?? ''}`.trim();
  if (trimmed) {
    return trimmed;
  }

  return getDefaultAvatarEmoji(seed);
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
    readState: {
      groups: {},
      threads: {},
    },
    users: [],
  };
}

function normalizeMessageTimestamps(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const baseTimestamp = Date.now() - messages.length * 1000;

  return messages.map((message, index) => ({
    ...message,
    createdAt: Number.isFinite(message?.createdAt) ? message.createdAt : baseTimestamp + index * 1000,
    deliveredTo:
      message?.deliveredTo && typeof message.deliveredTo === 'object' ? message.deliveredTo : {},
  }));
}

function getLatestMessageTimestamp(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 0;
  }

  return messages.reduce((latest, message) => Math.max(latest, Number(message?.createdAt) || 0), 0);
}

function ensureReadState(session) {
  if (!session.readState || typeof session.readState !== 'object') {
    session.readState = {
      groups: {},
      threads: {},
    };
  }

  if (!session.readState.groups || typeof session.readState.groups !== 'object') {
    session.readState.groups = {};
  }

  if (!session.readState.threads || typeof session.readState.threads !== 'object') {
    session.readState.threads = {};
  }

  session.groups.forEach((group) => {
    if (!group?.id) return;

    session.readState.groups[group.id] = session.readState.groups[group.id] ?? {};
  });

  Object.entries(session.directMessagesByThread ?? {}).forEach(([threadId]) => {
    session.readState.threads[threadId] = session.readState.threads[threadId] ?? {};
  });
}

function loadPersistedSession() {
  const filePath = getSessionStateFilePath();

  try {
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!persisted || typeof persisted !== 'object') {
      return getInitialSession();
    }

    const session = {
      ...getInitialSession(),
      ...persisted,
      users: Array.isArray(persisted.users)
        ? persisted.users.map((user) => ({
            ...user,
            avatarEmoji: normalizeAvatarEmoji(user.avatarEmoji, user.id),
            presence: 'offline',
            status: 'Offline',
            socketId: null,
          }))
        : [],
    };

    session.messagesByGroup = Object.fromEntries(
      Object.entries(session.messagesByGroup ?? {}).map(([groupId, messages]) => [
        groupId,
        normalizeMessageTimestamps(messages),
      ]),
    );

    session.directMessagesByThread = Object.fromEntries(
      Object.entries(session.directMessagesByThread ?? {}).map(([threadId, messages]) => [
        threadId,
        normalizeMessageTimestamps(messages),
      ]),
    );

    ensureReadState(session);

    const now = Date.now();
    session.groups.forEach((group) => {
      const latestTimestamp = getLatestMessageTimestamp(session.messagesByGroup[group.id] ?? []);
      session.readState.groups[group.id] = session.readState.groups[group.id] ?? {};

      session.users.forEach((user) => {
        session.readState.groups[group.id][user.id] =
          Number.isFinite(session.readState.groups[group.id][user.id]?.lastReadAt)
            ? session.readState.groups[group.id][user.id]
            : { lastReadAt: latestTimestamp || now };
      });
    });

    Object.entries(session.directMessagesByThread).forEach(([threadId, messages]) => {
      const latestTimestamp = getLatestMessageTimestamp(messages);
      session.readState.threads[threadId] = session.readState.threads[threadId] ?? {};

      const participants = new Set(
        messages.flatMap((message) => [message?.userId, message?.recipientId].filter(Boolean)),
      );

      participants.forEach((userId) => {
        session.readState.threads[threadId][userId] =
          Number.isFinite(session.readState.threads[threadId][userId]?.lastReadAt)
            ? session.readState.threads[threadId][userId]
            : { lastReadAt: latestTimestamp || now };
      });
    });

    return session;
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
        readState: session.readState,
        users: session.users.map(({ socketId, ...user }) => user),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function writeServiceStatus(status) {
  fs.mkdirSync(path.dirname(getServiceStatusFilePath()), { recursive: true });
  fs.writeFileSync(getServiceStatusFilePath(), JSON.stringify(status, null, 2), 'utf8');
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

function getAttachmentStorePath() {
  return path.join(userDataDir, 'attachments');
}

function getUpdateStorePath() {
  return updateDir;
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

function ensureDeliveredTo(message) {
  if (!message.deliveredTo || typeof message.deliveredTo !== 'object') {
    message.deliveredTo = {};
  }

  return message.deliveredTo;
}

function markMessageDeliveredToUser(message, userId) {
  if (!message?.id || !userId || message.userId === userId) {
    return false;
  }

  const deliveredTo = ensureDeliveredTo(message);
  if (deliveredTo[userId]) {
    return false;
  }

  deliveredTo[userId] = Date.now();
  return true;
}

function markDirectMessageDeliveredToOnlineRecipient(session, message) {
  if (!message?.recipientId) {
    return;
  }

  const recipient = session.users.find((user) => user.id === message.recipientId && user.socketId);
  if (!recipient) {
    return;
  }

  markMessageDeliveredToUser(message, recipient.id);
}

function markGroupMessageDeliveredToOnlineMembers(session, groupId, message) {
  const group = session.groups.find((entry) => entry.id === groupId);
  if (!group) {
    return;
  }

  group.memberIds.forEach((memberId) => {
    const member = session.users.find((user) => user.id === memberId && user.socketId);
    if (!member || member.id === message.userId) {
      return;
    }

    markMessageDeliveredToUser(message, member.id);
  });
}

function markHistoricalGroupMessagesDeliveredToUser(session, groupId, userId) {
  const group = session.groups.find((entry) => entry.id === groupId);
  if (!group || !group.memberIds.includes(userId)) {
    return;
  }

  (session.messagesByGroup[group.id] ?? []).forEach((message) => {
    markMessageDeliveredToUser(message, userId);
  });
}

function markHistoricalMessagesDeliveredToUser(session, userId) {
  if (!userId) {
    return;
  }

  session.groups.forEach((group) => {
    if (!group.memberIds.includes(userId)) {
      return;
    }

    (session.messagesByGroup[group.id] ?? []).forEach((message) => {
      markMessageDeliveredToUser(message, userId);
    });
  });

  Object.values(session.directMessagesByThread ?? {}).forEach((messages) => {
    messages.forEach((message) => {
      if (message.recipientId === userId || message.userId === userId) {
        markMessageDeliveredToUser(message, userId);
      }
    });
  });
}

function canDeleteMessage(requestingUser, message) {
  return Boolean(requestingUser?.id && message?.userId && requestingUser.id === message.userId);
}

function markMessageAsDeleted(message, deletedBy) {
  if (!message || message.isDeleted) {
    return message;
  }

  return {
    ...message,
    isDeleted: true,
    deletedBy,
    deletedAt: Date.now(),
    body: '',
    attachments: [],
    replyTo: null,
  };
}

function getTypingConversationKey({ groupId, recipientId, userId }) {
  if (groupId) {
    return `group:${groupId}`;
  }

  if (recipientId && userId) {
    return `dm:${getDirectThreadId(userId, recipientId)}`;
  }

  return '';
}

function createSnapshot(session) {
  return {
    groups: session.groups,
    messagesByGroup: session.messagesByGroup,
    directMessagesByThread: session.directMessagesByThread,
    readState: session.readState,
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

function handleAttachmentUpload(req, res, attachmentsDir) {
  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  const name = sanitizeAttachmentName(requestUrl.searchParams.get('name') || 'file');
  const type =
    `${requestUrl.searchParams.get('type') ?? 'application/octet-stream'}`.trim() ||
    'application/octet-stream';

  const attachmentId = crypto.randomUUID();
  const dataPath = path.join(attachmentsDir, `${attachmentId}.bin`);
  const metaPath = path.join(attachmentsDir, `${attachmentId}.json`);
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

function handleAttachmentDownload(req, res, attachmentsDir, attachmentId) {
  const attachment = readAttachmentMeta(attachmentsDir, attachmentId);
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

function getUpdateFileContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.yml' || extension === '.yaml') {
    return 'text/yaml; charset=utf-8';
  }

  if (extension === '.json') {
    return 'application/json; charset=utf-8';
  }

  if (extension === '.exe') {
    return 'application/vnd.microsoft.portable-executable';
  }

  return 'application/octet-stream';
}

function getSafeUpdateFilePath(updatesDir, requestPath) {
  let relativePath = '';

  try {
    relativePath = decodeURIComponent(requestPath).replace(/^[/\\]+/, '');
  } catch {
    return null;
  }

  if (!relativePath || relativePath.includes('\0')) {
    return null;
  }

  const rootPath = path.resolve(updatesDir);
  const filePath = path.resolve(rootPath, relativePath);
  if (filePath !== rootPath && filePath.startsWith(`${rootPath}${path.sep}`)) {
    return filePath;
  }

  return null;
}

function handleUpdateFileRequest(req, res, updatesDir, requestPath) {
  const filePath = getSafeUpdateFilePath(updatesDir, requestPath);
  if (!filePath) {
    sendJson(res, 400, { message: 'Invalid update file path.' });
    return;
  }

  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    sendJson(res, 404, { message: 'Update file not found.' });
    return;
  }

  if (!stats.isFile()) {
    sendJson(res, 404, { message: 'Update file not found.' });
    return;
  }

  const headers = {
    'Content-Type': getUpdateFileContentType(filePath),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      res.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${stats.size}`,
      });
      res.end();
      return;
    }

    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : stats.size - 1;
    if (!match[1] && match[2]) {
      const suffixLength = Number.parseInt(match[2], 10);
      start = Math.max(stats.size - suffixLength, 0);
      end = stats.size - 1;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= stats.size) {
      res.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${stats.size}`,
      });
      res.end();
      return;
    }

    const boundedEnd = Math.min(end, stats.size - 1);
    res.writeHead(206, {
      ...headers,
      'Content-Length': boundedEnd - start + 1,
      'Content-Range': `bytes ${start}-${boundedEnd}/${stats.size}`,
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath, { start, end: boundedEnd }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': stats.size,
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function startChatService(port) {
  const session = loadPersistedSession();
  const attachmentsDir = getAttachmentStorePath();
  const updatesDir = getUpdateStorePath();
  fs.mkdirSync(attachmentsDir, { recursive: true });
  fs.mkdirSync(updatesDir, { recursive: true });

  const httpServer = createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        port,
        address: getLanAddress(),
      });
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && requestUrl.pathname.startsWith('/updates/')) {
      handleUpdateFileRequest(req, res, updatesDir, requestUrl.pathname.slice('/updates/'.length));
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/attachments') {
      handleAttachmentUpload(req, res, attachmentsDir);
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/attachments/')) {
      const attachmentId = decodeURIComponent(requestUrl.pathname.slice('/attachments/'.length));
      if (!attachmentId) {
        sendJson(res, 400, { message: 'Attachment id is required.' });
        return;
      }

      handleAttachmentDownload(req, res, attachmentsDir, attachmentId);
      return;
    }

    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end('Not found');
  });

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  function getSocketIdForUser(userId) {
    const normalizedUserId = `${userId ?? ''}`.trim();
    if (!normalizedUserId) {
      return '';
    }

    return session.users.find((user) => user.id === normalizedUserId && user.socketId)?.socketId ?? '';
  }

  function relayToUser(targetUserId, eventName, payload) {
    const targetSocketId = getSocketIdForUser(targetUserId);
    if (!targetSocketId) {
      return false;
    }

    io.to(targetSocketId).emit(eventName, payload);
    return true;
  }

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
            avatarEmoji: normalizeAvatarEmoji(existingUser.avatarEmoji, normalizedDeviceId),
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
            avatarEmoji: normalizeAvatarEmoji(null, normalizedDeviceId),
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

      markHistoricalMessagesDeliveredToUser(session, normalizedDeviceId);

      socket.emit('session:joined', {
        profile: {
          id: user.id,
          name: user.name,
          avatarEmoji: user.avatarEmoji,
          initials: user.initials,
          mode: user.isHost ? 'Hosting' : 'Joined',
          deviceId: user.id,
          isHost: Boolean(user.isHost),
        },
        session: createSnapshot(session),
      });

      broadcastSession();
    });

    socket.on('profile:update', ({ avatarEmoji }) => {
      const userId = socket.data.userId;
      if (!userId) {
        return;
      }

      const trimmedEmoji = `${avatarEmoji ?? ''}`.trim();
      if (!trimmedEmoji) {
        return;
      }

      session.users = session.users.map((user) =>
        user.id === userId
          ? {
              ...user,
              avatarEmoji: trimmedEmoji,
            }
          : user,
      );
      broadcastSession();
    });

    socket.on('typing:update', ({ groupId, recipientId, isTyping }) => {
      const userId = socket.data.userId;
      const typingUser = session.users.find((user) => user.id === userId);
      if (!typingUser) {
        return;
      }

      const conversationKey = getTypingConversationKey({
        groupId: `${groupId ?? ''}`.trim(),
        recipientId: `${recipientId ?? ''}`.trim(),
        userId,
      });

      if (!conversationKey) {
        return;
      }

      const payload = {
        conversationKey,
        userId: typingUser.id,
        userName: typingUser.name,
        isTyping: Boolean(isTyping),
      };

      socket.data.typingConversationKey = Boolean(isTyping) ? conversationKey : null;
      socket.broadcast.emit('conversation:typing', payload);
    });

    socket.on('group:create', () => {
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
        const previousMemberIds = new Set(existingGroup.memberIds);

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
        normalizedMemberIds
          .filter((memberId) => !previousMemberIds.has(memberId))
          .forEach((memberId) => {
            markHistoricalGroupMessagesDeliveredToUser(session, groupId, memberId);
          });
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
        createdAt: Date.now(),
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
      markGroupMessageDeliveredToOnlineMembers(session, groupId, message);
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

        session.messagesByGroup[normalizedGroupId] = groupMessages.map((message) =>
          message.id === normalizedMessageId ? markMessageAsDeleted(message, requestingUser.id) : message,
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

      session.directMessagesByThread[threadId] = threadMessages.map((message) =>
        message.id === normalizedMessageId ? markMessageAsDeleted(message, requestingUser.id) : message,
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
        createdAt: Date.now(),
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
      markDirectMessageDeliveredToOnlineRecipient(session, message);
      broadcastSession();
    });

    socket.on('conversation:read', ({ groupId, recipientId }) => {
      const userId = socket.data.userId;
      const requestingUser = session.users.find((user) => user.id === userId);
      if (!requestingUser) return;

      ensureReadState(session);

      if (groupId) {
        const normalizedGroupId = `${groupId ?? ''}`.trim();
        const targetGroup = session.groups.find((group) => group.id === normalizedGroupId);
        if (!normalizedGroupId || !targetGroup) return;

        if (!targetGroup.memberIds.includes(requestingUser.id) && !requestingUser.isHost) {
          return;
        }

        session.readState.groups[normalizedGroupId] = session.readState.groups[normalizedGroupId] ?? {};
        session.readState.groups[normalizedGroupId][requestingUser.id] = {
          lastReadAt: Date.now(),
        };
        broadcastSession();
        return;
      }

      const normalizedRecipientId = `${recipientId ?? ''}`.trim();
      if (!normalizedRecipientId || normalizedRecipientId === requestingUser.id) return;

      const recipient = session.users.find((user) => user.id === normalizedRecipientId);
      if (!recipient) return;

      const threadId = getDirectThreadId(requestingUser.id, normalizedRecipientId);
      session.readState.threads[threadId] = session.readState.threads[threadId] ?? {};
      session.readState.threads[threadId][requestingUser.id] = {
        lastReadAt: Date.now(),
      };
      broadcastSession();
    });

    socket.on('screen-share:offer', ({ targetUserId, offer }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !offer) return;

      relayToUser(targetUserId, 'screen-share:offer', {
        fromUserId,
        offer,
      });
    });

    socket.on('screen-share:request', ({ targetUserId, requestId, requestType }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !requestId || !requestType) return;

      relayToUser(targetUserId, 'screen-share:request', {
        fromUserId,
        requestId,
        requestType,
      });
    });

    socket.on('screen-share:request-response', ({ targetUserId, requestId, requestType, accepted }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !requestId || !requestType) return;

      relayToUser(targetUserId, 'screen-share:request-response', {
        fromUserId,
        requestId,
        requestType,
        accepted: Boolean(accepted),
      });
    });

    socket.on('screen-share:answer', ({ targetUserId, answer }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !answer) return;

      relayToUser(targetUserId, 'screen-share:answer', {
        fromUserId,
        answer,
      });
    });

    socket.on('screen-share:ice-candidate', ({ targetUserId, candidate }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !candidate) return;

      relayToUser(targetUserId, 'screen-share:ice-candidate', {
        fromUserId,
        candidate,
      });
    });

    socket.on('screen-share:end', ({ targetUserId }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId) return;

      relayToUser(targetUserId, 'screen-share:end', {
        fromUserId,
      });
    });

    socket.on('remote-control:request', ({ targetUserId, requestId }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !requestId) return;

      relayToUser(targetUserId, 'remote-control:request', {
        fromUserId,
        requestId,
      });
    });

    socket.on('remote-control:request-response', ({ targetUserId, requestId, accepted, message }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !requestId) return;

      relayToUser(targetUserId, 'remote-control:request-response', {
        fromUserId,
        requestId,
        accepted: Boolean(accepted),
        message: `${message ?? ''}`.slice(0, 240),
      });
    });

    socket.on('remote-control:input', ({ targetUserId, input }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId || !input || typeof input !== 'object') return;

      relayToUser(targetUserId, 'remote-control:input', {
        fromUserId,
        input,
      });
    });

    socket.on('remote-control:end', ({ targetUserId }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !targetUserId) return;

      relayToUser(targetUserId, 'remote-control:end', {
        fromUserId,
      });
    });

    socket.on('disconnect', () => {
      const userId = socket.data.userId;
      if (!userId) return;

      if (socket.data.typingConversationKey) {
        const disconnectingUser = session.users.find((user) => user.id === userId);
        socket.broadcast.emit('conversation:typing', {
          conversationKey: socket.data.typingConversationKey,
          userId,
          userName: disconnectingUser?.name ?? '',
          isTyping: false,
        });
      }

      socket.broadcast.emit('screen-share:end', {
        fromUserId: userId,
      });

      socket.broadcast.emit('remote-control:end', {
        fromUserId: userId,
      });

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

  function broadcastSession() {
    ensureReadState(session);
    ensureGroupMembership(session);
    persistSession(session);
    io.emit('session:update', createSnapshot(session));
  }

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', () => {
      httpServer.off('error', reject);
      const address = getLanAddress();
      writeServiceStatus({
        address,
        port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });
      console.log(`WireChat service ready on ${address}:${port}`);
      resolve({ httpServer, io, session, attachmentsDir, updatesDir, address, port });
    });
  });
}

async function main() {
  const portArgIndex = process.argv.findIndex((value) => value === '--port');
  const portValue = portArgIndex >= 0 ? process.argv[portArgIndex + 1] : process.env.PORT;
  const port = Number.parseInt(portValue, 10);

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Choose a port between 1024 and 65535.');
  }

  await startChatService(port);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
