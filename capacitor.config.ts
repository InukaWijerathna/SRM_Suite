import type { CapacitorConfig } from '@capacitor/cli';

// App ID is a reverse-DNS identifier and becomes the Android package name. Change it before
// the first Play Store upload if you have an organisation domain to use instead — it cannot
// be changed afterwards without publishing as a new app.
const config: CapacitorConfig = {
  appId: 'com.srmsuite.app',
  appName: 'SRM Suite',
  webDir: 'dist',
  android: {
    // The PWA's own service worker is redundant in the native app (its assets are already
    // bundled on-device) and is skipped at runtime; this just keeps the WebView on a
    // consistent origin for localStorage.
    allowMixedContent: false,
  },
};

export default config;
