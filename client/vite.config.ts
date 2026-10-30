import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, /api est relayé vers le serveur Express.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
