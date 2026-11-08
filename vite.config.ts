import { defineConfig } from 'vitest/config';

// GitHub Pages serves the project at /<repo>/.
export default defineConfig({
  // Relative asset paths: the same build works at rage-game.scotusthenine.org/ and at github.io/rage-game/.
  base: process.env.VITE_BASE ?? './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
