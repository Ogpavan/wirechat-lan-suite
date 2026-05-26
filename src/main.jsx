import React from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import App from './App.jsx';
import './styles.css';

const fluentTheme = {
  ...webLightTheme,
  colorBrandBackground: '#2563EB',
  colorBrandBackgroundHover: '#1D4ED8',
  colorBrandBackgroundPressed: '#1E40AF',
  colorNeutralBackground1: '#FFFFFF',
  colorNeutralBackground2: '#F7F7F7',
  colorNeutralBackground3: '#F3F3F3',
  colorNeutralStroke1: '#DADADA',
  colorNeutralForeground1: '#1F1F1F',
  colorNeutralForeground2: '#666666',
  borderRadiusSmall: '4px',
  borderRadiusMedium: '6px',
  borderRadiusLarge: '6px',
  borderRadiusXLarge: '6px',
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FluentProvider theme={fluentTheme}>
      <App />
    </FluentProvider>
  </React.StrictMode>,
);
