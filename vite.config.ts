import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5178,
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
