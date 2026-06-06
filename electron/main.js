const { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, ipcMain, nativeImage, session } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { NsisUpdater } = require('electron-updater');

let mainWindow;
let chatServer;
let chatServiceProcess;
let remoteControlHelperProcess;
let isRemoteControlInputEnabled = false;
let tray;
let isQuitting = false;
const APP_USER_MODEL_ID = 'com.wirechat.app';
const TOAST_ACTIVATOR_CLSID = '{8D5F8B53-8E1A-4B4F-A5B0-1A3A7A7C7E01}';
const SCREEN_SHARE_VIEWER_FRAME_NAME = 'wirechat-screen-share-viewer';
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVE_LAN_UPDATE_STATUSES = new Set(['checking', 'available', 'downloading', 'downloaded', 'installing']);
let lanUpdater = null;
let lanUpdateCheckInterval = null;
let lanUpdateFeedUrl = '';
let updateStatus = {
  status: 'idle',
  message: '',
  feedUrl: '',
  updateInfo: null,
  progress: null,
  error: '',
  updatedAt: null,
};

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

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
}
app.setName('WireChat');

function getDeviceIdFilePath() {
  return path.join(app.getPath('userData'), 'device-id.json');
}

function getSessionStateFilePath() {
  return path.join(app.getPath('userData'), 'wirechat-session.json');
}

function getServiceStatusFilePath() {
  return path.join(app.getPath('userData'), 'wirechat-service.json');
}

function getUpdateStorePath() {
  return path.join(app.getPath('userData'), 'wirechat-updates');
}

function getUpdaterLogFilePath() {
  return path.join(app.getPath('userData'), 'wirechat-updater.log');
}

function getUpdaterCachePath() {
  return path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'wirechat-updater');
}

function appendUpdateLog(eventName, details = {}) {
  try {
    const logEntry = {
      at: new Date().toISOString(),
      event: eventName,
      ...details,
    };

    fs.mkdirSync(path.dirname(getUpdaterLogFilePath()), { recursive: true });
    fs.appendFileSync(getUpdaterLogFilePath(), `${JSON.stringify(logEntry)}${os.EOL}`, 'utf8');
  } catch {
    // Update logging must never break app startup or update checks.
  }
}

function clearUpdaterDownloadCache() {
  const cachePath = getUpdaterCachePath();
  const targets = [
    path.join(cachePath, 'installer.exe'),
    path.join(cachePath, 'current.blockmap'),
    path.join(cachePath, 'pending'),
  ];

  targets.forEach((targetPath) => {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; electron-updater can recreate the cache.
    }
  });
}

function getUpdateStatusSnapshot() {
  return {
    ...updateStatus,
    appVersion: app.getVersion(),
    updateFilesPath: app.isReady() ? getUpdateStorePath() : '',
    isPackaged: app.isPackaged,
  };
}

function emitUpdateStatus(partialStatus = {}) {
  updateStatus = {
    ...updateStatus,
    ...partialStatus,
    updatedAt: Date.now(),
  };

  const snapshot = getUpdateStatusSnapshot();
  appendUpdateLog('status', {
    status: snapshot.status,
    message: snapshot.message,
    feedUrl: snapshot.feedUrl,
    appVersion: snapshot.appVersion,
    updateVersion: snapshot.updateInfo?.version ?? null,
    progress: snapshot.progress,
    error: snapshot.error,
  });
  mainWindow?.webContents.send('app:update-status', snapshot);
  return snapshot;
}

function formatUpdateError(error) {
  return `${error?.message ?? error ?? 'Unable to check for updates.'}`.trim();
}

function isLanUpdateActive() {
  return ACTIVE_LAN_UPDATE_STATUSES.has(updateStatus.status);
}

