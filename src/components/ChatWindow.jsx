import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Text,
  Title3,
  Tooltip,
} from '@fluentui/react-components';
import {
  AttachRegular,
  ChevronDownRegular,
  DismissCircleRegular,
  DeleteRegular,
  DocumentRegular,
  ArrowDownloadRegular,
  ArrowReplyRegular,
  MoreHorizontalRegular,
  SendRegular,
} from '@fluentui/react-icons';

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

export default function ChatWindow({
  title,
  meta,
  selectedMember,
  currentUserName,
  conversationKey,
  messages,
  onSendMessage,
  onDeleteMessage,
  onClearChat,
  clearToken,
  unreadCount = 0,
  attachmentBaseUrl,
}) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [pendingMessages, setPendingMessages] = useState([]);
  const fileInputRef = useRef(null);
  const draftInputRef = useRef(null);
  const pendingObjectUrlsRef = useRef(new Set());

  const canSend = draft.trim().length > 0 || attachments.length > 0;

  useEffect(() => {
    setDraft('');
    setAttachments([]);
    setReplyTarget(null);
    setIsDragging(false);
    pendingObjectUrlsRef.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    pendingObjectUrlsRef.current.clear();
    setPendingMessages([]);
  }, [conversationKey]);

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
  }, [clearToken]);

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
    draftInputRef.current?.focus();

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

  function removeAttachment(id) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function handleFileChange(event) {
    addAttachments(event.target.files);
    event.target.value = '';
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

  function setReplyToMessage(message) {
    setReplyTarget(message);
    draftInputRef.current?.focus();
  }

  const renderedMessages = [...messages, ...pendingMessages];

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
          <div className="chat-profile">
            <div className="avatar-wrap">
              <Avatar name={selectedMember.name} initials={selectedMember.initials} size={40} />
              <span className={`presence-dot presence-dot--${selectedMember.presence}`} />
            </div>
            <div className="chat-profile__content">
              <Title3>{selectedMember.name}</Title3>
              <Text className="muted-text chat-header__subtitle">
                {meta}
              </Text>
            </div>
          </div>
        ) : (
          <div className="chat-header__title">
            <div className="chat-header__title-text">
              <Title3>{title}</Title3>
              {meta && <Text className="muted-text chat-header__subtitle">{meta}</Text>}
            </div>
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

      <div className="message-list" role="log" aria-live="polite">
        {renderedMessages.map((message) => (
          <article
            className={`message-row ${message.isOwn ? 'message-row--own' : ''} ${
              message.status === 'sending' ? 'message-row--pending' : ''
            } ${message.status === 'failed' ? 'message-row--failed' : ''}`}
            key={message.id ?? message.clientMessageId}
          >
            {!message.isOwn && <Avatar name={message.author} size={32} />}
            <div className="message-bubble">
              <div className="message-meta">
                <Text weight="semibold">{message.author}</Text>
                <div className="message-meta__actions">
                  <Text className="muted-text">{message.time}</Text>
                  {message.status === 'sending' ? (
                    <Spinner size="tiny" />
                  ) : (
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={<ChevronDownRegular />}
                          aria-label={`Message actions for ${message.author}`}
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
              {message.replyTo && (
                <div className="message-reply">
                  <Text size={200} weight="semibold">
                    Reply to {message.replyTo.author}
                  </Text>
                  <Text size={200} className="muted-text">
                    {getReplyPreview(message.replyTo)}
                  </Text>
                </div>
              )}
              {message.body && <Text>{message.body}</Text>}
              {message.attachments?.length > 0 && (
                <div className="message-attachments">
                  {message.attachments.map((attachment) => (
                    <div className="attachment-card" key={attachment.id}>
                      {isImageAttachment(attachment) && getAttachmentUrl(attachmentBaseUrl, attachment) ? (
                        <img
                          className="attachment-card__preview"
                          src={getAttachmentUrl(attachmentBaseUrl, attachment)}
                          alt={attachment.name}
                        />
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
            </div>
            {message.isOwn && <Avatar name={message.author} color="brand" size={32} />}
          </article>
        ))}
      </div>

      <footer className="message-composer">
        {replyTarget && (
          <div className="composer-reply">
            <div className="composer-reply__bar" />
            <div className="composer-reply__content">
              <Text size={200} weight="semibold">
                Replying to {replyTarget.author}
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
          <Input
            ref={draftInputRef}
            value={draft}
            onChange={(_, data) => setDraft(data.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message"
            aria-label="Message"
          />
          <Button appearance="primary" icon={<SendRegular />} onClick={sendMessage} disabled={!canSend}>
            Send
          </Button>
        </div>
      </footer>

      {isDragging && (
        <div className="drop-overlay">
          <AttachRegular />
          <Text weight="semibold">Drop files to attach</Text>
        </div>
      )}
    </section>
  );
}
