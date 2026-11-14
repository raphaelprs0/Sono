import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Adresse courte « /k7f2q » : le serveur dit quelle session elle ouvre, ou vers quel ordinateur renvoyer (lien
// « Internet » d’une session hébergée sur un ordinateur). Inconnue : la page « session terminée » s’affiche.
const shortToken = window.location.pathname.match(/^\/([a-km-np-z2-9]{5})\/?$/i)?.[1]?.toLowerCase();
if (shortToken) {
  const found = await fetch(`/api/join/${shortToken}`).then((response) => (response.ok ? response.json() : null)).catch(() => null);
  if (found?.url) {
    window.location.replace(found.url + window.location.hash);
    await new Promise(() => {});
  }
  window.sonoInvite = found?.code || 'SONO-0000';
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
