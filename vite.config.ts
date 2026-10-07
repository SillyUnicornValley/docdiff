/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // Only look in src/: crawling the agent-instruction folders (.agents, .claude, .kiro) can hang test discovery.
  test: { include: ['src/**/*.test.ts'] },
});
