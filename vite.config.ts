import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

export default defineConfig({
  plugins: [react()],
  // base: './' ensures Vite outputs relative asset paths (e.g. ./assets/main.js)
  // instead of absolute paths (/assets/main.js). Absolute paths break when
  // Electron loads the bundle via loadFile() — the file:// protocol resolves /
  // to the filesystem root, not the bundle directory.
  base: './',
  server: {
    port: 3000,
    strictPort: true
  },
  build: {
    outDir: path.resolve(moduleDirectory, './dist-electron/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(moduleDirectory, './index.html')
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          return undefined;
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(moduleDirectory, './src')
    }
  }
});
