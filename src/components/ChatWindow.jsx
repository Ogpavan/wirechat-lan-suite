import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import EmojiPicker from 'emoji-picker-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Text,
  Tooltip,
} from '@fluentui/react-components';
import {
  AttachRegular,
  ChatMultipleRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  CopyRegular,
  DismissCircleRegular,
  DeleteRegular,
  DesktopRegular,
  DocumentRegular,
  EmojiRegular,
  ArrowDownloadRegular,
  ArrowReplyRegular,
  FullScreenMaximizeRegular,
  MoreHorizontalRegular,
  SearchRegular,
  SendRegular,
  CheckmarkRegular,
} from '@fluentui/react-icons';
import UserAvatar from './UserAvatar.jsx';

function formatFileSize(bytes) {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) return `${Math.round(safeBytes / 1024)} KB`;
  return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mapFiles(files) {
  return Array.from(files).map((file) => ({
    id: crypto.randomUUID(),
    file,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
  }));
}

function truncateText(text, maxLength = 96) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildReplySnapshot(message) {
  return {
    messageId: message.id,
    author: message.author,
    body: message.body ?? '',
    attachmentCount: message.attachments?.length ?? 0,
    attachmentName: message.attachments?.[0]?.name ?? '',
  };
}

function getReplyPreview(replyTo) {
  if (!replyTo) return '';
  if (replyTo.body?.trim()) {
    return truncateText(replyTo.body.trim());
  }
  if (replyTo.attachmentCount === 1) {
    return `Attachment: ${replyTo.attachmentName || 'file'}`;
  }
  if (replyTo.attachmentCount > 1) {
    return `${replyTo.attachmentCount} attachments`;
  }
  return 'Message';
}

function isImageAttachment(attachment) {
  return typeof attachment?.type === 'string' && attachment.type.startsWith('image/');
}

function isNearScrollBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 72;
}

function getGraphemeSegments(text) {
  if (typeof Intl?.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }

  return Array.from(text);
}

function isEmojiSegment(segment) {
  return /\p{Extended_Pictographic}/u.test(segment) || /\p{Emoji_Presentation}/u.test(segment);
}

function isEmojiOnlyMessage(text) {
  const compactText = (text ?? '').replace(/\s/g, '');
  if (!compactText) {
    return false;
  }

  const segments = getGraphemeSegments(compactText);
  return segments.length <= 5 && segments.every(isEmojiSegment);
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const olderDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function getStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getMessageTimestamp(message) {
  const createdAt = Number(message?.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now();
}

function getMessageDayKey(message) {
  const date = new Date(getMessageTimestamp(message));
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function getDateSeparatorLabel(message) {
  const messageDate = new Date(getMessageTimestamp(message));
  const todayStart = getStartOfDay(new Date());
  const messageDayStart = getStartOfDay(messageDate);
  const daysAgo = Math.round((todayStart.getTime() - messageDayStart.getTime()) / DAY_IN_MS);

  if (daysAgo === 0) {
    return 'Today';
  }

  if (daysAgo === 1) {
    return 'Yesterday';
  }

  if (daysAgo > 1 && daysAgo < 7) {
    return weekdayFormatter.format(messageDate);
  }

  return olderDateFormatter.format(messageDate);
}

function getAttachmentUrl(attachmentBaseUrl, attachment) {
  if (attachment?.previewUrl) {
    return attachment.previewUrl;
  }

  if (attachment?.dataUrl) {
    return attachment.dataUrl;
  }

  if (!attachmentBaseUrl || !attachment?.id) {
    return '';
  }

  return `http://${attachmentBaseUrl}/attachments/${attachment.id}`;
}

function downloadAttachment(attachmentBaseUrl, attachment) {
  const attachmentUrl = getAttachmentUrl(attachmentBaseUrl, attachment);
  if (!attachmentUrl) return;

  const link = document.createElement('a');
  link.href = attachmentUrl;
  link.download = attachment.name || 'download';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function copyTextToClipboard(text) {
  if (!text) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

function clamp01(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numberValue));
}

function getPointerButton(buttonId) {
  if (buttonId === 1) return 'middle';
  if (buttonId === 2) return 'right';
  return 'left';
}

function getVideoContentPoint(videoElement, event) {
  const rect = videoElement.getBoundingClientRect();
  const videoWidth = Number(videoElement.videoWidth) || 16;
  const videoHeight = Number(videoElement.videoHeight) || 9;
  const elementRatio = rect.width / Math.max(1, rect.height);
  const videoRatio = videoWidth / Math.max(1, videoHeight);
  let contentLeft = rect.left;
  let contentTop = rect.top;
  let contentWidth = rect.width;
  let contentHeight = rect.height;

  if (elementRatio > videoRatio) {
    contentWidth = rect.height * videoRatio;
    contentLeft = rect.left + (rect.width - contentWidth) / 2;
  } else if (elementRatio < videoRatio) {
    contentHeight = rect.width / videoRatio;
    contentTop = rect.top + (rect.height - contentHeight) / 2;
  }

  return {
    x: clamp01((event.clientX - contentLeft) / Math.max(1, contentWidth)),
    y: clamp01((event.clientY - contentTop) / Math.max(1, contentHeight)),
  };
}

function getVirtualKey(event) {
  const code = `${event.code ?? ''}`;

  if (/^Key[A-Z]$/.test(code)) {
    return code.charCodeAt(3);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.charCodeAt(5);
  }

  if (/^Numpad[0-9]$/.test(code)) {
    return 0x60 + Number.parseInt(code.slice('Numpad'.length), 10);
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return 0x70 + Number.parseInt(code.slice(1), 10) - 1;
  }

  const codeMap = {
    Backspace: 0x08,
    Tab: 0x09,
    Enter: 0x0d,
    NumpadEnter: 0x0d,
    ShiftLeft: 0xa0,
    ShiftRight: 0xa1,
    ControlLeft: 0xa2,
    ControlRight: 0xa3,
    AltLeft: 0xa4,
    AltRight: 0xa5,
    Pause: 0x13,
    CapsLock: 0x14,
    Escape: 0x1b,
    Space: 0x20,
    PageUp: 0x21,
    PageDown: 0x22,
    End: 0x23,
    Home: 0x24,
    ArrowLeft: 0x25,
    ArrowUp: 0x26,
    ArrowRight: 0x27,
    ArrowDown: 0x28,
    PrintScreen: 0x2c,
    Insert: 0x2d,
    Delete: 0x2e,
    MetaLeft: 0x5b,
    MetaRight: 0x5c,
    ContextMenu: 0x5d,
    NumpadMultiply: 0x6a,
    NumpadAdd: 0x6b,
    NumpadSubtract: 0x6d,
    NumpadDecimal: 0x6e,
    NumpadDivide: 0x6f,
    NumLock: 0x90,
    ScrollLock: 0x91,
    Semicolon: 0xba,
    Equal: 0xbb,
    Comma: 0xbc,
    Minus: 0xbd,
    Period: 0xbe,
    Slash: 0xbf,
    Backquote: 0xc0,
    BracketLeft: 0xdb,
    Backslash: 0xdc,
    BracketRight: 0xdd,
    Quote: 0xde,
  };

  return codeMap[code] ?? 0;
}

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,!?;:])/gi;

function normalizeUrl(rawUrl) {
  const trimmed = `${rawUrl ?? ''}`.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^www\./i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return '';
}

function parseMessageSegments(text) {
  const content = `${text ?? ''}`;
  if (!content) {
    return [];
  }

  const segments = [];
  let cursor = 0;
  let match;

  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(content)) !== null) {
    const matchedText = match[0];
    const normalizedUrl = normalizeUrl(matchedText);

    if (!normalizedUrl) {
      continue;
    }

    if (match.index > cursor) {
      segments.push({
        type: 'text',
        value: content.slice(cursor, match.index),
      });
    }

    segments.push({
      type: 'link',
      value: matchedText,
      href: normalizedUrl,
    });

    cursor = match.index + matchedText.length;
  }

  if (cursor < content.length) {
    segments.push({
      type: 'text',
      value: content.slice(cursor),
    });
  }

  return segments;
}

