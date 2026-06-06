import Sidebar from './Sidebar.jsx';
import ChatWindow from './ChatWindow.jsx';

export default function ChatLayout({
  profile,
  users,
  groups,
  selectedGroup,
  selectedMember,
  messages,
  currentUserId,
  typingUsers,
  onTypingChange,
  onSelectGroup,
  onSelectMember,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  canCreateGroup,
  onOpenProfile,
  onRefreshUi,
  isRefreshingUi,
  onLogout,
  onSendMessage,
  onDeleteMessage,
  onClearChat,
  clearToken,
  uiRefreshToken,
  unreadCount,
  attachmentBaseUrl,
  screenShare,
  pendingScreenShareRequest,
  remoteControl,
  pendingRemoteControlRequest,
  onOfferToShareScreen,
  onRequestScreenShare,
  onStartScreenShare,
  onStopScreenShare,
  onRequestRemoteControl,
  onSendRemoteControlInput,
  onStopRemoteControl,
}) {
  if (!selectedGroup && !selectedMember) {
    return null;
  }

  const isDirectConversation = Boolean(selectedMember);
  const selectedMemberForChat =
    selectedMember && selectedMember.id === profile.id
      ? { ...selectedMember, displayName: 'You', initials: 'Y' }
      : selectedMember;
  const title = isDirectConversation
    ? selectedMemberForChat.displayName ?? selectedMemberForChat.name
    : selectedGroup.name;
  const meta = isDirectConversation
    ? `Direct message · ${selectedMember.presence === 'available' ? 'Online' : 'Offline'}`
    : `${selectedGroup.memberIds.length} members`;

  return (
    <main className="chat-layout">
      <Sidebar
        profile={profile}
        users={users}
        members={users}
        groups={groups}
        selectedGroupId={selectedGroup?.id ?? null}
        selectedMemberId={selectedMember?.id ?? null}
        onSelectGroup={onSelectGroup}
        onSelectMember={onSelectMember}
        onCreateGroup={onCreateGroup}
        onEditGroup={onEditGroup}
        onDeleteGroup={onDeleteGroup}
        canCreateGroup={canCreateGroup}
        onOpenProfile={onOpenProfile}
        onRefreshUi={onRefreshUi}
        isRefreshingUi={isRefreshingUi}
        onLogout={onLogout}
      />
      <ChatWindow
        title={title}
        meta={meta}
        selectedMember={selectedMemberForChat}
        currentUserName={profile.name}
        currentUserAvatarEmoji={profile.avatarEmoji}
        currentUserId={currentUserId}
        typingUsers={typingUsers}
        onTypingChange={onTypingChange}
        conversationKey={
          isDirectConversation
            ? `dm:${profile.id}:${selectedMember.id}`
            : `group:${selectedGroup?.id ?? 'unknown'}`
        }
        messages={messages}
        onSendMessage={onSendMessage}
        onDeleteMessage={onDeleteMessage}
        onClearChat={onClearChat}
        clearToken={clearToken}
        uiRefreshToken={uiRefreshToken}
        unreadCount={unreadCount}
        attachmentBaseUrl={attachmentBaseUrl}
        screenShare={screenShare}
        pendingScreenShareRequest={pendingScreenShareRequest}
        remoteControl={remoteControl}
        pendingRemoteControlRequest={pendingRemoteControlRequest}
        onOfferToShareScreen={onOfferToShareScreen}
        onRequestScreenShare={onRequestScreenShare}
        onStartScreenShare={onStartScreenShare}
        onStopScreenShare={onStopScreenShare}
        onRequestRemoteControl={onRequestRemoteControl}
        onSendRemoteControlInput={onSendRemoteControlInput}
        onStopRemoteControl={onStopRemoteControl}
      />
    </main>
  );
}
