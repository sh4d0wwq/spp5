import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/graphql': {
        target: 'http://127.0.0.1:4000',
        ws: true,
      },
      '/media': {
        target: 'http://127.0.0.1:4000',
      },
    },
  },
});
