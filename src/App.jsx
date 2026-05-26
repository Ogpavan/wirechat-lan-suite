import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
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
  ChatMultipleRegular,
  MaximizeRegular,
  SubtractRegular,
} from '@fluentui/react-icons';
import { io } from 'socket.io-client';
import StartScreen from './components/StartScreen.jsx';
import ChatLayout from './components/ChatLayout.jsx';
import GroupDialog from './components/GroupDialog.jsx';

const LOGIN_STORAGE_KEY = 'wirechat-login';
const TOASTER_ID = 'wirechat-message-toaster';
const defaultLoginState = {
  userName: '',
  hostAddress: '',
  port: '3001',
  mode: 'join',
  autoReconnect: true,
};

function truncateText(text, maxLength = 120) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
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

function minimizeWindow() {
  window.electronWindow?.minimize();
}

function maximizeWindow() {
  window.electronWindow?.maximize();
}

function closeWindow() {
  window.electronWindow?.close();
}

function showNativeNotification(title, body) {
  window.wirechatNotifications?.show?.({ title, body });
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

export default function App() {
  const socketRef = useRef(null);
  const autoConnectAttemptedRef = useRef(false);
  const previousSessionRef = useRef(null);
  const { dispatchToast } = useToastController(TOASTER_ID);
  const [profile, setProfile] = useState(null);
  const [session, setSession] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [savedLogin, setSavedLogin] = useState(defaultLoginState);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [chatClearToken, setChatClearToken] = useState(0);
  const [uiRefreshToken, setUiRefreshToken] = useState(0);
  const [isRefreshingUi, setIsRefreshingUi] = useState(false);

  function handleOpenProfile() {
    setIsProfileDialogOpen(true);
  }

  function handleTestNotification() {
    showNativeNotification(
      'WireChat Notification Test',
      'If you see this, native Windows notifications are working.',
    );
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
    resetConnection();
    setProfile(null);
    setSession(null);
    setSelectedGroupId(null);
    setSelectedMemberId(null);
    setGroupDialog(null);
    setIsProfileDialogOpen(false);
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

  const canManageGroups = Boolean(profile?.isHost || profile?.mode === 'Hosting');

  const visibleMessages = useMemo(
    () => {
      if (selectedMember) {
        const threadId = getDirectThreadId(profile?.id, selectedMember.id);
        return (session?.directMessagesByThread?.[threadId] ?? []).map((message) => ({
          ...message,
          isOwn: message.userId === profile?.id,
        }));
      }

      return (selectedGroup ? session?.messagesByGroup[selectedGroup.id] ?? [] : []).map((message) => ({
        ...message,
        isOwn: message.userId === profile?.id,
      }));
    },
    [profile?.id, selectedGroup, selectedMember, session],
  );

  useEffect(
    () => () => {
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

    if (!previousSession || isWindowFocused) {
      return;
    }

    session.groups.forEach((group) => {
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

      dispatchToast(
        <Toast>
          <ToastTitle>{group.name}</ToastTitle>
          <ToastBody>
            {incomingMessage.author}: {getToastPreview(incomingMessage)}
          </ToastBody>
        </Toast>,
        {
          intent: 'info',
          timeout: 4500,
          pauseOnWindowBlur: true,
        },
      );

      showNativeNotification(
        group.name,
        `${incomingMessage.author}: ${getToastPreview(incomingMessage)}`,
      );
    });

    Object.entries(session.directMessagesByThread ?? {}).forEach(([threadId, currentMessages]) => {
      const previousMessages = previousSession.directMessagesByThread?.[threadId] ?? [];

      if (currentMessages.length <= previousMessages.length) {
        return;
      }

      const newMessages = currentMessages.slice(previousMessages.length);
      const incomingMessage = [...newMessages].reverse().find((message) => message.userId !== profile.id);

      if (!incomingMessage) {
        return;
      }

      dispatchToast(
        <Toast>
          <ToastTitle>Direct message from {incomingMessage.author}</ToastTitle>
          <ToastBody>{getToastPreview(incomingMessage)}</ToastBody>
        </Toast>,
        {
          intent: 'info',
          timeout: 4500,
          pauseOnWindowBlur: true,
        },
      );

      showNativeNotification(
        `Direct message from ${incomingMessage.author}`,
        getToastPreview(incomingMessage),
      );
    });
  }, [dispatchToast, isWindowFocused, profile?.id, session]);

  function saveLogin(values) {
    const nextLogin = {
      ...defaultLoginState,
      ...values,
    };

    setSavedLogin(nextLogin);
    window.localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(nextLogin));
  }

  function resetConnection() {
    socketRef.current?.disconnect();
    socketRef.current = null;
  }

  async function connectToSession({ userName, hostAddress, port, mode, endpoint }) {
    resetConnection();

    const socket = io(`http://${hostAddress}:${port}`, {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
    });

    socketRef.current = socket;

    return new Promise((resolve, reject) => {
      let joined = false;

      function fail(error) {
        if (joined) return;
        socket.disconnect();
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        reject(error);
      }

      socket.on('connect', () => {
        socket.emit('session:join', { name: userName, deviceId });
      });

      socket.on('session:joined', ({ profile: joinedProfile, session: nextSession }) => {
        joined = true;
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
      });

      socket.on('session:error', ({ message }) => {
        fail(new Error(message || 'Unable to join the host session.'));
      });

      socket.on('connect_error', (error) => {
        fail(new Error(error.message || 'Unable to connect to the host.'));
      });

      socket.on('disconnect', (reason) => {
        if (!joined) return;

        setProfile(null);
        setSession(null);
        setSelectedGroupId(null);
        setSelectedMemberId(null);
        setGroupDialog(null);
        setConnectionError(`Disconnected from host: ${reason}.`);
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
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

  return (
    <div className="app-shell">
      <Toaster toasterId={TOASTER_ID} position="bottom-end" timeout={4500} pauseOnWindowBlur />
      <header className="titlebar">
        <div className="titlebar__drag">
          <span className="titlebar__mark" aria-hidden="true">
            <ChatMultipleRegular />
          </span>
          <span className="titlebar__name">WireChat</span>
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
        />
      ) : (
        <ChatLayout
          profile={profile}
          users={session?.users ?? []}
          groups={session?.groups ?? []}
          selectedGroup={selectedGroup}
          selectedMember={selectedMember}
          messages={visibleMessages}
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
          attachmentBaseUrl={profile?.endpoint ?? ''}
        />
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

      <Dialog open={isProfileDialogOpen} onOpenChange={(_, data) => setIsProfileDialogOpen(data.open)}>
        <DialogSurface className="dialog-surface">
          <DialogBody>
            <DialogTitle>Profile</DialogTitle>
            <DialogContent>
              <div className="profile-dialog">
                <div className="profile-dialog__header">
                  <Avatar name={profile?.name} color="brand" size={48} />
                  <div>
                    <Text weight="semibold">{profile?.name}</Text>
                    <Text className="muted-text compact-text">
                      {profile?.isHost ? 'Host account' : 'Member account'}
                    </Text>
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
                <div className="dialog-actions">
                  <Button appearance="secondary" type="button" onClick={() => setIsProfileDialogOpen(false)}>
                    Close
                  </Button>
                  <Button appearance="secondary" type="button" onClick={handleTestNotification}>
                    Test notification
                  </Button>
                  <Button appearance="primary" type="button" onClick={handleLogout}>
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
