import { useEffect, useState } from 'react';
import { Button, Field, Input, Text, Title1 } from '@fluentui/react-components';
import { ChatMultipleRegular, DesktopRegular, PlugConnectedRegular } from '@fluentui/react-icons';

export default function StartScreen({
  onStartHost,
  onJoinHost,
  isBusy,
  error,
  initialValues,
}) {
  const [userName, setUserName] = useState(initialValues.userName);
  const [hostAddress, setHostAddress] = useState(initialValues.hostAddress);
  const [port, setPort] = useState(initialValues.port);

  useEffect(() => {
    setUserName(initialValues.userName);
    setHostAddress(initialValues.hostAddress);
    setPort(initialValues.port);
  }, [initialValues]);

  const canStart = userName.trim().length > 0 && port.trim().length > 0 && !isBusy;
  const canJoin =
    userName.trim().length > 0 &&
    hostAddress.trim().length > 0 &&
    port.trim().length > 0 &&
    !isBusy;

  function submitHost() {
    if (!canStart) return;
    onStartHost({ userName: userName.trim(), port: port.trim() });
  }

  function submitJoin() {
    if (!canJoin) return;
    onJoinHost({
      userName: userName.trim(),
      hostAddress: hostAddress.trim(),
      port: port.trim(),
    });
  }

  return (
    <main className="start-screen">
      <section className="start-panel" aria-labelledby="start-title">
        <div className="start-panel__header">
          <div className="app-mark">
            <ChatMultipleRegular />
          </div>
          <div className="start-panel__title">
            <Title1 id="start-title">WireChat</Title1>
            <Text className="muted-text">Connect on your local network.</Text>
          </div>
        </div>

        <div className="start-panel__form">
          <Field label="User name" required>
            <Input
              value={userName}
              onChange={(_, data) => setUserName(data.value)}
              placeholder="Display name"
              autoFocus
            />
          </Field>

          <Field label="Port" required>
            <Input
              value={port}
              onChange={(_, data) => setPort(data.value)}
              placeholder="3001"
            />
          </Field>

          <Field label="Host address for join">
            <Input
              value={hostAddress}
              onChange={(_, data) => setHostAddress(data.value)}
              placeholder="192.168.1.42"
            />
          </Field>

          <div className="start-panel__actions">
            <Button appearance="primary" icon={<DesktopRegular />} disabled={!canStart} onClick={submitHost}>
              {isBusy ? 'Starting...' : 'Start Host'}
            </Button>
            <Button icon={<PlugConnectedRegular />} disabled={!canJoin} onClick={submitJoin}>
              {isBusy ? 'Connecting...' : 'Join Host'}
            </Button>
          </div>
          {error && <Text className="start-panel__error">{error}</Text>}
        </div>
      </section>
    </main>
  );
}
