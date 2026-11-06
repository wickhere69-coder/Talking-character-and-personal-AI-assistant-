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
        '**/python_backend/**',
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
      '^/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
      },
      '^/api/agent': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '^/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
