import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { unlockAudio } from './services/audio';
import './index.css';

// Offline support: the service worker precaches the app shell and updates itself silently.
// Skipped inside the native Android app — its assets are already bundled on-device (updates
// arrive through the Play Store, not a service worker), and the native WebView's own asset
// handler makes a second caching layer redundant rather than helpful.
if (!Capacitor.isNativePlatform()) {
  registerSW({ immediate: true });
}

// Browsers block audio until a gesture; the first tap anywhere unlocks the scanner beeps.
window.addEventListener('pointerdown', unlockAudio, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
