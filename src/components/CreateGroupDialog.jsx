import { useState } from 'react';
import { Button, Field, Input, Textarea } from '@fluentui/react-components';

export default function CreateGroupDialog({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function submitGroup(event) {
    event.preventDefault();
    if (!name.trim()) return;

    onCreate({
      name: name.trim(),
      description: description.trim(),
    });
  }

  return (
    <form className="create-group-form" onSubmit={submitGroup}>
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
      <div className="dialog-actions">
        <Button appearance="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button appearance="primary" type="submit" disabled={!name.trim()}>
          Create
        </Button>
      </div>
    </form>
  );
}
