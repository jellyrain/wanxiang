import './styles/catalogs.css';
import {initializeTheme} from './theme-runtime.ts';
import {initializeRuntime} from './runtime.ts';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import {BrowserConnection} from './BrowserConnection.tsx';
import '@xyflow/react/dist/style.css';
import './styles/demo.css';
import './styles/desktop.css';
import './styles/window-chrome.css';
import './styles/customization.css';
import './styles/themes.css';
import './styles/attributes.css';
import './styles/journey.css';

initializeTheme();
initializeRuntime();
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserConnection><App /></BrowserConnection></React.StrictMode>);

import './styles/relations.css';

import './styles/fields.css';
import './styles/layout.css';
import './styles/world.css';
import './styles/maps.css';

import './styles/timeline.css';

import './styles/chapters.css';

import './styles/gallery.css';
import './styles/overview.css';

import './styles/work-settings.css';
import './styles/backup.css';
import './styles/history.css';
import './styles/transfer.css';
import './styles/settings.css';

import './styles/appearance.css';
import './styles/polish.css';
import './styles/markdown.css';
import './styles/deletion.css';

import './styles/library-polish.css';
import './styles/theme-settings.css';