function getLanUpdateUrl(endpoint) {
  const rawEndpoint = `${endpoint ?? ''}`.trim();
  if (!rawEndpoint) {
    return '';
  }

  try {
    const baseUrl = new URL(/^https?:\/\//i.test(rawEndpoint) ? rawEndpoint : `http://${rawEndpoint}`);
    if (!baseUrl.hostname || !baseUrl.port) {
      return '';
    }

    baseUrl.protocol = 'http:';
    baseUrl.pathname = '/updates/';
    baseUrl.search = '';
    baseUrl.hash = '';
    return baseUrl.toString();
  } catch {
    return '';
  }
}

function resetLanUpdater() {
  if (lanUpdateCheckInterval) {
    clearInterval(lanUpdateCheckInterval);
    lanUpdateCheckInterval = null;
  }

  if (lanUpdater) {
    lanUpdater.removeAllListeners();
    lanUpdater = null;
  }

  lanUpdateFeedUrl = '';
}

function bindLanUpdaterEvents(updater, feedUrl) {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.disableDifferentialDownload = true;
  updater.disableWebInstaller = true;

  updater.on('checking-for-update', () => {
    emitUpdateStatus({
      status: 'checking',
      message: 'Checking LAN updates',
      feedUrl,
      progress: null,
      error: '',
    });
  });

  updater.on('update-available', (info) => {
    emitUpdateStatus({
      status: 'available',
      message: `Downloading v${info?.version ?? 'update'}`,
      feedUrl,
      updateInfo: info ?? null,
      progress: null,
      error: '',
    });
  });

  updater.on('update-not-available', (info) => {
    emitUpdateStatus({
      status: 'not-available',
      message: 'Up to date',
      feedUrl,
      updateInfo: info ?? null,
      progress: null,
      error: '',
    });
  });

  updater.on('download-progress', (progress) => {
    emitUpdateStatus({
      status: 'downloading',
      message: `Downloading ${Math.round(Number(progress?.percent) || 0)}%`,
      feedUrl,
      progress: {
        percent: Number(progress?.percent) || 0,
        transferred: Number(progress?.transferred) || 0,
        total: Number(progress?.total) || 0,
      },
      error: '',
    });
  });

  updater.on('update-downloaded', (info) => {
    emitUpdateStatus({
      status: 'downloaded',
      message: `v${info?.version ?? 'Update'} ready`,
      feedUrl,
      updateInfo: info ?? null,
      progress: null,
      error: '',
    });

    showNativeNotification({
      title: 'WireChat update ready',
      body: 'Restart WireChat to finish installing the update.',
    });
  });

  updater.on('error', (error) => {
    appendUpdateLog('error', {
      feedUrl,
      message: formatUpdateError(error),
      stack: error?.stack ?? '',
    });
    clearUpdaterDownloadCache();

    emitUpdateStatus({
      status: 'error',
      message: 'LAN update check failed',
      feedUrl,
      progress: null,
      error: formatUpdateError(error),
    });
  });
}

async function checkForLanUpdates() {
  if (!lanUpdater) {
    return emitUpdateStatus({
      status: 'idle',
      message: 'Connect to a LAN host for updates',
      feedUrl: '',
      progress: null,
      error: '',
    });
  }

  if (!app.isPackaged || process.platform !== 'win32') {
    return emitUpdateStatus({
      status: 'disabled',
      message: app.isPackaged ? 'Updates are only configured for Windows' : 'Updates run in packaged app only',
      progress: null,
      error: '',
    });
  }

  if (['checking', 'available', 'downloading', 'downloaded', 'installing'].includes(updateStatus.status)) {
    return getUpdateStatusSnapshot();
  }

  try {
    if (!['downloaded', 'installing'].includes(updateStatus.status)) {
      clearUpdaterDownloadCache();
    }

    appendUpdateLog('check-started', {
      feedUrl: updateStatus.feedUrl,
      appVersion: app.getVersion(),
    });
    await lanUpdater.checkForUpdates();
    return getUpdateStatusSnapshot();
  } catch (error) {
    appendUpdateLog('check-failed', {
      feedUrl: updateStatus.feedUrl,
      message: formatUpdateError(error),
      stack: error?.stack ?? '',
    });
    clearUpdaterDownloadCache();

    return emitUpdateStatus({
      status: 'error',
      message: 'LAN update check failed',
      progress: null,
      error: formatUpdateError(error),
    });
  }
}

async function configureLanUpdates(options = {}) {
  const feedUrl = getLanUpdateUrl(options.endpoint);
  fs.mkdirSync(getUpdateStorePath(), { recursive: true });

  if (!feedUrl) {
    if (isLanUpdateActive()) {
      appendUpdateLog('configure-skipped-active-update', {
        currentFeedUrl: lanUpdateFeedUrl,
        requestedFeedUrl: '',
        status: updateStatus.status,
      });

      return getUpdateStatusSnapshot();
    }

    resetLanUpdater();

    return emitUpdateStatus({
      status: 'idle',
      message: 'Connect to a LAN host for updates',
      feedUrl: '',
      updateInfo: null,
      progress: null,
      error: '',
    });
  }

  if (!app.isPackaged || process.platform !== 'win32') {
    resetLanUpdater();

    return emitUpdateStatus({
      status: 'disabled',
      message: app.isPackaged ? 'Updates are only configured for Windows' : 'Updates run in packaged app only',
      feedUrl,
      updateInfo: null,
      progress: null,
      error: '',
    });
  }

  if (lanUpdater && lanUpdateFeedUrl === feedUrl) {
    if (updateStatus.status === 'error') {
      checkForLanUpdates().catch(() => {});
    }

    return getUpdateStatusSnapshot();
  }

  if (isLanUpdateActive()) {
    appendUpdateLog('configure-skipped-active-update', {
      currentFeedUrl: lanUpdateFeedUrl,
      requestedFeedUrl: feedUrl,
      status: updateStatus.status,
    });

    return getUpdateStatusSnapshot();
  }

  resetLanUpdater();
  lanUpdater = new NsisUpdater({
    provider: 'generic',
    url: feedUrl,
  });
  lanUpdater.setFeedURL({
    provider: 'generic',
    url: feedUrl,
  });
  bindLanUpdaterEvents(lanUpdater, feedUrl);
  lanUpdateFeedUrl = feedUrl;

  const snapshot = emitUpdateStatus({
    status: 'configured',
    message: 'LAN updates configured',
    feedUrl,
    updateInfo: null,
    progress: null,
    error: '',
  });

  checkForLanUpdates().catch(() => {});
  lanUpdateCheckInterval = setInterval(() => {
    checkForLanUpdates().catch(() => {});
  }, UPDATE_CHECK_INTERVAL_MS);

  return snapshot;
}

function installDownloadedUpdate() {
  if (!lanUpdater || updateStatus.status !== 'downloaded') {
    return {
      ...getUpdateStatusSnapshot(),
      installStarted: false,
    };
  }

  const snapshot = emitUpdateStatus({
    status: 'installing',
    message: 'Installing update',
    progress: null,
    error: '',
  });

  setImmediate(() => {
    lanUpdater.quitAndInstall(false, true);
  });

  return {
    ...snapshot,
    installStarted: true,
  };
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

function getChatServiceScriptPath() {
  return path.join(__dirname, 'chat-service.js');
}

function getRemoteControlHelperSourcePath() {
  return path.join(__dirname, 'remote-control-helper.ps1');
}

function getRemoteControlHelperRuntimePath() {
  return path.join(app.getPath('userData'), 'wirechat-remote-control-helper.ps1');
}

function installRemoteControlHelperScript() {
  const sourcePath = getRemoteControlHelperSourcePath();
  const targetPath = getRemoteControlHelperRuntimePath();
  const source = fs.readFileSync(sourcePath, 'utf8');
  fs.writeFileSync(targetPath, source, 'utf8');
  return targetPath;
}

function startRemoteControlHelper() {
  if (process.platform !== 'win32') {
    throw new Error('Remote control is only available on Windows.');
  }

  if (remoteControlHelperProcess && !remoteControlHelperProcess.killed) {
    return remoteControlHelperProcess;
  }

  const helperPath = installRemoteControlHelperScript();
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath],
    {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    },
  );

  child.on('exit', () => {
    if (remoteControlHelperProcess === child) {
      remoteControlHelperProcess = null;
      isRemoteControlInputEnabled = false;
    }
  });

  remoteControlHelperProcess = child;
  return child;
}

