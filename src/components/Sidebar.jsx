import {
  Badge,
  Button,
  Divider,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  Tooltip,
} from '@fluentui/react-components';
import {
  AddRegular,
  DeleteRegular,
  EditRegular,
  MoreHorizontalRegular,
  PeopleCommunityRegular,
  PersonRegular,
  ArrowClockwiseRegular,
  SettingsRegular,
} from '@fluentui/react-icons';
import UserAvatar from './UserAvatar.jsx';

function getGroupInitials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function Sidebar({
  profile,
  users,
  members,
  groups,
  selectedGroupId,
  selectedMemberId,
  onSelectGroup,
  onSelectMember,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  canCreateGroup = true,
  onOpenProfile,
  onRefreshUi,
  isRefreshingUi = false,
  onLogout,
}) {
  return (
    <aside className="sidebar" aria-label="Chat navigation">
      <div className="sidebar__content">
        <section className="sidebar-section">
          <div className="section-title">
            <PersonRegular />
            <Text weight="semibold">Members</Text>
          </div>
          <div className="user-list">
            {members.length > 0 ? (
              members.map((user) => {
                const isCurrentUser = user.id === profile.id;
                const displayName = isCurrentUser ? 'You' : user.name;

                return (
                  <button
                    type="button"
                    className={`user-row ${user.id === selectedMemberId ? 'user-row--active' : ''}`}
                    key={user.id}
                    onClick={() => onSelectMember(user.id)}
                  >
                    <div className="avatar-wrap">
                      <UserAvatar
                        name={displayName}
                        emoji={user.avatarEmoji}
                        initials={isCurrentUser ? 'Y' : user.initials}
                        size={28}
                      />
                      <span className={`presence-dot presence-dot--${user.presence}`} />
                    </div>
                    <div className="user-row__content">
                      <Text>{displayName}</Text>
                      {user.isHost && <Badge appearance="filled">Host</Badge>}
                    </div>
                    {user.unread > 0 && <Badge appearance="filled">{user.unread}</Badge>}
                  </button>
                );
              })
            ) : (
              <Text className="muted-text compact-text">No members available</Text>
            )}
          </div>
        </section>

        <Divider />

        <section className="sidebar-section sidebar-section--groups">
          <div className="section-title section-title--with-action">
            <span>
              <PeopleCommunityRegular />
              <Text weight="semibold">Groups</Text>
            </span>
            {canCreateGroup && (
              <Tooltip content="Create group" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<AddRegular />}
                  aria-label="Create group"
                  onClick={onCreateGroup}
                />
              </Tooltip>
            )}
          </div>

          <div className="group-list">
            {groups.map((group) => (
              <div
                className={`group-row group-row--${group.color} ${
                  group.id === selectedGroupId ? 'group-row--active' : ''
                }`}
                key={group.id}
              >
                <button
                  className="group-row__button"
                  type="button"
                  onClick={() => onSelectGroup(group.id)}
                >
                  <span className="group-row__mark">{getGroupInitials(group.name)}</span>
                  <span className="group-row__content">
                    <span>{group.name}</span>
                    <small>{group.description}</small>
                  </span>
                  {group.unread > 0 && <Badge appearance="filled">{group.unread}</Badge>}
                </button>
                {canCreateGroup && onEditGroup && (
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<MoreHorizontalRegular />}
                        aria-label={`Group actions for ${group.name}`}
                        className="group-row__menu"
                      />
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        <MenuItem icon={<EditRegular />} onClick={() => onEditGroup(group.id)}>
                          Edit
                        </MenuItem>
                        <MenuItem icon={<DeleteRegular />} onClick={() => onDeleteGroup?.(group.id)}>
                          Delete
                        </MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                )}
              </div>
            ))}
          </div>

          {canCreateGroup && (
            <Button appearance="secondary" icon={<AddRegular />} onClick={onCreateGroup}>
              Create Group
            </Button>
          )}
        </section>
      </div>

      <section className="profile-section">
        <div className="profile-section__identity">
          <UserAvatar name={profile.name} emoji={profile.avatarEmoji} initials={profile.initials} />
          <div className="profile-section__text">
            <Text weight="semibold">{profile.name}</Text>
          </div>
        </div>
        <div className="profile-section__actions">
          <Tooltip content="Refresh UI" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowClockwiseRegular />}
              aria-label="Refresh UI"
              className={`profile-section__refresh ${isRefreshingUi ? 'profile-section__refresh--spinning' : ''}`}
              onClick={onRefreshUi}
              disabled={isRefreshingUi}
            />
          </Tooltip>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                size="small"
                icon={<SettingsRegular />}
                aria-label="Open profile menu"
                className="profile-section__settings"
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={onOpenProfile}>Profile</MenuItem>
                <MenuItem onClick={onLogout}>Logout</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </section>
    </aside>
  );
}
