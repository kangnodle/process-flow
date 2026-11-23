/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            {
              name: 'fluent-overlays',
              test: /node_modules[\\/]@fluentui[\\/]react-(menu|toast|positioning|dialog|drawer|tooltip|portal)[\\/]/,
              priority: 20,
            },
            { name: 'fluent', test: /node_modules[\\/]@fluentui[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    testTimeout: 15000,
  },
});
