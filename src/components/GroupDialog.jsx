import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Field, Input, Textarea, Text } from '@fluentui/react-components';

export default function GroupDialog({ group, users, onSave, onDelete, onCancel }) {
  const isEditMode = Boolean(group?.id);
  const initialMemberIds = useMemo(
    () => (isEditMode ? group.memberIds ?? [] : users.map((user) => user.id)),
    [group, isEditMode, users],
  );
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [memberIds, setMemberIds] = useState(initialMemberIds);

  useEffect(() => {
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
    setMemberIds(initialMemberIds);
  }, [group, initialMemberIds]);

  function toggleMember(memberId) {
    setMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  }

  function submitGroup(event) {
    event.preventDefault();
    if (!name.trim()) return;

    onSave({
      groupId: group?.id ?? null,
      name: name.trim(),
      description: description.trim(),
      memberIds,
    });
  }

  return (
    <form className="group-dialog" onSubmit={submitGroup}>
      <Field label="Group name" required>
        <Input
          value={name}
          onChange={(_, data) => setName(data.value)}
          placeholder="Project updates"
          autoFocus
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={description}
          onChange={(_, data) => setDescription(data.value)}
          placeholder="Optional"
          resize="vertical"
        />
      </Field>

      <div className="group-dialog__members">
        <Text weight="semibold">Members</Text>
        <div className="group-dialog__member-list">
          {users.map((user) => (
            <Checkbox
              key={user.id}
              label={user.name}
              checked={memberIds.includes(user.id)}
              onChange={() => toggleMember(user.id)}
            />
          ))}
        </div>
      </div>

      <div className="dialog-actions dialog-actions--split">
        <div>
          {isEditMode && (
            <Button appearance="secondary" type="button" onClick={() => onDelete(group.id)}>
              Delete
            </Button>
          )}
        </div>
        <div className="dialog-actions__right">
          <Button appearance="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button appearance="primary" type="submit" disabled={!name.trim()}>
            {isEditMode ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </form>
  );
}