function stopRemoteControlHelper() {
  isRemoteControlInputEnabled = false;

  if (!remoteControlHelperProcess) {
    return;
  }

  remoteControlHelperProcess.stdin?.end();
  remoteControlHelperProcess.kill();
  remoteControlHelperProcess = null;
}

function clampNumber(value, min, max, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numberValue));
}

function normalizeRemoteControlInput(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  if (input.type === 'pointer') {
    const action = `${input.action ?? ''}`.trim();
    if (!['move', 'down', 'up', 'wheel'].includes(action)) {
      return null;
    }

    const button = `${input.button ?? 'left'}`.trim();
    if (!['left', 'right', 'middle'].includes(button)) {
      return null;
    }

    return {
      type: 'pointer',
      action,
      button,
      x: clampNumber(input.x, 0, 1),
      y: clampNumber(input.y, 0, 1),
      delta: Math.round(clampNumber(input.delta, -2400, 2400)),
    };
  }

  if (input.type === 'key') {
    const action = `${input.action ?? ''}`.trim();
    const vk = Math.round(clampNumber(input.vk, 1, 254, -1));

    if (!['down', 'up'].includes(action) || vk < 1 || vk > 254) {
      return null;
    }

    return {
      type: 'key',
      action,
      vk,
    };
  }

  return null;
}

