import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

export default defineConfig({
  plugins: [react()],
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
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(moduleDirectory, './src')
    }
  }
});
