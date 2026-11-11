import { defineConfig } from 'vite';

// Preact remplace React (même API, environ 120 Ko de moins à télécharger et à lancer).
const preact = {
  'react-dom/client': 'preact/compat/client',
  'react-dom': 'preact/compat',
  'react/jsx-runtime': 'preact/jsx-runtime',
  'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
  react: 'preact/compat',
};

export default defineConfig({
  resolve: { alias: Object.entries(preact).map(([find, replacement]) => ({ find: new RegExp(`^${find}$`), replacement })) },
  build: { cssMinify: 'lightningcss', target: 'safari16', modulePreload: { polyfill: false }, reportCompressedSize: false },
});
