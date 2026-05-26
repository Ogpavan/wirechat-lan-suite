import { Avatar, Divider, Text, Title3 } from '@fluentui/react-components';
import { InfoRegular, PeopleRegular, SendRegular } from '@fluentui/react-icons';

export default function RightPanel({ group, members, profile, selectedMemberId, onSelectMember }) {
  return (
    <aside className="right-panel" aria-label="Group details">
      <section className="info-block">
        <div className="section-title">
          <InfoRegular />
          <Title3>Group info</Title3>
        </div>
        <Text className="muted-text">{group.description}</Text>
        <dl className="metadata-list">
          <div>
            <dt>Group name</dt>
            <dd>{group.name}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>LAN</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd>{profile.endpoint}</dd>
          </div>
        </dl>
      </section>

      <Divider />

      <section className="info-block">
        <div className="section-title">
          <PeopleRegular />
          <Title3>Members</Title3>
        </div>
        <div className="member-list">
          {members.map((member) => (
            <button
              type="button"
              className={`member-row ${member.id === selectedMemberId ? 'member-row--active' : ''}`}
              key={member.id}
              aria-label={`Message ${member.name}`}
              onClick={() => onSelectMember(member.id)}
            >
              <div className="avatar-wrap">
                <Avatar name={member.name} initials={member.initials} size={32} />
                <span className={`presence-dot presence-dot--${member.presence}`} />
              </div>
              <div className="member-row__content">
                <Text>{member.name}</Text>
              </div>
              <span className="member-row__action" aria-hidden="true">
                <SendRegular />
              </span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