function sendRemoteControlInput(input) {
  if (!isRemoteControlInputEnabled) {
    return false;
  }

  const helper = startRemoteControlHelper();
  if (!helper.stdin?.writable) {
    throw new Error('Remote control helper is unavailable.');
  }

  const normalizedInput = normalizeRemoteControlInput(input);
  if (!normalizedInput) {
    return false;
  }

  helper.stdin.write(`${JSON.stringify(normalizedInput)}\n`);
  return true;
}

function readServiceStatusFile() {
  try {
    const raw = fs.readFileSync(getServiceStatusFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const port = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(port)) {
      return null;
    }

    return {
      address: `${parsed.address ?? ''}`.trim() || getLanAddress(),
      port,
      pid: Number.parseInt(parsed.pid, 10) || null,
      startedAt: `${parsed.startedAt ?? ''}`.trim() || null,
    };
  } catch {
    return null;
  }
}

function waitForServiceHealth(port, timeoutMs = 15000) {
  const startTime = Date.now();

  return new Promise((resolve) => {
    function poll() {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        resolve(false);
        return;
      }

      const request = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/health',
          timeout: 750,
        },
        (response) => {
          response.resume();
          resolve(response.statusCode === 200);
        },
      );

      request.on('error', () => {
        setTimeout(poll, 250);
      });
      request.on('timeout', () => {
        request.destroy();
      });
    }

    poll();
  });
}

function spawnChatService(port) {
  const serviceScript = getChatServiceScriptPath();
  const child = spawn(process.execPath, [serviceScript, '--port', `${port}`], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      WIRECHAT_USER_DATA_DIR: app.getPath('userData'),
      WIRECHAT_UPDATE_DIR: getUpdateStorePath(),
    },
  });

  child.unref();
  chatServiceProcess = child;
  return child;
}

