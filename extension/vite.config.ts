import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Two-pass build. MV3 manifest-declared content scripts load as *classic*
// scripts, so content.js must be a single self-contained file with no `import`
// statements. When the side panel and the content script share a module
// (src/shared/harvest.ts), Rollup would hoist it into a chunk that content.js
// imports — which throws "Cannot use import statement outside a module" and
// kills the whole content script. So the content script is built on its own
// pass (CONTENT_BUILD=1) as an IIFE, which inlines every dependency; the side
// panel + background build as ES modules in the main pass. See package.json
// scripts: the content pass runs first, then the main pass appends to dist/.
const contentBuild = process.env.CONTENT_BUILD === '1';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Cleaning is done once by the npm script (rm -rf dist) so the two passes
    // don't wipe each other's output.
    emptyOutDir: false,
    target: 'esnext',
    minify: false,
    rollupOptions: contentBuild
      ? {
          input: { content: resolve(import.meta.dirname, 'src/content.ts') },
          output: {
            format: 'iife',
            entryFileNames: 'content.js',
            inlineDynamicImports: true,
          },
        }
      : {
          input: {
            sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
            background: resolve(import.meta.dirname, 'src/background.ts'),
          },
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
  },
});
