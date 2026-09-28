import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { releasePlugin } from './scripts/release-plugin.mjs';
let revision = process.env.PANEL_BUILD_REVISION || 'unknown';
try { if (revision === 'unknown' && existsSync(path.join(import.meta.dirname, '.git'))) revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: import.meta.dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
const version = readFileSync(path.join(import.meta.dirname, 'VERSION'), 'utf8').trim();

export default defineConfig({
  define: { __PANEL_REVISION__: JSON.stringify(revision) },
  plugins: [react(), releasePlugin({ revision, version })],
  server: {
    host: '127.0.0.1',
    port: 5178,
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