function writeServiceStatusFile(status) {
  try {
    fs.writeFileSync(
      getServiceStatusFilePath(),
      JSON.stringify(status, null, 2),
      'utf8',
    );
  } catch {}
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

function focusMainWindow() {
  const win = mainWindow ?? createWindow();
  if (!win) return null;

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
  return win;
}

function openChatFromNotification(target) {
  if (!target || !target.type || !target.id) {
    return;
  }

  const win = focusMainWindow();
  if (!win) {
    return;
  }

  win.webContents.send('notification:open-chat', target);
}

function showNativeNotification({ title, body, target }) {
  if (!title || !body) {
    return false;
  }

  const notification = new Notification({
    title,
    body,
    icon: getAppIconPath(),
    silent: false,
  });

  notification.on('click', () => {
    openChatFromNotification(target);
  });

  notification.show();
  return true;
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

function broadcastSession() {
  if (!chatServer) return;
  ensureReadState(chatServer.session);
  ensureGroupMembership(chatServer.session);
  persistSession(chatServer.session);
  chatServer.io.emit('session:update', createSnapshot(chatServer.session));
}

async function stopChatServer() {
  chatServer = null;
}

async function startChatServer(port) {
  const normalizedPort = Number.parseInt(port, 10);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1024 || normalizedPort > 65535) {
    throw new Error('Choose a port between 1024 and 65535.');
  }

  if (chatServer?.port === normalizedPort) {
    const healthy = await waitForServiceHealth(normalizedPort, 750);
    if (healthy) {
      return {
        address: chatServer.address,
        port: chatServer.port,
      };
    }
  }

  const alreadyRunning = await waitForServiceHealth(normalizedPort, 1000);
  if (!alreadyRunning) {
    spawnChatService(normalizedPort);
    const ready = await waitForServiceHealth(normalizedPort, 15000);
    if (!ready) {
      throw new Error('Chat service did not start in time.');
    }
  }

  chatServer = {
    port: normalizedPort,
    address: getLanAddress(),
  };

  writeServiceStatusFile({
    address: chatServer.address,
    port: chatServer.port,
    pid: chatServiceProcess?.pid ?? null,
    startedAt: new Date().toISOString(),
  });

  return {
    address: chatServer.address,
    port: chatServer.port,
  };
}

async function getChatServiceStatus() {
  const status = readServiceStatusFile();
  if (!status) {
    return {
      running: false,
      address: getLanAddress(),
      port: null,
      pid: null,
    };
  }

  const healthy = await waitForServiceHealth(status.port, 1000);
  return {
    running: healthy,
    ...status,
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

  mainWindow.webContents.setWindowOpenHandler(({ frameName, url }) => {
    if (frameName === SCREEN_SHARE_VIEWER_FRAME_NAME && (!url || url === 'about:blank')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'WireChat Screen Share',
          icon: getAppIconPath(),
          backgroundColor: '#05070C',
          width: 1280,
          height: 780,
          minWidth: 960,
          minHeight: 620,
          frame: true,
          autoHideMenuBar: true,
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (childWindow, details) => {
    if (details.frameName !== SCREEN_SHARE_VIEWER_FRAME_NAME) {
      return;
    }

    childWindow.center();
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
  fs.mkdirSync(getUpdateStorePath(), { recursive: true });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    callback({ video: sources[0], audio: 'loopback' });
  });

  createWindow();
  createTray();
  emitUpdateStatus({
    status: app.isPackaged ? 'idle' : 'disabled',
    message: app.isPackaged ? 'Connect to a LAN host for updates' : 'Updates run in packaged app only',
    progress: null,
    error: '',
  });
  getChatServiceStatus()
    .then((status) => {
      if (status?.running && status.port) {
        configureLanUpdates({
          endpoint: `${status.address || '127.0.0.1'}:${status.port}`,
        }).catch(() => {});
      }
    })
    .catch(() => {});

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

ipcMain.handle('app:get-info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  isPackaged: app.isPackaged,
  updateStatus: getUpdateStatusSnapshot(),
}));

ipcMain.handle('app:configure-updates', (_, options = {}) => configureLanUpdates(options));

ipcMain.handle('app:check-for-updates', () => checkForLanUpdates());

ipcMain.handle('app:install-update', () => installDownloadedUpdate());

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

ipcMain.handle('chat:get-service-status', async () => getChatServiceStatus());

ipcMain.handle('notification:show', (_, payload = {}) => showNativeNotification(payload));

ipcMain.handle('remote-control:start', () => {
  startRemoteControlHelper();
  isRemoteControlInputEnabled = true;
  return { active: true };
});

ipcMain.handle('remote-control:stop', () => {
  stopRemoteControlHelper();
  return { active: false };
});

ipcMain.handle('remote-control:input', (_, input = {}) => ({
  handled: sendRemoteControlInput(input),
}));

app.on('before-quit', () => {
  isQuitting = true;
  resetLanUpdater();
  stopRemoteControlHelper();
  tray?.destroy();
  tray = null;
});
