import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  Toast,
  ToastBody,
  ToastTitle,
  Text,
  Toaster,
  useToastController,
} from '@fluentui/react-components';
import {
  DismissRegular,
  MaximizeRegular,
  SubtractRegular,
} from '@fluentui/react-icons';
import { QRCodeSVG } from 'qrcode.react';
import { io } from 'socket.io-client';
import StartScreen from './components/StartScreen.jsx';
import ChatLayout from './components/ChatLayout.jsx';
import GroupDialog from './components/GroupDialog.jsx';
import UserAvatar from './components/UserAvatar.jsx';

const LOGIN_STORAGE_KEY = 'wirechat-login';
const TOASTER_ID = 'wirechat-message-toaster';
const SCREEN_SHARE_IDLE = {
  status: 'idle',
  peerUserId: '',
  remoteStream: null,
  error: '',
};
const REMOTE_CONTROL_IDLE = {
  status: 'idle',
  peerUserId: '',
  requestId: '',
  error: '',
};
const SCREEN_SHARE_REQUEST_TYPES = {
  OFFER_TO_SHARE: 'offer-to-share',
  REQUEST_TO_VIEW: 'request-to-view',
};
const SCREEN_SHARE_CAPTURE_CONSTRAINTS = {
  width: { ideal: 3840 },
  height: { ideal: 2160 },
  frameRate: { ideal: 30 },
  cursor: 'always',
};
const SCREEN_SHARE_TRACK_CONSTRAINTS = {
  width: { ideal: 3840, max: 3840 },
  height: { ideal: 2160, max: 2160 },
  frameRate: { ideal: 30, max: 60 },
};
const SCREEN_SHARE_MAX_BITRATE = 15000000;
const defaultLoginState = {
  userName: '',
  hostAddress: '',
  port: '3001',
  mode: 'join',
  autoReconnect: true,
};
const DEFAULT_UPDATE_STATUS = {
  status: 'idle',
  message: '',
  feedUrl: '',
  updateFilesPath: '',
  updateInfo: null,
  progress: null,
  error: '',
  appVersion: '',
  isPackaged: false,
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

function getRandomAvatarEmoji() {
  return AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
}

function truncateText(text, maxLength = 120) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

async function optimizeScreenShareTrack(track) {
  if (!track || track.kind !== 'video') {
    return;
  }

  if ('contentHint' in track) {
    track.contentHint = 'detail';
  }

  if (!track.applyConstraints) {
    return;
  }

  try {
    await track.applyConstraints(SCREEN_SHARE_TRACK_CONSTRAINTS);
  } catch {
    // Some desktop capture sources do not allow post-capture constraints.
  }
}

async function optimizeScreenShareSender(sender) {
  if (!sender?.getParameters || !sender?.setParameters) {
    return;
  }

  const parameters = sender.getParameters();

  if (!parameters.encodings || parameters.encodings.length === 0) {
    parameters.encodings = [{}];
  }

  parameters.encodings = parameters.encodings.map((encoding) => ({
    ...encoding,
    maxBitrate: SCREEN_SHARE_MAX_BITRATE,
    maxFramerate: 30,
    scaleResolutionDownBy: 1,
  }));
  parameters.degradationPreference = 'maintain-resolution';

  try {
    await sender.setParameters(parameters);
  } catch {
    // Keep sharing even if Chromium rejects a sender tuning option.
  }
}

function getToastPreview(message) {
  if (message.body?.trim()) {
    return truncateText(message.body.trim());
  }

  if (message.attachments?.length === 1) {
    return 'Sent 1 attachment';
  }

  if (message.attachments?.length > 1) {
    return `Sent ${message.attachments.length} attachments`;
  }

  return 'Sent a message';
}

function getDirectThreadId(userIdA, userIdB) {
  return [userIdA, userIdB].map((value) => `${value ?? ''}`.trim()).sort().join('::');
}

function getConversationReadAt(session, profileId, conversation) {
  if (!session || !profileId || !conversation) {
    return 0;
  }

  if (conversation.recipientId) {
    const threadId = getDirectThreadId(profileId, conversation.recipientId);
    return Number(session.readState?.threads?.[threadId]?.[profileId]?.lastReadAt) || 0;
  }

  if (conversation.groupId) {
    return Number(session.readState?.groups?.[conversation.groupId]?.[profileId]?.lastReadAt) || 0;
  }

  return 0;
}

function getUnreadCount(messages, readAt, currentUserId) {
  if (!Array.isArray(messages) || !currentUserId) {
    return 0;
  }

  return messages.reduce((count, message) => {
    const createdAt = Number(message?.createdAt) || 0;
    if (message?.userId === currentUserId || createdAt <= readAt) {
      return count;
    }

    return count + 1;
  }, 0);
}

function getConversationRecipients(profileId, selectedGroup, selectedMember) {
  if (selectedMember) {
    return [selectedMember.id].filter(Boolean);
  }

  if (selectedGroup) {
    return (selectedGroup.memberIds ?? []).filter((memberId) => memberId !== profileId);
  }

  return [];
}

function getMessageReceiptState({ session, profileId, selectedGroup, selectedMember, message }) {
  if (!message?.isOwn || !profileId) {
    return 'none';
  }

  const recipients = getConversationRecipients(profileId, selectedGroup, selectedMember);
  if (recipients.length === 0) {
    return 'sent';
  }

  const createdAt = Number(message.createdAt) || 0;
  const deliveredRecipients = recipients.filter((recipientId) => Number(message.deliveredTo?.[recipientId]) > 0);
  const readRecipients = recipients.filter((recipientId) => {
    if (selectedMember) {
      const threadId = getDirectThreadId(profileId, recipientId);
      const readAt = Number(session?.readState?.threads?.[threadId]?.[recipientId]?.lastReadAt) || 0;
      return readAt >= createdAt;
    }

    const readAt = Number(session?.readState?.groups?.[selectedGroup.id]?.[recipientId]?.lastReadAt) || 0;
    return readAt >= createdAt;
  });

  if (readRecipients.length === recipients.length) {
    return 'read';
  }

  if (deliveredRecipients.length === recipients.length) {
    return 'delivered';
  }

  return 'sent';
}

function minimizeWindow() {
  window.electronWindow?.minimize();
}

function maximizeWindow() {
  window.electronWindow?.maximize();
}

function closeWindow() {
  window.electronWindow?.close();
}

function showNativeNotification({ title, body, target }) {
  window.wirechatNotifications?.show?.({ title, body, target });
}

function getAttachmentServiceUrl(endpoint) {
  if (!endpoint) {
    return '';
  }

  return `http://${endpoint}`;
}

async function uploadAttachment(endpoint, attachment) {
  if (!attachment?.file) {
    return null;
  }

  const serviceUrl = getAttachmentServiceUrl(endpoint);
  if (!serviceUrl) {
    throw new Error('Attachment service is unavailable.');
  }

  const url = new URL('/attachments', serviceUrl);
  url.searchParams.set('name', attachment.name ?? attachment.file.name ?? 'file');
  url.searchParams.set('type', attachment.type ?? attachment.file.type ?? 'application/octet-stream');
  url.searchParams.set('size', String(attachment.size ?? attachment.file.size ?? 0));

  const response = await fetch(url, {
    method: 'POST',
    body: attachment.file,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || 'Unable to upload attachment.');
  }

  return response.json();
}

function getTitlebarUpdateLabel(updateStatus) {
  switch (updateStatus?.status) {
    case 'disabled':
      return updateStatus?.isPackaged ? 'Updates off' : 'Dev build';
    case 'configured':
      return 'LAN updates';
    case 'checking':
      return 'Checking';
    case 'available':
      return 'Update found';
    case 'downloading':
      return `Updating ${Math.round(Number(updateStatus?.progress?.percent) || 0)}%`;
    case 'downloaded':
      return 'Restart to update';
    case 'installing':
      return 'Installing';
    case 'not-available':
      return 'Up to date';
    case 'error':
      return 'Update error';
    default:
      return '';
  }
}

function getTitlebarUpdateTone(updateStatus) {
  if (updateStatus?.status === 'error') {
    return 'error';
  }

  if (updateStatus?.status === 'downloaded') {
    return 'ready';
  }

  if (['checking', 'available', 'downloading', 'installing'].includes(updateStatus?.status)) {
    return 'active';
  }

  return 'neutral';
}

function getTitlebarUpdateTitle(updateStatus) {
  return [
    updateStatus?.message,
    updateStatus?.error ? `Error: ${updateStatus.error}` : '',
    updateStatus?.feedUrl ? `Source: ${updateStatus.feedUrl}` : '',
    updateStatus?.updateFilesPath ? `Host folder: ${updateStatus.updateFilesPath}` : '',
  ].filter(Boolean).join('\n') || 'LAN updates';
}

export default function App() {
  const socketRef = useRef(null);
  const screenPeerRef = useRef(null);
  const screenLocalStreamRef = useRef(null);
  const screenRemoteStreamRef = useRef(null);
  const screenPeerUserIdRef = useRef('');
  const autoConnectAttemptedRef = useRef(false);
  const previousSessionRef = useRef(null);
  const sessionRef = useRef(null);
  const screenShareRef = useRef(SCREEN_SHARE_IDLE);
  const remoteControlRef = useRef(REMOTE_CONTROL_IDLE);
  const { dispatchToast } = useToastController(TOASTER_ID);
  const [profile, setProfile] = useState(null);
  const [session, setSession] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [profileAvatarEmojiDraft, setProfileAvatarEmojiDraft] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [serviceStatus, setServiceStatus] = useState({
    running: false,
    address: '',
    port: null,
    pid: null,
  });
  const [deviceId, setDeviceId] = useState('');
  const [savedLogin, setSavedLogin] = useState(defaultLoginState);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [chatClearToken, setChatClearToken] = useState(0);
  const [uiRefreshToken, setUiRefreshToken] = useState(0);
  const [isRefreshingUi, setIsRefreshingUi] = useState(false);
  const [pendingNotificationTarget, setPendingNotificationTarget] = useState(null);
  const [typingState, setTypingState] = useState({});
  const [screenShare, setScreenShare] = useState(SCREEN_SHARE_IDLE);
  const [incomingScreenShareRequest, setIncomingScreenShareRequest] = useState(null);
  const [pendingScreenShareRequest, setPendingScreenShareRequest] = useState(null);
  const [remoteControl, setRemoteControl] = useState(REMOTE_CONTROL_IDLE);
  const [incomingRemoteControlRequest, setIncomingRemoteControlRequest] = useState(null);
  const [pendingRemoteControlRequest, setPendingRemoteControlRequest] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState(DEFAULT_UPDATE_STATUS);
  const lanUpdateEndpoint = useMemo(() => {
    if (savedLogin.mode === 'host') {
      if (!serviceStatus.running || !serviceStatus.port) {
        return '';
      }

      return `127.0.0.1:${serviceStatus.port}`;
    }

    if (profile?.endpoint) {
      return profile.endpoint;
    }

    if (savedLogin.hostAddress && savedLogin.port) {
      return `${savedLogin.hostAddress}:${savedLogin.port}`;
    }

    return '';
  }, [
    profile?.endpoint,
    savedLogin.hostAddress,
    savedLogin.mode,
    savedLogin.port,
    serviceStatus.running,
    serviceStatus.port,
  ]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    screenShareRef.current = screenShare;
  }, [screenShare]);

  useEffect(() => {
    remoteControlRef.current = remoteControl;
  }, [remoteControl]);

  useEffect(() => {
    let isMounted = true;
    const dispose = window.wirechatApp?.onUpdateStatus?.((nextStatus) => {
      if (!nextStatus) {
        return;
      }

      setUpdateStatus({
        ...DEFAULT_UPDATE_STATUS,
        ...nextStatus,
      });

      if (nextStatus.appVersion) {
        setAppVersion(nextStatus.appVersion);
      }
    });

    async function loadAppInfo() {
      try {
        const info = await window.wirechatApp?.getInfo?.();
        if (!isMounted || !info) {
          return;
        }

        setAppVersion(info.version ?? '');
        setUpdateStatus({
          ...DEFAULT_UPDATE_STATUS,
          ...(info.updateStatus ?? {}),
          appVersion: info.version ?? info.updateStatus?.appVersion ?? '',
          isPackaged: Boolean(info.isPackaged),
        });
      } catch {}
    }

    loadAppInfo();

    return () => {
      isMounted = false;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (!window.wirechatApp?.configureUpdates) {
      return;
    }

    let isMounted = true;
    window.wirechatApp
      .configureUpdates({ endpoint: lanUpdateEndpoint })
      .then((nextStatus) => {
        if (isMounted && nextStatus) {
          setUpdateStatus({
            ...DEFAULT_UPDATE_STATUS,
            ...nextStatus,
          });
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setUpdateStatus((current) => ({
          ...current,
          status: 'error',
          message: 'LAN update setup failed',
          error: error?.message ?? 'Unable to configure LAN updates.',
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [lanUpdateEndpoint]);

  function handleOpenProfile() {
    setProfileAvatarEmojiDraft(profile?.avatarEmoji || getRandomAvatarEmoji());
    setIsProfileDialogOpen(true);
  }

  function handleCloseProfile() {
    setIsProfileDialogOpen(false);
    setProfileAvatarEmojiDraft('');
  }

  function openConversationFromNotification(target) {
    if (!target || !target.type || !target.id) {
      return;
    }

    if (target.type === 'direct') {
      setSelectedMemberId(target.id);
      setSelectedGroupId(null);
      setPendingNotificationTarget(null);
      return;
    }

    if (target.type === 'group') {
      setSelectedGroupId(target.id);
      setSelectedMemberId(null);
      setPendingNotificationTarget(null);
    }
  }

  function handleTestNotification() {
    showNativeNotification({
      title: 'WireChat Notification Test',
      body: 'If you see this, native Windows notifications are working.',
    });
  }

  function handleRefreshUi() {
    setIsRefreshingUi(true);
    setUiRefreshToken((value) => value + 1);
    if (socketRef.current && session) {
      setSession((currentSession) => (currentSession ? { ...currentSession } : currentSession));
    }
    window.setTimeout(() => setIsRefreshingUi(false), 650);
  }

  function handleLogout() {
    stopRemoteControl({ notifyPeer: true });
    stopScreenShare({ notifyPeer: true });
    resetConnection();
    setProfile(null);
    setSession(null);
    setSelectedGroupId(null);
    setSelectedMemberId(null);
    setGroupDialog(null);
    setIsProfileDialogOpen(false);
    setProfileAvatarEmojiDraft('');
    setTypingState({});
    setIncomingScreenShareRequest(null);
    setPendingScreenShareRequest(null);
    setRemoteControl(REMOTE_CONTROL_IDLE);
    setIncomingRemoteControlRequest(null);
    setPendingRemoteControlRequest(null);
    setConnectionError('');
    autoConnectAttemptedRef.current = true;

    const nextLogin = {
      ...savedLogin,
      autoReconnect: false,
    };

    setSavedLogin(nextLogin);
    window.localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(nextLogin));
  }

  const selectedGroup = useMemo(
    () => session?.groups.find((group) => group.id === selectedGroupId) ?? session?.groups[0] ?? null,
    [session, selectedGroupId],
  );

  const selectedMember = useMemo(
    () => session?.users.find((user) => user.id === selectedMemberId) ?? null,
    [selectedMemberId, session],
  );

  const activeGroupDialogGroup = useMemo(
    () => session?.groups.find((group) => group.id === groupDialog?.groupId) ?? null,
    [groupDialog?.groupId, session],
  );

  const activeConversationKey = useMemo(() => {
    if (!profile?.id) {
      return '';
    }

    if (selectedMember) {
      return `dm:${getDirectThreadId(profile.id, selectedMember.id)}`;
    }

    if (selectedGroup) {
      return `group:${selectedGroup.id}`;
    }

    return '';
  }, [profile?.id, selectedGroup, selectedMember]);

  const activeTypingUsers = useMemo(() => {
    if (!activeConversationKey) {
      return [];
    }

    const bucket = typingState[activeConversationKey] ?? {};
    const activeUserIds = new Set((session?.users ?? []).map((user) => user.id));

    return Object.values(bucket).filter((entry) => entry?.userId && entry.userId !== profile?.id && activeUserIds.has(entry.userId));
  }, [activeConversationKey, profile?.id, session?.users, typingState]);

  const incomingScreenShareRequestUser = useMemo(
    () =>
      incomingScreenShareRequest
        ? session?.users.find((user) => user.id === incomingScreenShareRequest.fromUserId) ?? null
        : null,
    [incomingScreenShareRequest, session?.users],
  );

  const incomingRemoteControlRequestUser = useMemo(
    () =>
      incomingRemoteControlRequest
        ? session?.users.find((user) => user.id === incomingRemoteControlRequest.fromUserId) ?? null
        : null,
    [incomingRemoteControlRequest, session?.users],
  );

  const remoteControlPeerUser = useMemo(
    () =>
      remoteControl?.peerUserId
        ? session?.users.find((user) => user.id === remoteControl.peerUserId) ?? null
        : null,
    [remoteControl?.peerUserId, session?.users],
  );

  const canManageGroups = Boolean(profile?.isHost || profile?.mode === 'Hosting');

  const visibleMessages = useMemo(
    () => {
      if (selectedMember) {
        const threadId = getDirectThreadId(profile?.id, selectedMember.id);
        return (session?.directMessagesByThread?.[threadId] ?? []).map((message) => ({
          ...message,
          isOwn: message.userId === profile?.id,
          authorAvatarEmoji: session?.users.find((user) => user.id === message.userId)?.avatarEmoji,
          receiptState: getMessageReceiptState({
            session,
            profileId: profile?.id,
            selectedGroup: null,
            selectedMember,
            message,
          }),
        }));
      }

      return (selectedGroup ? session?.messagesByGroup[selectedGroup.id] ?? [] : []).map((message) => ({
        ...message,
        isOwn: message.userId === profile?.id,
        authorAvatarEmoji: session?.users.find((user) => user.id === message.userId)?.avatarEmoji,
        receiptState: getMessageReceiptState({
          session,
          profileId: profile?.id,
          selectedGroup,
          selectedMember: null,
          message,
        }),
      }));
    },
    [profile?.id, selectedGroup, selectedMember, session],
  );

  const selectedConversationUnreadCount = useMemo(() => {
    if (!profile?.id || !session) {
      return 0;
    }

    if (selectedMember) {
      const threadId = getDirectThreadId(profile.id, selectedMember.id);
      return getUnreadCount(
        session.directMessagesByThread?.[threadId] ?? [],
        getConversationReadAt(session, profile.id, { recipientId: selectedMember.id }),
        profile.id,
      );
    }

    if (selectedGroup) {
      return getUnreadCount(
        session.messagesByGroup?.[selectedGroup.id] ?? [],
        getConversationReadAt(session, profile.id, { groupId: selectedGroup.id }),
        profile.id,
      );
    }

    return 0;
  }, [profile?.id, selectedGroup, selectedMember, session]);

  const sidebarGroups = useMemo(() => {
    if (!session || !profile?.id) {
      return [];
    }

    return session.groups.map((group) => ({
      ...group,
      unread: getUnreadCount(
        session.messagesByGroup?.[group.id] ?? [],
        getConversationReadAt(session, profile.id, { groupId: group.id }),
        profile.id,
      ),
    }));
  }, [profile?.id, session]);

  const sidebarUsers = useMemo(() => {
    if (!session || !profile?.id) {
      return [];
    }

    return session.users.map((user) => {
      const threadId = getDirectThreadId(profile.id, user.id);

      return {
        ...user,
        unread: user.id === profile.id
          ? 0
          : getUnreadCount(
              session.directMessagesByThread?.[threadId] ?? [],
              getConversationReadAt(session, profile.id, { recipientId: user.id }),
              profile.id,
            ),
      };
    });
  }, [profile?.id, session]);

  useEffect(() => {
    if (!profile?.id || !session) {
      return;
    }

    const updatedProfile = session.users.find((user) => user.id === profile.id);
    if (!updatedProfile) {
      return;
    }

    setProfile((current) => {
      if (!current || current.id !== updatedProfile.id) {
        return current;
      }

      if (
        current.name === updatedProfile.name &&
        current.initials === updatedProfile.initials &&
        current.avatarEmoji === updatedProfile.avatarEmoji &&
        current.isHost === updatedProfile.isHost
      ) {
        return current;
      }

      return {
        ...current,
        name: updatedProfile.name,
        initials: updatedProfile.initials,
        avatarEmoji: updatedProfile.avatarEmoji,
        isHost: updatedProfile.isHost,
      };
    });
  }, [profile?.id, session]);

  useEffect(
    () => () => {
      stopScreenShare({ notifyPeer: true });
      socketRef.current?.disconnect();
      socketRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadLocalIdentity() {
      try {
        const storedLogin = window.localStorage.getItem(LOGIN_STORAGE_KEY);
        if (storedLogin && isMounted) {
          setSavedLogin({
            ...defaultLoginState,
            ...JSON.parse(storedLogin),
          });
        }
      } catch {}

      try {
        const identity = await window.lanChat.getDeviceId();
        if (isMounted) {
          setDeviceId(identity.deviceId);
        }
      } catch {
        if (isMounted) {
          setConnectionError('Unable to load the local device identity.');
        }
      }
    }

    loadLocalIdentity();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let intervalId = null;

    async function refreshServiceStatus() {
      if (!window.lanChat?.getServiceStatus) {
        return;
      }

      try {
        const nextStatus = await window.lanChat.getServiceStatus();
        if (isMounted && nextStatus) {
          setServiceStatus(nextStatus);
        }
      } catch {
        if (isMounted) {
          setServiceStatus((current) => ({
            ...current,
            running: false,
          }));
        }
      }
    }

    refreshServiceStatus();
    intervalId = window.setInterval(refreshServiceStatus, 3000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    function syncWindowFocusState() {
      setIsWindowFocused(document.hasFocus());
    }

    syncWindowFocusState();

    window.addEventListener('focus', syncWindowFocusState);
    window.addEventListener('blur', syncWindowFocusState);
    document.addEventListener('visibilitychange', syncWindowFocusState);

    return () => {
      window.removeEventListener('focus', syncWindowFocusState);
      window.removeEventListener('blur', syncWindowFocusState);
      document.removeEventListener('visibilitychange', syncWindowFocusState);
    };
  }, []);

  useEffect(() => {
    if (!window.wirechatNotifications?.onOpenChat) {
      return undefined;
    }

    return window.wirechatNotifications.onOpenChat((target) => {
      setPendingNotificationTarget(target);
    });
  }, []);

  useEffect(() => {
    if (!pendingNotificationTarget || !session || !profile) {
      return;
    }

    openConversationFromNotification(pendingNotificationTarget);
  }, [pendingNotificationTarget, profile, session]);

  useEffect(() => {
    if (!deviceId || profile || isConnecting || autoConnectAttemptedRef.current) {
      return;
    }

    const hasSavedSession =
      savedLogin.autoReconnect &&
      savedLogin.userName.trim().length > 0 &&
      savedLogin.port.trim().length > 0 &&
      (savedLogin.mode === 'host' || savedLogin.hostAddress.trim().length > 0);

    if (!hasSavedSession) {
      return;
    }

    autoConnectAttemptedRef.current = true;

    if (savedLogin.mode === 'host') {
      handleStartHost({
        userName: savedLogin.userName,
        port: savedLogin.port,
      });
      return;
    }

    handleJoinHost({
      userName: savedLogin.userName,
      hostAddress: savedLogin.hostAddress,
      port: savedLogin.port,
    });
  }, [deviceId, isConnecting, profile, savedLogin]);

  useEffect(() => {
    if (!session || !profile) {
      previousSessionRef.current = session;
      return;
    }

    const previousSession = previousSessionRef.current;
    previousSessionRef.current = session;

    if (!previousSession) {
      return;
    }

    session.groups.forEach((group) => {
      if (!group.memberIds?.includes(profile.id)) {
        return;
      }

      const previousMessages = previousSession.messagesByGroup[group.id] ?? [];
      const currentMessages = session.messagesByGroup[group.id] ?? [];

      if (currentMessages.length <= previousMessages.length) {
        return;
      }

      const newMessages = currentMessages.slice(previousMessages.length);
      const incomingMessage = [...newMessages].reverse().find((message) => message.userId !== profile.id);

      if (!incomingMessage) {
        return;
      }

      showNativeNotification({
        title: group.name,
        body: `${incomingMessage.author}: ${getToastPreview(incomingMessage)}`,
        target: { type: 'group', id: group.id },
      });
    });

    Object.entries(session.directMessagesByThread ?? {}).forEach(([threadId, currentMessages]) => {
      const previousMessages = previousSession.directMessagesByThread?.[threadId] ?? [];
      const currentThreadMessages = currentMessages.filter(
        (message) => message.userId === profile.id || message.recipientId === profile.id,
      );
      const previousThreadMessages = previousMessages.filter(
        (message) => message.userId === profile.id || message.recipientId === profile.id,
      );

      if (currentThreadMessages.length <= previousThreadMessages.length) {
        return;
      }

      const newMessages = currentThreadMessages.slice(previousThreadMessages.length);
      const incomingMessage = [...newMessages].reverse().find((message) => message.recipientId === profile.id);

      if (!incomingMessage) {
        return;
      }

      showNativeNotification({
        title: `Direct message from ${incomingMessage.author}`,
        body: getToastPreview(incomingMessage),
        target: { type: 'direct', id: incomingMessage.userId },
      });
    });
  }, [profile?.id, session]);

  useEffect(() => {
    if (!socketRef.current || !profile?.id || !isWindowFocused) {
      return;
    }

    if (selectedMember && selectedConversationUnreadCount > 0) {
      socketRef.current.emit('conversation:read', {
        recipientId: selectedMember.id,
      });
      return;
    }

    if (selectedGroup && selectedConversationUnreadCount > 0) {
      socketRef.current.emit('conversation:read', {
        groupId: selectedGroup.id,
      });
    }
  }, [
    isWindowFocused,
    profile?.id,
    selectedConversationUnreadCount,
    selectedGroup?.id,
    selectedMember?.id,
  ]);

  function saveLogin(values) {
    const nextLogin = {
      ...defaultLoginState,
      ...values,
    };

    setSavedLogin(nextLogin);
    window.localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(nextLogin));
  }

  function resetConnection() {
    stopScreenShare({ notifyPeer: true });
    if (socketRef.current) {
      socketRef.current.__wirechatIntentionalDisconnect = true;
      socketRef.current.disconnect();
    }
    socketRef.current = null;
  }

  function emitScreenShareEvent(eventName, payload = {}) {
    if (!socketRef.current?.connected) {
      return;
    }

    socketRef.current.emit(eventName, payload);
  }

  function closeScreenPeerConnection() {
    if (screenPeerRef.current) {
      screenPeerRef.current.onicecandidate = null;
      screenPeerRef.current.ontrack = null;
      screenPeerRef.current.onconnectionstatechange = null;
      screenPeerRef.current.close();
      screenPeerRef.current = null;
    }
  }

  function stopScreenShare({ notifyPeer = true } = {}) {
    const peerUserId = screenPeerUserIdRef.current;

    stopRemoteControl({ notifyPeer });

    if (notifyPeer && peerUserId) {
      emitScreenShareEvent('screen-share:end', {
        targetUserId: peerUserId,
      });
    }

    screenLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenLocalStreamRef.current = null;
    screenRemoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenRemoteStreamRef.current = null;
    screenPeerUserIdRef.current = '';
    closeScreenPeerConnection();
    setPendingScreenShareRequest(null);
    setScreenShare(SCREEN_SHARE_IDLE);
  }

  function createScreenPeerConnection(peerUserId) {
    closeScreenPeerConnection();

    const peerConnection = new RTCPeerConnection({
      iceServers: [],
    });

    screenPeerRef.current = peerConnection;
    screenPeerUserIdRef.current = peerUserId;

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      emitScreenShareEvent('screen-share:ice-candidate', {
        targetUserId: peerUserId,
        candidate: event.candidate,
      });
    };

    peerConnection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) {
        return;
      }

      screenRemoteStreamRef.current = remoteStream;
      setScreenShare({
        status: 'receiving',
        peerUserId,
        remoteStream,
        error: '',
      });
    };

    peerConnection.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
        stopScreenShare({ notifyPeer: false });
      }
    };

    return peerConnection;
  }

  async function handleStartScreenShare() {
    if (!selectedMember?.id || selectedMember.id === profile?.id || !socketRef.current) {
      return;
    }

    await startScreenShareToUser(selectedMember.id);
  }

  async function startScreenShareToUser(peerUserId) {
    if (!peerUserId || peerUserId === profile?.id || !socketRef.current) {
      return;
    }

    stopScreenShare({ notifyPeer: true });
    setScreenShare({
      status: 'starting',
      peerUserId,
      remoteStream: null,
      error: '',
    });

    try {
      const localStream = await navigator.mediaDevices.getDisplayMedia({
        video: SCREEN_SHARE_CAPTURE_CONSTRAINTS,
        audio: false,
      });

      await Promise.all(localStream.getVideoTracks().map((track) => optimizeScreenShareTrack(track)));

      screenLocalStreamRef.current = localStream;
      const peerConnection = createScreenPeerConnection(peerUserId);
      const senderOptimizations = [];

      localStream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => stopScreenShare({ notifyPeer: true }), { once: true });
        const sender = peerConnection.addTrack(track, localStream);

        if (track.kind === 'video') {
          senderOptimizations.push(optimizeScreenShareSender(sender));
        }
      });

      await Promise.all(senderOptimizations);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      emitScreenShareEvent('screen-share:offer', {
        targetUserId: peerUserId,
        offer,
      });

      setScreenShare({
        status: 'sharing',
        peerUserId,
        remoteStream: null,
        error: '',
      });
    } catch (error) {
      stopScreenShare({ notifyPeer: false });
      setScreenShare({
        ...SCREEN_SHARE_IDLE,
        error: error?.message || 'Unable to start screen sharing.',
      });
    }
  }

  function handleStopScreenShare() {
    stopScreenShare({ notifyPeer: true });
  }

  function sendScreenShareRequest(requestType) {
    if (!selectedMember?.id || selectedMember.id === profile?.id || !socketRef.current) {
      return;
    }

    const requestId = crypto.randomUUID();
    const request = {
      id: requestId,
      targetUserId: selectedMember.id,
      requestType,
    };

    setPendingScreenShareRequest(request);
    socketRef.current.emit('screen-share:request', {
      targetUserId: selectedMember.id,
      requestId,
      requestType,
    });
  }

  function handleOfferToShareScreen() {
    sendScreenShareRequest(SCREEN_SHARE_REQUEST_TYPES.OFFER_TO_SHARE);
  }

  function handleRequestScreenShare() {
    sendScreenShareRequest(SCREEN_SHARE_REQUEST_TYPES.REQUEST_TO_VIEW);
  }

  function handleRespondToScreenShareRequest(accepted) {
    if (!incomingScreenShareRequest || !socketRef.current) {
      return;
    }

    const request = incomingScreenShareRequest;
    setIncomingScreenShareRequest(null);
    socketRef.current.emit('screen-share:request-response', {
      targetUserId: request.fromUserId,
      requestId: request.id,
      requestType: request.requestType,
      accepted,
    });

    if (accepted && request.requestType === SCREEN_SHARE_REQUEST_TYPES.REQUEST_TO_VIEW) {
      startScreenShareToUser(request.fromUserId);
    }
  }

  function emitRemoteControlEvent(eventName, payload) {
    if (!socketRef.current) {
      return;
    }

    socketRef.current.emit(eventName, payload);
  }

  async function stopRemoteControl({ notifyPeer = true } = {}) {
    const currentControl = remoteControlRef.current;

    if (notifyPeer && currentControl.peerUserId) {
      emitRemoteControlEvent('remote-control:end', {
        targetUserId: currentControl.peerUserId,
      });
    }

    if (currentControl.status === 'controlled') {
      try {
        await window.wirechatRemoteControl?.stop?.();
      } catch {}
    }

    setPendingRemoteControlRequest(null);
    setIncomingRemoteControlRequest(null);
    setRemoteControl(REMOTE_CONTROL_IDLE);
  }

  function handleRequestRemoteControl() {
    if (
      !selectedMember?.id ||
      selectedMember.id === profile?.id ||
      !socketRef.current ||
      screenShareRef.current?.status !== 'receiving' ||
      screenShareRef.current?.peerUserId !== selectedMember.id
    ) {
      return;
    }

    const requestId = crypto.randomUUID();
    const request = {
      id: requestId,
      targetUserId: selectedMember.id,
    };

    setPendingRemoteControlRequest(request);
    setRemoteControl({
      status: 'pending',
      peerUserId: selectedMember.id,
      requestId,
      error: '',
    });
    emitRemoteControlEvent('remote-control:request', {
      targetUserId: selectedMember.id,
      requestId,
    });
  }

  async function handleRespondToRemoteControlRequest(accepted) {
    if (!incomingRemoteControlRequest || !socketRef.current) {
      return;
    }

    const request = incomingRemoteControlRequest;
    setIncomingRemoteControlRequest(null);

    let nextAccepted = Boolean(accepted);
    let responseMessage = '';

    if (nextAccepted) {
      const currentShare = screenShareRef.current;
      const currentControl = remoteControlRef.current;

      if (currentShare?.status !== 'sharing' || currentShare?.peerUserId !== request.fromUserId) {
        nextAccepted = false;
        responseMessage = 'Screen sharing is no longer active.';
      } else if (currentControl.status !== 'idle' && currentControl.peerUserId !== request.fromUserId) {
        nextAccepted = false;
        responseMessage = 'Remote control is already active.';
      } else {
        try {
          await window.wirechatRemoteControl?.start?.();
          setRemoteControl({
            status: 'controlled',
            peerUserId: request.fromUserId,
            requestId: request.id,
            error: '',
          });
        } catch (error) {
          nextAccepted = false;
          responseMessage = error?.message || 'Remote control could not be started.';
          setRemoteControl({
            ...REMOTE_CONTROL_IDLE,
            error: responseMessage,
          });
        }
      }
    }

    emitRemoteControlEvent('remote-control:request-response', {
      targetUserId: request.fromUserId,
      requestId: request.id,
      accepted: nextAccepted,
      message: responseMessage,
    });
  }

  function handleSendRemoteControlInput(input) {
    const currentControl = remoteControlRef.current;
    if (currentControl.status !== 'controlling' || !currentControl.peerUserId || !input) {
      return;
    }

    emitRemoteControlEvent('remote-control:input', {
      targetUserId: currentControl.peerUserId,
      input,
    });
  }

  async function handleRemoteControlInput(fromUserId, input) {
    const currentControl = remoteControlRef.current;
    if (currentControl.status !== 'controlled' || currentControl.peerUserId !== fromUserId) {
      return;
    }

    try {
      await window.wirechatRemoteControl?.input?.(input);
    } catch (error) {
      await stopRemoteControl({ notifyPeer: true });
      dispatchToast(
        <Toast>
          <ToastTitle>Remote control stopped</ToastTitle>
          <ToastBody>{error?.message || 'Unable to apply remote input.'}</ToastBody>
        </Toast>,
        {
          intent: 'error',
          timeout: 4500,
          pauseOnWindowBlur: true,
        },
      );
    }
  }

  async function connectToSession({ userName, hostAddress, port, mode, endpoint }) {
    resetConnection();

    const socket = io(`http://${hostAddress}:${port}`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 5000,
    });

    socketRef.current = socket;

    return new Promise((resolve, reject) => {
      let joined = false;

      function fail(error) {
        if (joined) return;
        socket.__wirechatIntentionalDisconnect = true;
        socket.disconnect();
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        reject(error);
      }

      socket.on('connect', () => {
        setConnectionError('');
        socket.emit('session:join', { name: userName, deviceId });
      });

      socket.on('session:joined', ({ profile: joinedProfile, session: nextSession }) => {
        joined = true;
        socket.__wirechatIntentionalDisconnect = false;
        setProfile({ ...joinedProfile, mode, endpoint });
        setSession(nextSession);
        setSelectedGroupId(nextSession.groups[0]?.id ?? null);
        setSelectedMemberId(null);
        setConnectionError('');
        resolve();
      });

      socket.on('session:update', (nextSession) => {
        setSession(nextSession);
        setSelectedGroupId((currentGroupId) => {
          if (currentGroupId && nextSession.groups.some((group) => group.id === currentGroupId)) {
            return currentGroupId;
          }

          return nextSession.groups[0]?.id ?? null;
        });
        setSelectedMemberId((currentMemberId) =>
          nextSession.users.some((user) => user.id === currentMemberId) ? currentMemberId : null,
        );
        setTypingState((currentTypingState) => {
          const activeUserIds = new Set(nextSession.users.map((user) => user.id));
          const nextTypingState = {};

          Object.entries(currentTypingState).forEach(([conversationKey, participants]) => {
            const nextParticipants = {};
            Object.entries(participants ?? {}).forEach(([userId, entry]) => {
              if (activeUserIds.has(userId)) {
                nextParticipants[userId] = entry;
              }
            });

            if (Object.keys(nextParticipants).length > 0) {
              nextTypingState[conversationKey] = nextParticipants;
            }
          });

          return nextTypingState;
        });
      });

      socket.on('conversation:typing', ({ conversationKey, userId, userName, isTyping }) => {
        if (!conversationKey || !userId) {
          return;
        }

        setTypingState((currentTypingState) => {
          const nextTypingState = { ...currentTypingState };
          const currentBucket = { ...(nextTypingState[conversationKey] ?? {}) };

          if (isTyping) {
            currentBucket[userId] = { userId, userName };
          } else {
            delete currentBucket[userId];
          }

          if (Object.keys(currentBucket).length > 0) {
            nextTypingState[conversationKey] = currentBucket;
          } else {
            delete nextTypingState[conversationKey];
          }

          return nextTypingState;
        });
      });

      socket.on('screen-share:offer', async ({ fromUserId, offer }) => {
        if (!fromUserId || !offer) {
          return;
        }

        try {
          stopScreenShare({ notifyPeer: false });
          setScreenShare({
            status: 'connecting',
            peerUserId: fromUserId,
            remoteStream: null,
            error: '',
          });

          const peerConnection = createScreenPeerConnection(fromUserId);
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.emit('screen-share:answer', {
            targetUserId: fromUserId,
            answer,
          });
        } catch (error) {
          stopScreenShare({ notifyPeer: true });
          setScreenShare({
            ...SCREEN_SHARE_IDLE,
            error: error?.message || 'Unable to receive screen share.',
          });
        }
      });

      socket.on('screen-share:request', ({ fromUserId, requestId, requestType }) => {
        if (!fromUserId || !requestId || !requestType) {
          return;
        }

        const requester = sessionRef.current?.users?.find((user) => user.id === fromUserId);
        const requesterName = requester?.displayName ?? requester?.name ?? 'A user';

        setIncomingScreenShareRequest({
          id: requestId,
          fromUserId,
          requestType,
        });

        showNativeNotification({
          title: 'Screen sharing request',
          body:
            requestType === SCREEN_SHARE_REQUEST_TYPES.OFFER_TO_SHARE
              ? `${requesterName} wants to share their screen with you.`
              : `${requesterName} wants you to share your screen.`,
          target: { type: 'direct', id: fromUserId },
        });
      });

      socket.on('screen-share:request-response', ({ fromUserId, requestId, requestType, accepted }) => {
        setPendingScreenShareRequest((current) => {
          if (!current || current.id !== requestId) {
            return current;
          }

          return null;
        });

        if (!accepted) {
          return;
        }

        if (requestType === SCREEN_SHARE_REQUEST_TYPES.OFFER_TO_SHARE) {
          startScreenShareToUser(fromUserId);
        }
      });

      socket.on('screen-share:answer', async ({ fromUserId, answer }) => {
        if (!fromUserId || !answer || screenPeerUserIdRef.current !== fromUserId) {
          return;
        }

        try {
          await screenPeerRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
          setScreenShare((current) => ({
            ...current,
            status: current.status === 'starting' ? 'sharing' : current.status,
            error: '',
          }));
        } catch (error) {
          stopScreenShare({ notifyPeer: true });
          setScreenShare({
            ...SCREEN_SHARE_IDLE,
            error: error?.message || 'Unable to connect screen share.',
          });
        }
      });

      socket.on('screen-share:ice-candidate', async ({ fromUserId, candidate }) => {
        if (!fromUserId || !candidate || screenPeerUserIdRef.current !== fromUserId) {
          return;
        }

        try {
          await screenPeerRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {}
      });

      socket.on('screen-share:end', ({ fromUserId }) => {
        if (!fromUserId || screenPeerUserIdRef.current !== fromUserId) {
          return;
        }

        stopScreenShare({ notifyPeer: false });
      });

      socket.on('remote-control:request', ({ fromUserId, requestId }) => {
        if (!fromUserId || !requestId) {
          return;
        }

        const requester = sessionRef.current?.users?.find((user) => user.id === fromUserId);
        const requesterName = requester?.displayName ?? requester?.name ?? 'A user';
        const currentShare = screenShareRef.current;
        const currentControl = remoteControlRef.current;

        if (currentShare?.status !== 'sharing' || currentShare?.peerUserId !== fromUserId) {
          socket.emit('remote-control:request-response', {
            targetUserId: fromUserId,
            requestId,
            accepted: false,
            message: 'Screen sharing is not active.',
          });
          return;
        }

        if (currentControl.status !== 'idle' && currentControl.peerUserId !== fromUserId) {
          socket.emit('remote-control:request-response', {
            targetUserId: fromUserId,
            requestId,
            accepted: false,
            message: 'Remote control is already active.',
          });
          return;
        }

        setIncomingRemoteControlRequest({
          id: requestId,
          fromUserId,
        });

        showNativeNotification({
          title: 'Remote control request',
          body: `${requesterName} wants to control your screen.`,
          target: { type: 'direct', id: fromUserId },
        });
      });

      socket.on('remote-control:request-response', ({ fromUserId, requestId, accepted, message }) => {
        setPendingRemoteControlRequest((current) => {
          if (!current || current.id !== requestId) {
            return current;
          }

          return null;
        });

        const currentControl = remoteControlRef.current;
        if (!currentControl || currentControl.requestId !== requestId) {
          return;
        }

        if (!accepted) {
          setRemoteControl({
            ...REMOTE_CONTROL_IDLE,
            error: `${message ?? ''}`.trim() || 'Remote control request was declined.',
          });
          dispatchToast(
            <Toast>
              <ToastTitle>Remote control declined</ToastTitle>
              <ToastBody>{`${message ?? ''}`.trim() || 'The other user did not allow control.'}</ToastBody>
            </Toast>,
            {
              intent: 'warning',
              timeout: 4500,
              pauseOnWindowBlur: true,
            },
          );
          return;
        }

        setRemoteControl({
          status: 'controlling',
          peerUserId: fromUserId,
          requestId,
          error: '',
        });
      });

      socket.on('remote-control:input', ({ fromUserId, input }) => {
        if (!fromUserId || !input) {
          return;
        }

        handleRemoteControlInput(fromUserId, input);
      });

      socket.on('remote-control:end', ({ fromUserId }) => {
        const currentControl = remoteControlRef.current;
        if (!fromUserId) {
          return;
        }

        setIncomingRemoteControlRequest((current) =>
          current?.fromUserId === fromUserId ? null : current,
        );
        setPendingRemoteControlRequest((current) =>
          current?.targetUserId === fromUserId ? null : current,
        );

        if (currentControl.peerUserId === fromUserId) {
          stopRemoteControl({ notifyPeer: false });
        }
      });

      socket.on('session:error', ({ message }) => {
        fail(new Error(message || 'Unable to join the host session.'));
      });

      socket.on('connect_error', (error) => {
        if (joined) {
          setConnectionError(`Connection lost: ${error.message || 'Unable to reach the host.'}. Reconnecting...`);
          return;
        }

        fail(new Error(error.message || 'Unable to connect to the host.'));
      });

      socket.on('disconnect', (reason) => {
        if (socket.__wirechatIntentionalDisconnect) {
          return;
        }

        if (!joined) return;

        setConnectionError(`Disconnected from host: ${reason}. Reconnecting...`);
      });

      socket.on('group:error', ({ message }) => {
        dispatchToast(
          <Toast>
            <ToastTitle>Group creation blocked</ToastTitle>
            <ToastBody>{message || 'Only the host can create groups.'}</ToastBody>
          </Toast>,
          {
            intent: 'error',
            timeout: 4500,
            pauseOnWindowBlur: true,
          },
        );
      });
    });
  }

  async function handleStartHost({ userName, port }) {
    if (!deviceId) {
      setConnectionError('Device identity is still loading. Please try again.');
      return;
    }

    setIsConnecting(true);
    setConnectionError('');

    try {
      const host = await window.lanChat.startHost({ port });
      await connectToSession({
        userName,
        hostAddress: '127.0.0.1',
        port: host.port,
        mode: 'Hosting',
        endpoint: `${host.address}:${host.port}`,
      });
      setServiceStatus({
        running: true,
        address: host.address,
        port: host.port,
        pid: serviceStatus.pid,
      });
      saveLogin({
        userName,
        port: `${host.port}`,
        mode: 'host',
      });
    } catch (error) {
      setConnectionError(error.message);
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleJoinHost({ userName, hostAddress, port }) {
    if (!deviceId) {
      setConnectionError('Device identity is still loading. Please try again.');
      return;
    }

    setIsConnecting(true);
    setConnectionError('');

    try {
      await connectToSession({
        userName,
        hostAddress,
        port,
        mode: 'Joined',
        endpoint: `${hostAddress}:${port}`,
      });
      saveLogin({
        userName,
        hostAddress,
        port,
        mode: 'join',
      });
    } catch (error) {
      setConnectionError(error.message);
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleSendMessage(messageBody, attachments = [], replyTo = null, clientMessageId = '') {
    if ((!messageBody.trim() && attachments.length === 0) || !socketRef.current) return;

    let uploadedAttachments = [];

    try {
      for (const attachment of attachments) {
        const uploadedAttachment = await uploadAttachment(profile?.endpoint, attachment);
        if (uploadedAttachment) {
          uploadedAttachments.push(uploadedAttachment);
        }
      }
    } catch (error) {
      dispatchToast(
        <Toast>
          <ToastTitle>Attachment upload failed</ToastTitle>
          <ToastBody>{error?.message || 'Unable to send the selected file.'}</ToastBody>
        </Toast>,
        {
          intent: 'error',
          timeout: 4500,
          pauseOnWindowBlur: true,
        },
      );
      return;
    }

    if (selectedMember) {
      socketRef.current.emit('direct:send', {
        recipientId: selectedMember.id,
        body: messageBody.trim(),
        attachments: uploadedAttachments,
        replyTo,
        clientMessageId,
      });
      return;
    }

    if (!selectedGroup) return;

    socketRef.current.emit('message:send', {
      groupId: selectedGroup.id,
      body: messageBody.trim(),
      attachments: uploadedAttachments,
      replyTo,
      clientMessageId,
    });
  }

  function handleDeleteMessage(message) {
    if (!socketRef.current || !message?.id) return;
    if (message.userId !== profile?.id && message.clientMessageId) {
      return;
    }
    if (message.userId !== profile?.id) {
      return;
    }

    if (selectedMember) {
      socketRef.current.emit('message:delete', {
        recipientId: selectedMember.id,
        messageId: message.id,
      });
      return;
    }

    if (!selectedGroup) return;

    socketRef.current.emit('message:delete', {
      groupId: selectedGroup.id,
      messageId: message.id,
    });
  }

  function handleClearChat() {
    if (!socketRef.current) return;

    if (selectedMember) {
      const threadId = getDirectThreadId(profile?.id, selectedMember.id);
      setSession((currentSession) => {
        if (!currentSession) return currentSession;

        return {
          ...currentSession,
          directMessagesByThread: {
            ...(currentSession.directMessagesByThread ?? {}),
            [threadId]: [],
          },
        };
      });
      socketRef.current.emit('messages:clear', {
        recipientId: selectedMember.id,
      });
      setChatClearToken((value) => value + 1);
      return;
    }

    if (!selectedGroup) return;

    setSession((currentSession) => {
      if (!currentSession) return currentSession;

      return {
        ...currentSession,
        messagesByGroup: {
          ...(currentSession.messagesByGroup ?? {}),
          [selectedGroup.id]: [],
        },
      };
    });
    socketRef.current.emit('messages:clear', {
      groupId: selectedGroup.id,
    });
    setChatClearToken((value) => value + 1);
  }

  function openCreateGroupDialog() {
    if (!canManageGroups) return;
    setGroupDialog({ mode: 'create', groupId: null });
  }

  function openEditGroupDialog(groupId) {
    if (!canManageGroups) return;
    setGroupDialog({ mode: 'edit', groupId });
  }

  function handleSaveGroup(groupData) {
    if (!socketRef.current) return;

    socketRef.current.emit('group:upsert', groupData);
    setGroupDialog(null);
  }

  function handleDeleteGroup(groupId) {
    if (!socketRef.current || !groupId) return;

    socketRef.current.emit('group:delete', { groupId });
    setGroupDialog(null);
  }

  function handleTypingChange(isTyping) {
    if (!socketRef.current || !profile?.id) {
      return;
    }

    if (selectedMember) {
      socketRef.current.emit('typing:update', {
        recipientId: selectedMember.id,
        isTyping,
      });
      return;
    }

    if (selectedGroup) {
      socketRef.current.emit('typing:update', {
        groupId: selectedGroup.id,
        isTyping,
      });
    }
  }

  function handleSaveProfileAvatar() {
    if (!socketRef.current || !profileAvatarEmojiDraft.trim()) {
      return;
    }

    const nextEmoji = profileAvatarEmojiDraft.trim();
    setProfile((current) => (current ? { ...current, avatarEmoji: nextEmoji } : current));
    socketRef.current.emit('profile:update', { avatarEmoji: nextEmoji });
    setIsProfileDialogOpen(false);
    setProfileAvatarEmojiDraft('');
  }

  async function handleInstallUpdate() {
    try {
      const result = await window.wirechatApp?.installUpdate?.();
      if (result?.installStarted) {
        return;
      }

      dispatchToast(
        <Toast>
          <ToastTitle>Update is not ready</ToastTitle>
          <ToastBody>WireChat has not finished downloading an update yet.</ToastBody>
        </Toast>,
        {
          intent: 'warning',
          timeout: 4500,
          pauseOnWindowBlur: true,
        },
      );
    } catch (error) {
      dispatchToast(
        <Toast>
          <ToastTitle>Unable to install update</ToastTitle>
          <ToastBody>{error?.message || 'Restart WireChat and try again.'}</ToastBody>
        </Toast>,
        {
          intent: 'error',
          timeout: 4500,
          pauseOnWindowBlur: true,
        },
      );
    }
  }

  const displayedVersion = appVersion || updateStatus.appVersion || '0.0.0';
  const titlebarUpdateLabel = getTitlebarUpdateLabel(updateStatus);
  const titlebarUpdateTone = getTitlebarUpdateTone(updateStatus);
  const titlebarUpdateTitle = getTitlebarUpdateTitle(updateStatus);
  const isDownloadedUpdateReady = updateStatus.status === 'downloaded';
  const profilePairingPayload = useMemo(() => {
    if (!profile?.endpoint || !profile?.deviceId) {
      return '';
    }

    return JSON.stringify({
      type: 'wirechat.account-link',
      version: 1,
      app: 'wirechat',
      transport: 'socket.io',
      endpoint: profile.endpoint,
      socketUrl: `http://${profile.endpoint}`,
      deviceId: profile.deviceId,
      displayName: profile.name,
      avatarEmoji: profile.avatarEmoji ?? '',
      mode: profile.mode ?? '',
      issuedAt: Date.now(),
    });
  }, [
    profile?.avatarEmoji,
    profile?.deviceId,
    profile?.endpoint,
    profile?.mode,
    profile?.name,
  ]);

  return (
    <div className="app-shell">
      <Toaster toasterId={TOASTER_ID} position="bottom-end" timeout={4500} pauseOnWindowBlur />
      <header className="titlebar">
        <div className="titlebar__drag">
          <span className="titlebar__mark" aria-hidden="true">
            <img src="logo%20(2).png" alt="" />
          </span>
          <span className="titlebar__name">WireChat</span>
          <span className="titlebar__version">v{displayedVersion}</span>
          <span
            className={`titlebar__status ${
              serviceStatus.running ? 'titlebar__status--online' : 'titlebar__status--offline'
            }`}
            aria-label={serviceStatus.running ? 'Service running' : 'Service offline'}
            title={serviceStatus.running ? 'Service running' : 'Service offline'}
          >
            <span className="titlebar__status-dot" aria-hidden="true" />
          </span>
          {titlebarUpdateLabel ? (
            isDownloadedUpdateReady ? (
              <button
                type="button"
                className={`titlebar__update titlebar__update--${titlebarUpdateTone}`}
                title={titlebarUpdateTitle}
                onClick={handleInstallUpdate}
              >
                {titlebarUpdateLabel}
              </button>
            ) : (
              <span
                className={`titlebar__update titlebar__update--${titlebarUpdateTone}`}
                title={titlebarUpdateTitle}
              >
                {titlebarUpdateLabel}
              </span>
            )
          ) : null}
        </div>
        <div className="titlebar__controls">
          <Button
            appearance="subtle"
            icon={<SubtractRegular />}
            aria-label="Minimize"
            onClick={minimizeWindow}
          />
          <Button
            appearance="subtle"
            icon={<MaximizeRegular />}
            aria-label="Maximize"
            onClick={maximizeWindow}
          />
          <Button
            appearance="subtle"
            icon={<DismissRegular />}
            aria-label="Close"
            className="titlebar__close"
            onClick={closeWindow}
          />
        </div>
      </header>

      {!profile ? (
        <StartScreen
          onStartHost={handleStartHost}
          onJoinHost={handleJoinHost}
          isBusy={isConnecting}
          error={connectionError}
          initialValues={savedLogin}
          serviceStatus={serviceStatus}
        />
      ) : (
        <ChatLayout
          profile={profile}
          users={sidebarUsers}
          groups={sidebarGroups}
          selectedGroup={selectedGroup}
          selectedMember={selectedMember}
          messages={visibleMessages}
          currentUserId={profile.id}
          typingUsers={activeTypingUsers}
          onTypingChange={handleTypingChange}
          onSelectGroup={(groupId) => {
            setSelectedGroupId(groupId);
            setSelectedMemberId(null);
          }}
          onSelectMember={setSelectedMemberId}
          onCreateGroup={openCreateGroupDialog}
          onEditGroup={openEditGroupDialog}
          onDeleteGroup={handleDeleteGroup}
          canCreateGroup={canManageGroups}
          onOpenProfile={handleOpenProfile}
          onRefreshUi={handleRefreshUi}
          isRefreshingUi={isRefreshingUi}
          onLogout={handleLogout}
          onSendMessage={handleSendMessage}
          onDeleteMessage={handleDeleteMessage}
          onClearChat={handleClearChat}
          clearToken={chatClearToken}
          uiRefreshToken={uiRefreshToken}
          unreadCount={selectedConversationUnreadCount}
          attachmentBaseUrl={profile?.endpoint ?? ''}
          screenShare={screenShare}
          pendingScreenShareRequest={pendingScreenShareRequest}
          remoteControl={remoteControl}
          pendingRemoteControlRequest={pendingRemoteControlRequest}
          onOfferToShareScreen={handleOfferToShareScreen}
          onRequestScreenShare={handleRequestScreenShare}
          onStartScreenShare={handleStartScreenShare}
          onStopScreenShare={handleStopScreenShare}
          onRequestRemoteControl={handleRequestRemoteControl}
          onSendRemoteControlInput={handleSendRemoteControlInput}
          onStopRemoteControl={() => stopRemoteControl({ notifyPeer: true })}
        />
      )}

      {remoteControl.status === 'controlled' && (
        <div className="remote-control-banner" role="status" aria-live="assertive">
          <Text weight="semibold">
            {remoteControlPeerUser?.name ?? 'A user'} is controlling your desktop
          </Text>
          <Button appearance="primary" size="small" onClick={() => stopRemoteControl({ notifyPeer: true })}>
            Stop control
          </Button>
        </div>
      )}

      <Dialog open={Boolean(groupDialog)} onOpenChange={(_, data) => !data.open && setGroupDialog(null)}>
        <DialogSurface className="dialog-surface">
          <DialogBody>
            <DialogTitle>{groupDialog?.mode === 'edit' ? 'Edit group' : 'Create group'}</DialogTitle>
            <DialogContent>
              <GroupDialog
                group={activeGroupDialogGroup}
                users={session?.users ?? []}
                onSave={handleSaveGroup}
                onDelete={handleDeleteGroup}
                onCancel={() => setGroupDialog(null)}
              />
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={Boolean(incomingScreenShareRequest)}
        onOpenChange={(_, data) => {
          if (!data.open) {
            handleRespondToScreenShareRequest(false);
          }
        }}
      >
        <DialogSurface className="dialog-surface">
          <DialogBody>
            <DialogTitle>Screen sharing request</DialogTitle>
            <DialogContent>
              <div className="screen-share-request-dialog">
                <Text>
                  {incomingScreenShareRequest?.requestType === SCREEN_SHARE_REQUEST_TYPES.OFFER_TO_SHARE
                    ? `${incomingScreenShareRequestUser?.name ?? 'A user'} wants to share their screen with you.`
                    : `${incomingScreenShareRequestUser?.name ?? 'A user'} wants you to share your screen.`}
                </Text>
                <div className="dialog-actions">
                  <Button appearance="secondary" onClick={() => handleRespondToScreenShareRequest(false)}>
                    Decline
                  </Button>
                  <Button appearance="primary" onClick={() => handleRespondToScreenShareRequest(true)}>
                    Accept
                  </Button>
                </div>
              </div>
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={Boolean(incomingRemoteControlRequest)}
        onOpenChange={(_, data) => {
          if (!data.open) {
            handleRespondToRemoteControlRequest(false);
          }
        }}
      >
        <DialogSurface className="dialog-surface">
          <DialogBody>
            <DialogTitle>Remote control request</DialogTitle>
            <DialogContent>
              <div className="screen-share-request-dialog">
                <Text>
                  {incomingRemoteControlRequestUser?.name ?? 'A user'} wants to control your desktop. Only allow this
                  if you trust them and you can watch the session.
                </Text>
                <div className="dialog-actions">
                  <Button appearance="secondary" onClick={() => handleRespondToRemoteControlRequest(false)}>
                    Decline
                  </Button>
                  <Button appearance="primary" onClick={() => handleRespondToRemoteControlRequest(true)}>
                    Allow control
                  </Button>
                </div>
              </div>
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={isProfileDialogOpen} onOpenChange={(_, data) => (data.open ? setIsProfileDialogOpen(true) : handleCloseProfile())}>
        <DialogSurface className="dialog-surface">
          <DialogBody>
            <DialogTitle>Profile</DialogTitle>
            <DialogContent>
              <div className="profile-dialog">
                <div className="profile-dialog__header">
                  <UserAvatar name={profile?.name} emoji={profile?.avatarEmoji} initials={profile?.initials} size={48} />
                  <div>
                    <Text weight="semibold">{profile?.name}</Text>
                    <Text className="muted-text compact-text">
                      {profile?.isHost ? 'Host account' : 'Member account'}
                    </Text>
                  </div>
                </div>
                <div className="profile-dialog__emoji-section">
                  <div className="profile-dialog__emoji-preview">
                    <Text className="muted-text compact-text">Avatar emoji</Text>
                    <UserAvatar
                      name={profile?.name}
                      emoji={profileAvatarEmojiDraft}
                      initials={profile?.initials}
                      size={72}
                    />
                  </div>
                  <div className="profile-dialog__emoji-grid" role="list" aria-label="Avatar emoji choices">
                    {AVATAR_EMOJIS.map((emoji) => {
                      const isSelected = profileAvatarEmojiDraft === emoji;

                      return (
                        <button
                          type="button"
                          className={`profile-dialog__emoji-choice ${isSelected ? 'profile-dialog__emoji-choice--active' : ''}`}
                          key={emoji}
                          aria-label={`Choose ${emoji}`}
                          aria-pressed={isSelected}
                          onClick={() => setProfileAvatarEmojiDraft(emoji)}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <dl className="metadata-list">
                  <div>
                    <dt>Device ID</dt>
                    <dd>{profile?.deviceId ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>{profile?.mode ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Endpoint</dt>
                    <dd>{profile?.endpoint ?? 'Local session'}</dd>
                  </div>
                </dl>
                {profilePairingPayload ? (
                  <div className="profile-dialog__qr-card">
                    <div className="profile-dialog__qr-code" aria-label="Mobile account pairing QR code">
                      <QRCodeSVG
                        value={profilePairingPayload}
                        size={176}
                        level="M"
                        bgColor="#ffffff"
                        fgColor="#111827"
                        marginSize={1}
                      />
                    </div>
                    <div className="profile-dialog__qr-copy">
                      <Text weight="semibold">Mobile pairing</Text>
                      <Text className="muted-text compact-text">
                        Scan from WireChat Android on the same network.
                      </Text>
                      <dl className="profile-dialog__qr-meta">
                        <div>
                          <dt>Account</dt>
                          <dd>{profile?.name}</dd>
                        </div>
                        <div>
                          <dt>LAN endpoint</dt>
                          <dd>{profile?.endpoint}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                ) : null}
                <div className="dialog-actions">
                  <Button
                    appearance="secondary"
                    type="button"
                    onClick={() => setProfileAvatarEmojiDraft(getRandomAvatarEmoji())}
                  >
                    Randomize
                  </Button>
                  <Button appearance="secondary" type="button" onClick={handleCloseProfile}>
                    Close
                  </Button>
                  <Button appearance="secondary" type="button" onClick={handleTestNotification}>
                    Test notification
                  </Button>
                  <Button appearance="primary" type="button" onClick={handleSaveProfileAvatar}>
                    Save
                  </Button>
                </div>
                <div className="dialog-actions dialog-actions--secondary">
                  <Button appearance="secondary" type="button" onClick={handleLogout}>
                    Logout
                  </Button>
                </div>
              </div>
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
