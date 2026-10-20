import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { unlockAudio } from './services/audio';
import { runTopBackHandler } from './lib/backButton';
import './index.css';

// Offline support: the service worker precaches the app shell and updates itself silently.
// Skipped inside the native Android app — its assets are already bundled on-device (updates
// arrive through the Play Store, not a service worker), and the native WebView's own asset
// handler makes a second caching layer redundant rather than helpful.
if (!Capacitor.isNativePlatform()) {
  registerSW({ immediate: true });
}

// Android hardware/gesture back button: without a listener, Capacitor exits the app on the
// very first press (there's no browser history to fall back to). The registered stack
// (src/lib/backButton.ts) closes whatever's open-most first; only once nothing is open does
// back actually exit, matching what every other Android app does at its home screen. No-op
// on web/iOS — nothing calls addListener there except this native-only branch.
if (Capacitor.isNativePlatform()) {
  CapacitorApp.addListener('backButton', () => {
    if (!runTopBackHandler()) CapacitorApp.exitApp().catch(() => {});
  });
}

// Browsers block audio until a gesture; the first tap anywhere unlocks the scanner beeps.
window.addEventListener('pointerdown', unlockAudio, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
