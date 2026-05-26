import Sidebar from './Sidebar.jsx';
import ChatWindow from './ChatWindow.jsx';

export default function ChatLayout({
  profile,
  users,
  groups,
  selectedGroup,
  selectedMember,
  messages,
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
  attachmentBaseUrl,
}) {
  if (!selectedGroup && !selectedMember) {
    return null;
  }

  const isDirectConversation = Boolean(selectedMember);
  const title = isDirectConversation ? selectedMember.name : selectedGroup.name;
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
        selectedMember={selectedMember}
        currentUserName={profile.name}
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
        attachmentBaseUrl={attachmentBaseUrl}
      />
    </main>
  );
}