export default function ChatWindow({
  title,
  meta,
  selectedMember,
  currentUserName,
  currentUserAvatarEmoji,
  currentUserId,
  typingUsers = [],
  conversationKey,
  messages,
  onSendMessage,
  onDeleteMessage,
  onClearChat,
  onTypingChange,
  clearToken,
  unreadCount = 0,
  attachmentBaseUrl,
  screenShare = null,
  pendingScreenShareRequest = null,
  remoteControl = null,
  pendingRemoteControlRequest = null,
  onOfferToShareScreen,
  onRequestScreenShare,
  onStartScreenShare,
  onStopScreenShare,
  onRequestRemoteControl,
  onSendRemoteControlInput,
  onStopRemoteControl,
}) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [pendingMessages, setPendingMessages] = useState([]);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [locallyHiddenMessageIds, setLocallyHiddenMessageIds] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const draftInputRef = useRef(null);
  const messageListRef = useRef(null);
  const scrollFrameRef = useRef(0);
  const previousConversationKeyRef = useRef(null);
  const previousMessageCountRef = useRef(0);
  const searchMatchRefs = useRef(new Map());
  const pendingObjectUrlsRef = useRef(new Set());
  const screenShareVideoRef = useRef(null);
  const screenShareViewerRef = useRef(null);
  const screenShareViewerVideoRef = useRef(null);
  const remoteControlRef = useRef(remoteControl);
  const remoteControlCallbacksRef = useRef({
    onRequestRemoteControl,
    onSendRemoteControlInput,
    onStopRemoteControl,
  });
  const remoteControlPointerFrameRef = useRef(0);
  const pendingRemotePointerMoveRef = useRef(null);
  const typingStartTimerRef = useRef(0);
  const typingStopTimerRef = useRef(0);
  const typingStateRef = useRef(false);

  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const renderedMessages = [...messages, ...pendingMessages];
  const visibleMessages = useMemo(
    () =>
      renderedMessages.filter(
        (message) =>
          !locallyHiddenMessageIds.has(message.id ?? message.clientMessageId) &&
          !(message?.isDeleted && message?.deletedBy && message.deletedBy === currentUserId),
      ),
    [currentUserId, locallyHiddenMessageIds, renderedMessages],
  );
  const isEmptyConversation = visibleMessages.length === 0;
  const normalizedSearchQuery = searchQuery.trim();
  const searchMatches = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [];
    }

    const query = normalizedSearchQuery.toLowerCase();
    const nextMatches = [];

    visibleMessages.forEach((message) => {
      const body = message.body ?? '';
      if (!body) {
        return;
      }

      const bodyLower = body.toLowerCase();
      const messageKey = message.id ?? message.clientMessageId;
      let startIndex = bodyLower.indexOf(query);

      while (startIndex !== -1) {
        nextMatches.push({
          messageKey,
          startIndex,
        });
        startIndex = bodyLower.indexOf(query, startIndex + query.length);
      }
    });

    return nextMatches;
  }, [normalizedSearchQuery, visibleMessages]);
  const searchMatchIndexByKey = useMemo(() => {
    const indexByKey = new Map();

    searchMatches.forEach((match, index) => {
      indexByKey.set(`${match.messageKey}:${match.startIndex}`, index);
    });

    return indexByKey;
  }, [searchMatches]);
  const searchResultLabel = normalizedSearchQuery
    ? `${searchMatches.length > 0 ? Math.min(activeSearchIndex + 1, searchMatches.length) : 0}/${
        searchMatches.length
      }`
    : '';
  const activeScreenShareForConversation =
    Boolean(selectedMember?.id && screenShare?.peerUserId === selectedMember.id && screenShare.status !== 'idle');
  const canStartScreenShare =
    Boolean(selectedMember?.id && selectedMember.id !== currentUserId && selectedMember.presence === 'available') &&
    (!screenShare || screenShare.status === 'idle' || activeScreenShareForConversation);
  const isScreenShareRequestPending =
    Boolean(pendingScreenShareRequest?.targetUserId && pendingScreenShareRequest.targetUserId === selectedMember?.id);
  const isReceivingScreenShare = Boolean(
    activeScreenShareForConversation && screenShare?.status === 'receiving' && screenShare?.remoteStream,
  );
  const isRemoteControlPending =
    Boolean(pendingRemoteControlRequest?.targetUserId && pendingRemoteControlRequest.targetUserId === selectedMember?.id);
  const isControllingRemote =
    Boolean(remoteControl?.status === 'controlling' && remoteControl.peerUserId === selectedMember?.id);
  const canRequestRemoteControl =
    Boolean(isReceivingScreenShare && selectedMember?.id && !isControllingRemote && !isRemoteControlPending);
  const remoteControlButtonLabel = isControllingRemote
    ? 'Stop control'
    : isRemoteControlPending
      ? 'Control pending'
      : 'Request control';
  const screenShareStatusLabel =
    screenShare?.status === 'starting'
      ? 'Starting screen share'
      : screenShare?.status === 'connecting'
        ? 'Connecting screen share'
        : screenShare?.status === 'sharing'
          ? 'You are sharing your screen'
          : isReceivingScreenShare
            ? `${selectedMember?.displayName ?? selectedMember?.name ?? 'User'} is sharing`
            : '';

  useEffect(() => {
    remoteControlRef.current = remoteControl;
  }, [remoteControl]);

  useEffect(() => {
    remoteControlCallbacksRef.current = {
      onRequestRemoteControl,
      onSendRemoteControlInput,
      onStopRemoteControl,
    };
  }, [onRequestRemoteControl, onSendRemoteControlInput, onStopRemoteControl]);

  function detachScreenShareViewer(viewerWindow = screenShareViewerRef.current) {
    if (!viewerWindow || screenShareViewerRef.current !== viewerWindow) {
      return;
    }

    if (['controlling', 'pending'].includes(remoteControlRef.current?.status)) {
      remoteControlCallbacksRef.current.onStopRemoteControl?.();
    }

    if (screenShareViewerVideoRef.current) {
      screenShareViewerVideoRef.current.srcObject = null;
    }

    screenShareViewerVideoRef.current = null;
    screenShareViewerRef.current = null;
  }

  function closeScreenShareViewer() {
    const viewerWindow = screenShareViewerRef.current;
    detachScreenShareViewer(viewerWindow);

    if (viewerWindow && !viewerWindow.closed) {
      viewerWindow.close();
    }
  }

  function isRemoteControlActive() {
    return remoteControlRef.current?.status === 'controlling';
  }

  function sendRemoteControlInput(input) {
    if (!isRemoteControlActive()) {
      return;
    }

    remoteControlCallbacksRef.current.onSendRemoteControlInput?.(input);
  }

  function updateRemoteControlButton(viewerDocument) {
    const controlButton = viewerDocument.getElementById('screen-share-viewer-control');
    const controlStatus = viewerDocument.getElementById('screen-share-viewer-control-status');
    if (!controlButton || !controlStatus) {
      return;
    }

    controlButton.textContent = remoteControlButtonLabel;
    controlButton.disabled = isRemoteControlPending;
    controlButton.classList.toggle('screen-share-viewer__button--active', isControllingRemote);
    controlStatus.textContent = isControllingRemote
      ? 'Remote control active'
      : isRemoteControlPending
        ? 'Waiting for approval'
        : 'View only';
  }

  function flushPendingRemotePointerMove() {
    remoteControlPointerFrameRef.current = 0;

    if (!pendingRemotePointerMoveRef.current) {
      return;
    }

    sendRemoteControlInput(pendingRemotePointerMoveRef.current);
    pendingRemotePointerMoveRef.current = null;
  }

  function sendRemotePointerInput(videoElement, event, action) {
    if (!isRemoteControlActive()) {
      return;
    }

    const point = getVideoContentPoint(videoElement, event);
    const input = {
      type: 'pointer',
      action,
      button: getPointerButton(event.button),
      x: point.x,
      y: point.y,
      delta: 0,
    };

    event.preventDefault();
    event.stopPropagation();

    if (action === 'move') {
      pendingRemotePointerMoveRef.current = input;
      if (!remoteControlPointerFrameRef.current) {
        remoteControlPointerFrameRef.current = window.requestAnimationFrame(flushPendingRemotePointerMove);
      }
      return;
    }

    sendRemoteControlInput(input);
  }

  function sendRemoteWheelInput(videoElement, event) {
    if (!isRemoteControlActive()) {
      return;
    }

    const point = getVideoContentPoint(videoElement, event);
    event.preventDefault();
    event.stopPropagation();
    sendRemoteControlInput({
      type: 'pointer',
      action: 'wheel',
      button: 'left',
      x: point.x,
      y: point.y,
      delta: Math.round(Math.max(-720, Math.min(720, -event.deltaY))),
    });
  }

  function sendRemoteKeyInput(event, action) {
    if (!isRemoteControlActive()) {
      return;
    }

    const virtualKey = getVirtualKey(event);
    if (!virtualKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    sendRemoteControlInput({
      type: 'key',
      action,
      vk: virtualKey,
    });
  }

  function syncScreenShareViewer() {
    const viewerWindow = screenShareViewerRef.current;
    if (!viewerWindow || viewerWindow.closed) {
      detachScreenShareViewer(viewerWindow);
      return;
    }

    try {
      const statusElement = viewerWindow.document.getElementById('screen-share-viewer-status');
      if (statusElement) {
        statusElement.textContent = screenShareStatusLabel || 'Screen share';
      }

      if (screenShareViewerVideoRef.current) {
        screenShareViewerVideoRef.current.srcObject = isReceivingScreenShare ? screenShare.remoteStream : null;
      }

      updateRemoteControlButton(viewerWindow.document);
    } catch {
      detachScreenShareViewer(viewerWindow);
    }
  }

  function openScreenShareViewer() {
    if (!isReceivingScreenShare || !screenShare?.remoteStream) {
      return;
    }

    const existingViewer = screenShareViewerRef.current;
    if (existingViewer && !existingViewer.closed) {
      syncScreenShareViewer();
      existingViewer.focus();
      return;
    }

    const viewerWindow = window.open(
      '',
      'wirechat-screen-share-viewer',
      'popup=yes,width=1280,height=720,left=0,top=0',
    );

    if (!viewerWindow) {
      return;
    }

    screenShareViewerRef.current = viewerWindow;

    try {
      const viewerDocument = viewerWindow.document;
      viewerDocument.open();
      viewerDocument.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WireChat Screen Share</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #05070c;
      color: #f8fafc;
    }

    body {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 10px;
      padding: 14px 16px 16px;
    }

    .screen-share-viewer__status {
      justify-self: center;
      max-width: min(720px, calc(100vw - 48px));
      padding: 8px 12px;
      overflow: hidden;
      border: 1px solid rgb(255 255 255 / 12%);
      border-radius: 6px;
      background: rgb(15 23 42 / 82%);
      box-shadow: 0 10px 28px rgb(0 0 0 / 28%);
      color: #e5e7eb;
      font-size: 13px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .screen-share-viewer__stage {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 8px;
      background: #020617;
    }

    .screen-share-viewer__video {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      background: #020617;
      object-fit: contain;
    }

    .screen-share-viewer__controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: center;
      max-width: calc(100vw - 32px);
      padding: 10px;
      border: 1px solid rgb(255 255 255 / 12%);
      border-radius: 8px;
      background: rgb(15 23 42 / 84%);
      box-shadow: 0 14px 34px rgb(0 0 0 / 35%);
    }

    .screen-share-viewer__control-status {
      min-width: 132px;
      color: #cbd5e1;
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
    }

    .screen-share-viewer__button {
      min-width: 112px;
      height: 36px;
      padding: 0 14px;
      border: 1px solid rgb(255 255 255 / 16%);
      border-radius: 6px;
      background: rgb(255 255 255 / 9%);
      color: #f8fafc;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
    }

    .screen-share-viewer__button:hover {
      background: rgb(255 255 255 / 14%);
    }

    .screen-share-viewer__button:disabled {
      cursor: default;
      opacity: 0.62;
    }

    .screen-share-viewer__button--active {
      border-color: #38bdf8;
      background: #0369a1;
    }

    .screen-share-viewer__button--active:hover {
      background: #075985;
    }

    .screen-share-viewer__button--danger {
      border-color: #ef4444;
      background: #dc2626;
    }

    .screen-share-viewer__button--danger:hover {
      background: #b91c1c;
    }
  </style>
</head>
<body>
  <div id="screen-share-viewer-status" class="screen-share-viewer__status">Screen share</div>
  <div class="screen-share-viewer__stage">
    <video id="screen-share-viewer-video" class="screen-share-viewer__video" autoplay playsinline muted></video>
  </div>
  <div class="screen-share-viewer__controls">
    <span id="screen-share-viewer-control-status" class="screen-share-viewer__control-status">View only</span>
    <button id="screen-share-viewer-control" class="screen-share-viewer__button" type="button">Request control</button>
    <button id="screen-share-viewer-stop" class="screen-share-viewer__button screen-share-viewer__button--danger" type="button">Stop sharing</button>
    <button id="screen-share-viewer-close" class="screen-share-viewer__button" type="button">Close viewer</button>
  </div>
</body>
</html>`);
      viewerDocument.close();

      const viewerVideo = viewerDocument.getElementById('screen-share-viewer-video');
      screenShareViewerVideoRef.current = viewerVideo;
      viewerVideo.tabIndex = -1;
      viewerVideo.srcObject = screenShare.remoteStream;
      viewerVideo.play().catch(() => {});

      viewerDocument.getElementById('screen-share-viewer-status').textContent =
        screenShareStatusLabel || 'Screen share';
      updateRemoteControlButton(viewerDocument);
      viewerDocument.getElementById('screen-share-viewer-control').addEventListener('click', () => {
        if (remoteControlRef.current?.status === 'controlling') {
          remoteControlCallbacksRef.current.onStopRemoteControl?.();
          return;
        }

        remoteControlCallbacksRef.current.onRequestRemoteControl?.();
        viewerVideo.focus();
      });
      viewerDocument.getElementById('screen-share-viewer-stop').addEventListener('click', () => {
        onStopScreenShare?.();
        closeScreenShareViewer();
      });
      viewerDocument.getElementById('screen-share-viewer-close').addEventListener('click', closeScreenShareViewer);
      viewerVideo.addEventListener('pointermove', (event) => sendRemotePointerInput(viewerVideo, event, 'move'));
      viewerVideo.addEventListener('pointerdown', (event) => {
        viewerVideo.setPointerCapture?.(event.pointerId);
        sendRemotePointerInput(viewerVideo, event, 'down');
      });
      viewerVideo.addEventListener('pointerup', (event) => {
        viewerVideo.releasePointerCapture?.(event.pointerId);
        sendRemotePointerInput(viewerVideo, event, 'up');
      });
      viewerVideo.addEventListener('wheel', (event) => sendRemoteWheelInput(viewerVideo, event), { passive: false });
      viewerVideo.addEventListener('contextmenu', (event) => event.preventDefault());
      viewerDocument.addEventListener('keydown', (event) => sendRemoteKeyInput(event, 'down'), true);
      viewerDocument.addEventListener('keyup', (event) => sendRemoteKeyInput(event, 'up'), true);
      viewerDocument.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !isRemoteControlActive()) {
          closeScreenShareViewer();
        }
      });
      viewerWindow.addEventListener('beforeunload', () => detachScreenShareViewer(viewerWindow), { once: true });
      viewerWindow.focus();
    } catch {
      closeScreenShareViewer();
    }
  }

  useEffect(() => {
    if (!screenShareVideoRef.current) {
      return;
    }

    screenShareVideoRef.current.srcObject = isReceivingScreenShare ? screenShare.remoteStream : null;
  }, [isReceivingScreenShare, screenShare?.remoteStream]);

  useEffect(() => {
    if (!isReceivingScreenShare) {
      closeScreenShareViewer();
      return;
    }

    syncScreenShareViewer();
  }, [
    isControllingRemote,
    isReceivingScreenShare,
    isRemoteControlPending,
    remoteControlButtonLabel,
    screenShare?.remoteStream,
    screenShareStatusLabel,
  ]);

  function setScrollButtonVisibilityFromList() {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    const shouldShow = !isNearScrollBottom(messageList);
    setShowScrollToBottom((current) => (current === shouldShow ? current : shouldShow));
  }

  function scrollToBottom(behavior = 'smooth') {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior,
    });
    setShowScrollToBottom(false);
  }

  function scheduleScrollToBottom(behavior = 'auto') {
    if (scrollFrameRef.current) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      scrollToBottom(behavior);
    });
  }

  function handleMessageListScroll() {
    setScrollButtonVisibilityFromList();
  }

  useEffect(() => {
    setDraft('');
    setAttachments([]);
    setReplyTarget(null);
    setIsDragging(false);
    setSearchQuery('');
    setActiveSearchIndex(0);
    setIsEmojiPickerOpen(false);
    setPreviewAttachment(null);
    setLocallyHiddenMessageIds(new Set());
    stopTypingSignal();
    searchMatchRefs.current.clear();
    pendingObjectUrlsRef.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    pendingObjectUrlsRef.current.clear();
    setPendingMessages([]);
  }, [conversationKey]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      if (remoteControlPointerFrameRef.current) {
        window.cancelAnimationFrame(remoteControlPointerFrameRef.current);
      }

      closeScreenShareViewer();
    };
  }, []);

  useEffect(() => {
    if (!clearToken) {
      return;
    }

    pendingObjectUrlsRef.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    pendingObjectUrlsRef.current.clear();
    setPendingMessages([]);
    setDraft('');
    setAttachments([]);
    setReplyTarget(null);
    setIsEmojiPickerOpen(false);
    setPreviewAttachment(null);
    setLocallyHiddenMessageIds(new Set());
    stopTypingSignal();
  }, [clearToken]);

  useEffect(() => {
    return () => {
      if (typingStartTimerRef.current) {
        window.clearTimeout(typingStartTimerRef.current);
      }

      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
      }

      if (typingStateRef.current) {
        onTypingChange?.(false);
        typingStateRef.current = false;
      }
    };
  }, [onTypingChange]);

  useEffect(() => {
    if (activeSearchIndex < searchMatches.length) {
      return;
    }

    setActiveSearchIndex(searchMatches.length > 0 ? searchMatches.length - 1 : 0);
  }, [activeSearchIndex, searchMatches.length]);

  useEffect(() => {
    if (!normalizedSearchQuery || searchMatches.length === 0) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      searchMatchRefs.current.get(activeSearchIndex)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeSearchIndex, normalizedSearchQuery, searchMatches.length]);

  useEffect(() => {
    if (pendingMessages.length === 0) {
      return;
    }

    const serverMessageIds = new Set(
      messages
        .map((message) => message.clientMessageId)
        .filter((clientMessageId) => typeof clientMessageId === 'string' && clientMessageId.trim()),
    );

    if (serverMessageIds.size === 0) {
      return;
    }

    setPendingMessages((current) => {
      const nextPending = [];

      current.forEach((message) => {
        if (serverMessageIds.has(message.clientMessageId)) {
          message.attachments?.forEach((attachment) => {
            if (attachment.previewUrl) {
              URL.revokeObjectURL(attachment.previewUrl);
              pendingObjectUrlsRef.current.delete(attachment.previewUrl);
            }
          });
          return;
        }

        nextPending.push(message);
      });

      return nextPending;
    });
  }, [messages, pendingMessages.length]);

  useEffect(() => {
    const messageCount = visibleMessages.length;
    const conversationChanged = previousConversationKeyRef.current !== conversationKey;
    const previousMessageCount = conversationChanged ? 0 : previousMessageCountRef.current;

    if (conversationChanged) {
      previousConversationKeyRef.current = conversationKey;
      scheduleScrollToBottom('auto');
    } else if (messageCount > previousMessageCount) {
      const latestMessage = visibleMessages[messageCount - 1];
      const shouldFollowLatest =
        !showScrollToBottom || latestMessage?.isOwn || latestMessage?.status === 'sending';

      if (shouldFollowLatest) {
        scheduleScrollToBottom(latestMessage?.isOwn ? 'smooth' : 'auto');
      } else {
        setScrollButtonVisibilityFromList();
      }
    } else if (messageCount === 0) {
      setShowScrollToBottom(false);
    }

    previousMessageCountRef.current = messageCount;
  }, [conversationKey, showScrollToBottom, visibleMessages.length]);

  function buildPendingAttachments(files) {
    return files.map((attachment) => {
      const previewUrl = URL.createObjectURL(attachment.file);
      pendingObjectUrlsRef.current.add(previewUrl);

      return {
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        type: attachment.type,
        previewUrl,
      };
    });
  }

  function removePendingMessage(clientMessageId) {
    setPendingMessages((current) => {
      const nextPending = [];

      current.forEach((message) => {
        if (message.clientMessageId !== clientMessageId) {
          nextPending.push(message);
          return;
        }

        message.attachments?.forEach((attachment) => {
          if (attachment.previewUrl) {
            URL.revokeObjectURL(attachment.previewUrl);
            pendingObjectUrlsRef.current.delete(attachment.previewUrl);
          }
        });
      });

      return nextPending;
    });
  }

  function handleDeleteMessage(message) {
    if (message?.id && message?.userId === currentUserId) {
      setLocallyHiddenMessageIds((current) => {
        const next = new Set(current);
        next.add(message.id);
        return next;
      });
    }

    if (message?.status === 'sending' || message?.status === 'failed' || message?.clientMessageId) {
      removePendingMessage(message.clientMessageId ?? message.id);
      return;
    }

    onDeleteMessage?.(message);
  }

  async function sendMessage() {
    if (!canSend) return;

    const clientMessageId = crypto.randomUUID();
    const pendingAttachments = buildPendingAttachments(attachments);
    const pendingMessage = {
      id: clientMessageId,
      clientMessageId,
      author: currentUserName || 'You',
      authorAvatarEmoji: currentUserAvatarEmoji,
      createdAt: Date.now(),
      time: 'Sending',
      body: draft.trim(),
      attachments: pendingAttachments,
      replyTo: replyTarget ? buildReplySnapshot(replyTarget) : null,
      userId: '__pending__',
      isOwn: true,
      status: 'sending',
    };

    setPendingMessages((current) => [...current, pendingMessage]);
    setDraft('');
    setAttachments([]);
    setReplyTarget(null);
    setIsEmojiPickerOpen(false);
    draftInputRef.current?.focus();
    stopTypingSignal();

    try {
      await onSendMessage(
        draft,
        attachments,
        replyTarget ? buildReplySnapshot(replyTarget) : null,
        clientMessageId,
      );
    } catch {
      setPendingMessages((current) =>
        current.map((message) =>
          message.clientMessageId === clientMessageId
            ? { ...message, status: 'failed', time: 'Failed', sending: false }
            : message,
        ),
      );
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function addAttachments(fileList) {
    if (!fileList?.length) return;
    setAttachments((current) => [...current, ...mapFiles(fileList)]);
  }

  function getPastedImageFiles(event) {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (imageFiles.length > 0) {
      return imageFiles;
    }

    return Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    );
  }

  function removeAttachment(id) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function handleFileChange(event) {
    addAttachments(event.target.files);
    event.target.value = '';
  }

  function handlePaste(event) {
    const pastedImages = getPastedImageFiles(event);
    if (pastedImages.length === 0) {
      return;
    }

    event.preventDefault();
    addAttachments(pastedImages);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    addAttachments(event.dataTransfer.files);
  }

  function getMessageKey(message) {
    return message.id ?? message.clientMessageId;
  }

  function handleSearchChange(_, data) {
    setSearchQuery(data.value);
    setActiveSearchIndex(0);
  }

  function handleDraftChange(_, data) {
    setDraft(data.value);
    scheduleTypingSignal(data.value);
  }

  function insertEmoji(emojiData) {
    const emoji = emojiData?.emoji;
    if (!emoji) {
      return;
    }

    const input = draftInputRef.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const nextDraft = `${draft.slice(0, selectionStart)}${emoji}${draft.slice(selectionEnd)}`;
    const nextCursorPosition = selectionStart + emoji.length;

    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      draftInputRef.current?.focus();
      draftInputRef.current?.setSelectionRange?.(nextCursorPosition, nextCursorPosition);
    });
  }

  function handleEmojiButtonClick() {
    setIsEmojiPickerOpen((isOpen) => !isOpen);
  }

  function moveActiveSearchMatch(offset) {
    if (searchMatches.length === 0) {
      return;
    }

    setActiveSearchIndex((current) => (current + offset + searchMatches.length) % searchMatches.length);
  }

  function setReplyToMessage(message) {
    setReplyTarget(message);
    draftInputRef.current?.focus();
  }

  function copyMessageBody(message) {
    copyTextToClipboard(message?.body ?? '').catch(() => {});
  }

  function stopTypingSignal() {
    if (typingStartTimerRef.current) {
      window.clearTimeout(typingStartTimerRef.current);
      typingStartTimerRef.current = 0;
    }

    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = 0;
    }

    if (typingStateRef.current) {
      typingStateRef.current = false;
      onTypingChange?.(false);
    }
  }

  function scheduleTypingSignal(nextDraft) {
    if (!onTypingChange) {
      return;
    }

    const hasText = nextDraft.trim().length > 0;
    if (!hasText) {
      stopTypingSignal();
      return;
    }

    if (typingStartTimerRef.current) {
      window.clearTimeout(typingStartTimerRef.current);
      typingStartTimerRef.current = 0;
    }

    if (!typingStateRef.current) {
      typingStartTimerRef.current = window.setTimeout(() => {
        typingStartTimerRef.current = 0;
        typingStateRef.current = true;
        onTypingChange(true);

        if (typingStopTimerRef.current) {
          window.clearTimeout(typingStopTimerRef.current);
        }

        typingStopTimerRef.current = window.setTimeout(() => {
          typingStopTimerRef.current = 0;
          if (!typingStateRef.current) {
            return;
          }

          typingStateRef.current = false;
          onTypingChange(false);
        }, 1500);
      }, 250);
      return;
    }

    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
    }

    typingStopTimerRef.current = window.setTimeout(() => {
      typingStopTimerRef.current = 0;
      if (!typingStateRef.current) {
        return;
      }

      typingStateRef.current = false;
      onTypingChange(false);
    }, 1500);
  }

  function openExternalLink(url) {
    const nextUrl = normalizeUrl(url);
    if (!nextUrl) {
      return;
    }

    window.wirechatShell?.openExternal?.(nextUrl);
  }

  function openAttachmentPreview(attachment) {
    const attachmentUrl = getAttachmentUrl(attachmentBaseUrl, attachment);
    if (!attachmentUrl || !isImageAttachment(attachment)) {
      return;
    }

    setPreviewAttachment({
      name: attachment.name || 'Image',
      type: attachment.type || 'image',
      size: attachment.size || 0,
      url: attachmentUrl,
    });
  }

  function closeAttachmentPreview() {
    setPreviewAttachment(null);
  }

  function getMessageAuthorLabel(message) {
    return message?.isOwn ? 'You' : message?.author ?? '';
  }

  function getTypingLabel(users) {
    const names = Array.from(
      new Set(
        (users ?? [])
          .map((entry) => `${entry?.userName ?? ''}`.trim())
          .filter(Boolean),
      ),
    );

    if (names.length === 0) {
      return '';
    }

    if (names.length === 1) {
      return `${names[0]} is typing`;
    }

    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing`;
    }

    return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing`;
  }

  function renderSearchControls() {
    const hasMatches = searchMatches.length > 0;

    return (
      <div className="chat-search" role="search">
        <Input
          className="chat-search__input"
          size="small"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search"
          aria-label="Search messages"
          contentBefore={<SearchRegular />}
        />
        {normalizedSearchQuery && (
          <Text
            size={200}
            className={`chat-search__count ${hasMatches ? '' : 'chat-search__count--empty'}`}
          >
            {searchResultLabel}
          </Text>
        )}
        <div className="chat-search__buttons">
          <Tooltip content="Previous match" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<ChevronUpRegular />}
              aria-label="Previous search match"
              disabled={!hasMatches}
              onClick={() => moveActiveSearchMatch(-1)}
            />
          </Tooltip>
          <Tooltip content="Next match" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<ChevronDownRegular />}
              aria-label="Next search match"
              disabled={!hasMatches}
              onClick={() => moveActiveSearchMatch(1)}
            />
          </Tooltip>
        </div>
      </div>
    );
  }

  function getReplyAuthorLabel(replyTo) {
    if (!replyTo) {
      return '';
    }

    const replyMessage = renderedMessages.find(
      (message) => (message.id ?? message.clientMessageId) === replyTo.messageId,
    );

    return replyMessage?.isOwn ? 'You' : replyTo.author;
  }

  function renderHighlightedBody(message) {
    const body = message.body ?? '';
    const segments = parseMessageSegments(body);

    if (!normalizedSearchQuery || !body) {
      return segments.map((segment, index) =>
        segment.type === 'link' ? (
          <a
            className="message-link"
            href={segment.href}
            key={`link-${index}`}
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openExternalLink(segment.href);
            }}
          >
            {segment.value}
          </a>
        ) : (
          <Fragment key={`text-${index}`}>{segment.value}</Fragment>
        ),
      );
    }

    const messageKey = getMessageKey(message);
    const query = normalizedSearchQuery.toLowerCase();
    const content = [];
    let textOffset = 0;

    segments.forEach((segment, index) => {
      if (segment.type === 'link') {
        content.push(
          <a
            className="message-link"
            href={segment.href}
            key={`link-${index}`}
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openExternalLink(segment.href);
            }}
          >
            {segment.value}
          </a>,
        );
        textOffset += segment.value.length;
        return;
      }

      const segmentText = segment.value;
      const segmentLower = segmentText.toLowerCase();
      let cursor = 0;
      let startIndex = segmentLower.indexOf(query);

      while (startIndex !== -1) {
        const absoluteStartIndex = textOffset + startIndex;

        if (startIndex > cursor) {
          content.push(
            <Fragment key={`text-${index}-${cursor}`}>
              {segmentText.slice(cursor, startIndex)}
            </Fragment>,
          );
        }

        const matchIndex = searchMatchIndexByKey.get(`${messageKey}:${absoluteStartIndex}`) ?? -1;
        const isActiveMatch = matchIndex === activeSearchIndex;

        content.push(
          <mark
            className={`message-search-hit ${isActiveMatch ? 'message-search-hit--active' : ''}`}
            key={`match-${index}-${startIndex}`}
            ref={(node) => {
              if (matchIndex < 0) {
                return;
              }

              if (node) {
                searchMatchRefs.current.set(matchIndex, node);
              } else {
                searchMatchRefs.current.delete(matchIndex);
              }
            }}
          >
            {segmentText.slice(startIndex, startIndex + normalizedSearchQuery.length)}
          </mark>,
        );

        cursor = startIndex + normalizedSearchQuery.length;
        startIndex = segmentLower.indexOf(query, cursor);
      }

      if (cursor < segmentText.length) {
        content.push(
          <Fragment key={`text-${index}-${cursor}`}>
            {segmentText.slice(cursor)}
          </Fragment>,
        );
      }

      textOffset += segmentText.length;
    });

    return content;
  }

  function renderReceipt(message) {
    if (!message?.isOwn || message.status === 'sending' || message.status === 'failed') {
      return null;
    }

    if (message.receiptState === 'read') {
      return (
        <span className="message-receipt message-receipt--read" aria-label="Message read">
          <CheckmarkRegular />
          <CheckmarkRegular />
        </span>
      );
    }

    if (message.receiptState === 'delivered') {
      return (
        <span className="message-receipt message-receipt--delivered" aria-label="Message delivered">
          <CheckmarkRegular />
          <CheckmarkRegular />
        </span>
      );
    }

    return (
      <span className="message-receipt message-receipt--sent" aria-label="Message sent">
        <CheckmarkRegular />
      </span>
    );
  }

  function renderMessage(message) {
    const authorLabel = getMessageAuthorLabel(message);
    const isDeleted = Boolean(message.isDeleted);
    if (isDeleted && message.deletedBy === currentUserId) {
      return null;
    }
    const isEmojiOnly = isEmojiOnlyMessage(message.body) && !message.attachments?.length;

    return (
      <article
        className={`message-row ${message.isOwn ? 'message-row--own' : ''} ${
          message.status === 'sending' ? 'message-row--pending' : ''
        } ${message.status === 'failed' ? 'message-row--failed' : ''} ${
          isEmojiOnly ? 'message-row--emoji-only' : ''
        } ${isDeleted ? 'message-row--deleted' : ''}`}
      >
        {!message.isOwn && (
          <div className="avatar-wrap">
            <UserAvatar name={authorLabel} emoji={message.authorAvatarEmoji} size={32} />
          </div>
        )}
        <div
          className={`message-bubble ${isEmojiOnly ? 'message-bubble--emoji-only' : ''} ${
            isDeleted ? 'message-bubble--deleted' : ''
          }`}
        >
          <div className="message-meta">
            <Text weight="semibold">{authorLabel}</Text>
            <div className="message-meta__actions">
              <Text className="muted-text">{message.time}</Text>
              {message.status === 'sending' ? (
                <Spinner size="tiny" />
              ) : isDeleted ? null : (
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<ChevronDownRegular />}
                      aria-label={`Message actions for ${authorLabel}`}
                      className="message-actions__trigger"
                    />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem
                        icon={<ArrowReplyRegular />}
                        onClick={() => setReplyToMessage(message)}
                      >
                        Reply
                      </MenuItem>
                      <MenuItem
                        icon={<CopyRegular />}
                        disabled={!message.body?.trim()}
                        onClick={() => copyMessageBody(message)}
                      >
                        Copy
                      </MenuItem>
                      {message.isOwn && (
                        <MenuItem
                          icon={<DeleteRegular />}
                          onClick={() => handleDeleteMessage(message)}
                        >
                          Delete
                        </MenuItem>
                      )}
                    </MenuList>
                  </MenuPopover>
                </Menu>
              )}
            </div>
          </div>
          {isDeleted ? (
            <Text className="message-body--deleted">This message was deleted</Text>
          ) : (
            <>
              {message.replyTo && (
                <div className="message-reply">
                  <Text size={200} weight="semibold">
                    Reply to {getReplyAuthorLabel(message.replyTo)}
                  </Text>
                  <Text size={200} className="muted-text">
                    {getReplyPreview(message.replyTo)}
                  </Text>
                </div>
              )}
              {message.body && (
                <Text className={isEmojiOnly ? 'message-body--emoji-only' : ''}>
                  {renderHighlightedBody(message)}
                </Text>
              )}
              {message.attachments?.length > 0 && (
                <div className="message-attachments">
                  {message.attachments.map((attachment) => (
                    <div className="attachment-card" key={attachment.id}>
                      {isImageAttachment(attachment) && getAttachmentUrl(attachmentBaseUrl, attachment) ? (
                        <button
                          type="button"
                          className="attachment-card__preview-button"
                          aria-label={`Preview ${attachment.name}`}
                          onClick={() => openAttachmentPreview(attachment)}
                        >
                          <img
                            className="attachment-card__preview"
                            src={getAttachmentUrl(attachmentBaseUrl, attachment)}
                            alt={attachment.name}
                            onLoad={() => {
                              if (!showScrollToBottom) {
                                scheduleScrollToBottom('auto');
                              }
                            }}
                          />
                        </button>
                      ) : (
                        <div className="attachment-card__preview attachment-card__preview--file">
                          <DocumentRegular />
                        </div>
                      )}
                      <span className="attachment-card__content">
                        <Text weight="semibold">{attachment.name}</Text>
                        <Text className="muted-text compact-text">
                          {formatFileSize(attachment.size)}
                        </Text>
                        <Text className="muted-text compact-text">
                          {attachment.type || 'File'}
                        </Text>
                      </span>
                      <div className="attachment-card__actions">
                        {(attachment.id || attachment.dataUrl || attachment.previewUrl) && (
                          <Tooltip content="Download" relationship="label">
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={<ArrowDownloadRegular />}
                              aria-label={`Download ${attachment.name}`}
                              onClick={() => downloadAttachment(attachmentBaseUrl, attachment)}
                            />
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {message.status === 'sending' && (
            <div className="message-status message-status--sending">
              <Spinner size="extra-tiny" />
              <Text size={200} className="muted-text">
                Sending...
              </Text>
            </div>
          )}
          {message.status === 'failed' && (
            <div className="message-status message-status--failed">
              <Text size={200}>Failed to send</Text>
              <Button
                appearance="subtle"
                size="small"
                icon={<DeleteRegular />}
                aria-label="Delete failed message"
                onClick={() => handleDeleteMessage(message)}
              />
            </div>
          )}
          {renderReceipt(message)}
        </div>
        {message.isOwn && (
          <div className="avatar-wrap">
            <UserAvatar name={authorLabel} emoji={message.authorAvatarEmoji} size={32} className="user-avatar--own" />
          </div>
        )}
      </article>
    );
  }

  function renderScreenShareButton() {
    if (!selectedMember || selectedMember.id === currentUserId) {
      return null;
    }

    const isActive = activeScreenShareForConversation;
    const label = isActive
      ? 'Stop screen share'
      : isScreenShareRequestPending
        ? 'Screen share request pending'
        : 'Screen sharing';

    if (isActive) {
      return (
        <Tooltip content={label} relationship="label">
          <Button
            appearance="secondary"
            size="small"
            icon={<DesktopRegular />}
            aria-label={label}
            onClick={onStopScreenShare}
          />
        </Tooltip>
      );
    }

    return (
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            size="small"
            icon={<DesktopRegular />}
            aria-label={label}
            disabled={!canStartScreenShare || isScreenShareRequestPending}
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<DesktopRegular />} onClick={onOfferToShareScreen}>
              Share your screen
            </MenuItem>
            <MenuItem icon={<DesktopRegular />} onClick={onRequestScreenShare}>
              Request screen sharing
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    );
  }

  function renderScreenSharePanel() {
    if (!activeScreenShareForConversation && !screenShare?.error) {
      return null;
    }

    return (
      <div
        className="screen-share-panel"
        role="status"
        aria-live="polite"
      >
        <div className="screen-share-panel__header">
          <div className="screen-share-panel__title">
            <DesktopRegular />
            <Text weight="semibold">
              {screenShareStatusLabel || screenShare.error || 'Screen share ended'}
            </Text>
          </div>
          <div className="screen-share-panel__actions">
            {isReceivingScreenShare && (
              <Tooltip
                content="Open full screen"
                relationship="label"
              >
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<FullScreenMaximizeRegular />}
                  aria-label="Open full screen"
                  onClick={openScreenShareViewer}
                />
              </Tooltip>
            )}
            {isReceivingScreenShare && (
              <Tooltip content={remoteControlButtonLabel} relationship="label">
                <Button
                  appearance={isControllingRemote ? 'secondary' : 'subtle'}
                  size="small"
                  disabled={!isControllingRemote && !canRequestRemoteControl}
                  aria-label={remoteControlButtonLabel}
                  onClick={
                    isControllingRemote
                      ? onStopRemoteControl
                      : () => {
                          openScreenShareViewer();
                          onRequestRemoteControl?.();
                        }
                  }
                >
                  {isControllingRemote ? 'Stop control' : 'Control'}
                </Button>
              </Tooltip>
            )}
            {activeScreenShareForConversation && (
              <Tooltip content="Stop screen share" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DismissCircleRegular />}
                  aria-label="Stop screen share"
                  onClick={onStopScreenShare}
                />
              </Tooltip>
            )}
          </div>
        </div>
        {isReceivingScreenShare ? (
          <video
            ref={screenShareVideoRef}
            className="screen-share-panel__video"
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div className="screen-share-panel__placeholder">
            <DesktopRegular />
            <Text className="muted-text compact-text">
              {screenShare?.error || 'Waiting for the peer connection.'}
            </Text>
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      className={`chat-window ${isDragging ? 'chat-window--dragging' : ''}`}
      aria-label="Messages"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="chat-header">
        {selectedMember ? (
          <div className="chat-header__title">
            <div className="chat-profile">
              <div className="avatar-wrap">
                <UserAvatar
                  name={selectedMember.displayName ?? selectedMember.name}
                  emoji={selectedMember.avatarEmoji}
                  initials={selectedMember.initials}
                  size={40}
                />
                <span className={`presence-dot presence-dot--${selectedMember.presence}`} />
              </div>
              <div className="chat-profile__content">
                <Text size={400} weight="semibold">
                  {selectedMember.displayName ?? selectedMember.name}
                </Text>
                <Text className="muted-text chat-header__subtitle">
                  {meta}
                </Text>
              </div>
            </div>
            {renderSearchControls()}
            {renderScreenShareButton()}
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<MoreHorizontalRegular />}
                  aria-label="Chat actions"
                  className="chat-header__menu-trigger"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={onClearChat}>Clear chat</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        ) : (
          <div className="chat-header__title">
            <div className="chat-header__title-text">
              <Text size={400} weight="semibold">
                {title}
              </Text>
              {meta && <Text className="muted-text chat-header__subtitle">{meta}</Text>}
            </div>
            {renderSearchControls()}
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<MoreHorizontalRegular />}
                  aria-label="Chat actions"
                  className="chat-header__menu-trigger"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={onClearChat}>Clear chat</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        )}
      </header>

      {unreadCount > 0 && (
        <div className="unread-banner" role="status" aria-live="polite">
          <Text weight="semibold">
            {unreadCount} unread message{unreadCount === 1 ? '' : 's'}
          </Text>
        </div>
      )}

      <div className="message-list-shell">
        {renderScreenSharePanel()}
        <div
          className="message-list"
          ref={messageListRef}
          role="log"
          aria-live="polite"
          onScroll={handleMessageListScroll}
        >
          {visibleMessages.map((message, index) => {
            const dayKey = getMessageDayKey(message);
            const previousMessage = visibleMessages[index - 1];
            const shouldShowDateSeparator =
              index === 0 || getMessageDayKey(previousMessage) !== dayKey;

            return (
              <Fragment key={message.id ?? message.clientMessageId}>
                {shouldShowDateSeparator && (
                  <div className="date-separator" role="separator" aria-label={getDateSeparatorLabel(message)}>
                    <Text size={200} weight="semibold">
                      {getDateSeparatorLabel(message)}
                    </Text>
                  </div>
                )}
                {renderMessage(message)}
              </Fragment>
            );
          })}
        </div>

        {showScrollToBottom && (
          <Tooltip content="Jump to latest messages" relationship="label">
            <button
              type="button"
              className="scroll-to-bottom"
              aria-label="Jump to latest messages"
              onClick={() => scrollToBottom('smooth')}
            >
              <ChevronDownRegular />
            </button>
          </Tooltip>
        )}
      </div>

      <footer className="message-composer">
        {replyTarget && (
          <div className="composer-reply">
            <div className="composer-reply__bar" />
            <div className="composer-reply__content">
              <Text size={200} weight="semibold">
                Replying to {getMessageAuthorLabel(replyTarget)}
              </Text>
              <Text size={200} className="muted-text">
                {getReplyPreview(buildReplySnapshot(replyTarget))}
              </Text>
            </div>
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissCircleRegular />}
              aria-label="Cancel reply"
              onClick={() => setReplyTarget(null)}
            />
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <div className="attachment-chip" key={attachment.id}>
                <DocumentRegular />
                <span>{attachment.name}</span>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DismissCircleRegular />}
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => removeAttachment(attachment.id)}
                />
              </div>
            ))}
          </div>
        )}
        {typingUsers.length > 0 && (
          <div className="typing-indicator" aria-live="polite" role="status">
            <span className="typing-indicator__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <Text size={200} className="typing-indicator__text">
              {getTypingLabel(typingUsers)}
            </Text>
          </div>
        )}
        <div className="composer-row">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            multiple
            onChange={handleFileChange}
          />
          <Tooltip content="Attach files" relationship="label">
            <Button
              appearance="subtle"
              icon={<AttachRegular />}
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
            />
          </Tooltip>
          <Tooltip content="Emoji" relationship="label">
            <Button
              appearance={isEmojiPickerOpen ? 'secondary' : 'subtle'}
              icon={<EmojiRegular />}
              aria-label="Choose emoji"
              aria-expanded={isEmojiPickerOpen}
              onClick={handleEmojiButtonClick}
            />
          </Tooltip>
          <Input
            ref={draftInputRef}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a message"
            aria-label="Message"
          />
          <Button appearance="primary" icon={<SendRegular />} onClick={sendMessage} disabled={!canSend}>
            Send
          </Button>
        </div>
        {isEmojiPickerOpen && (
          <div className="emoji-picker-popover">
            <EmojiPicker
              height={360}
              width="100%"
              previewConfig={{ showPreview: false }}
              onEmojiClick={insertEmoji}
            />
          </div>
        )}
      </footer>

      {isDragging && (
        <div className="drop-overlay">
          <AttachRegular />
          <Text weight="semibold">Drop files to attach</Text>
        </div>
      )}

      <Dialog open={Boolean(previewAttachment)} onOpenChange={(_, data) => !data.open && closeAttachmentPreview()}>
        <DialogSurface className="dialog-surface attachment-preview-dialog">
          <DialogBody>
            <DialogTitle>{previewAttachment?.name ?? 'Image preview'}</DialogTitle>
            <DialogContent>
              {previewAttachment && (
                <div className="attachment-preview">
                  <img
                    className="attachment-preview__image"
                    src={previewAttachment.url}
                    alt={previewAttachment.name}
                  />
                  <div className="attachment-preview__meta">
                    <Text className="muted-text compact-text">{previewAttachment.type}</Text>
                    <Text className="muted-text compact-text">{formatFileSize(previewAttachment.size)}</Text>
                  </div>
                  <div className="attachment-preview__actions">
                    <Button appearance="secondary" onClick={closeAttachmentPreview}>
                      Close
                    </Button>
                    <Button
                      appearance="primary"
                      onClick={() => downloadAttachment(attachmentBaseUrl, {
                        id: '',
                        name: previewAttachment.name,
                        size: previewAttachment.size,
                        type: previewAttachment.type,
                        dataUrl: previewAttachment.url,
                      })}
                    >
                      Download
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
