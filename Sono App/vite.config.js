import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Version affichée dans Réglages : celle de package.json (la même que l’app et ses installateurs).
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;

// Preact remplace React (même API, environ 120 Ko de moins à charger au démarrage).
const preact = {
  'react-dom/client': 'preact/compat/client',
  'react-dom': 'preact/compat',
  'react/jsx-runtime': 'preact/jsx-runtime',
  'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
  react: 'preact/compat',
};

export default defineConfig({
  define: { __SONO_VERSION__: JSON.stringify(version) },
  resolve: { alias: Object.entries(preact).map(([find, replacement]) => ({ find: new RegExp(`^${find}$`), replacement })) },
  // « npm run dev » : l’interface en direct, l’API et le temps réel servis par l’app (serveur Rust sur le port 7100).
  server: { proxy: { '/api': 'http://127.0.0.1:7100', '/ws': { target: 'ws://127.0.0.1:7100', ws: true } } },
  build: { cssMinify: 'lightningcss', target: 'chrome130', modulePreload: { polyfill: false }, reportCompressedSize: false },
});
