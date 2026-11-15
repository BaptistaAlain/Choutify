import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

const BUILD_ID = process.env.BUILD_ID || Date.now().toString(36);
const APP_VERSION = process.env.APP_VERSION || 'dev';

// Injecte l'identifiant de build dans le service worker et écrit version.json,
// que l'app consulte pour proposer la mise à jour quand elle reste ouverte.
function buildId(): Plugin {
  let outDir = 'dist';
  return {
    name: 'choutify-build-id',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const sw = resolve(outDir, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD_ID__', BUILD_ID));
      writeFileSync(resolve(outDir, 'version.json'), JSON.stringify({ build: BUILD_ID, version: APP_VERSION }));
    },
  };
}

// Chemins relatifs : l'app fonctionne quel que soit le sous-dossier GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [preact(), buildId()],
  build: { target: 'es2020', sourcemap: false },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
});
