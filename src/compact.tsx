import React from 'react';
import ReactDOM from 'react-dom/client';
import CompactWindow from './components/CompactWindow';
import './index.css';

ReactDOM.createRoot(document.getElementById('compact-root')!).render(
  <React.StrictMode>
    <CompactWindow />
  </React.StrictMode>
);
