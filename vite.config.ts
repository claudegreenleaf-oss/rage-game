import { defineConfig } from 'vitest/config';

// GitHub Pages serves the project at /<repo>/.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/rage-game/',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
