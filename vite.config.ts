import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      deny: [
        '**/.env',
        '**/.env.*',
        '**/server/**',
        '**/data/**',
        '**/.git/**',
        '**/*.key',
        '**/*.pem',
      ],
    },
    watch: {
      ignored: [
        '**/data/**',
        '**/server/**',
        '**/*.json',
        '**/.git/**',
        '**/node_modules/**',
        '**/*.log',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
