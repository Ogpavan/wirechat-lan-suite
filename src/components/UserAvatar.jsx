function getInitials(name) {
  return `${name ?? ''}`
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function UserAvatar({ name, emoji, initials, size = 32, className = '' }) {
  const fallback = initials || getInitials(name) || '?';
  const content = `${emoji ?? ''}`.trim() || fallback;

  return (
    <span
      className={`user-avatar ${className}`.trim()}
      style={{ '--user-avatar-size': `${size}px` }}
      aria-label={name}
      role="img"
    >
      <span className="user-avatar__glyph">{content}</span>
    </span>
  );
}
