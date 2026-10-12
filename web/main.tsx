import React from 'react';
import {createRoot} from 'react-dom/client';
import './jade.css';
import App from './App.tsx';
import {AuthGate} from './auth.tsx';
import Consent from './Consent.tsx';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate>{()=>location.pathname.startsWith('/oauth/consent')?<Consent/>:<App/>}</AuthGate></React.StrictMode>);
