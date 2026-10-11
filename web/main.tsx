import React from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import App from './App.tsx';
import {AuthGate} from './auth.tsx';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate>{()=><App/>}</AuthGate></React.StrictMode>);
