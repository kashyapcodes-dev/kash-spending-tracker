import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    timeout: 5000,
    coverage: {
      enabled: true,
      reporter: ['text', 'json', 'html'],
      allowsOverflow: true,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/*.test.*',
        '**/*.spec.*',
      ],
    },
  },
});
