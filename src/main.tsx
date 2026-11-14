import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './web/WebApp';
import './style.css';
import './dashboard.css';
import './interaction-effects.css';
import './web/web.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
