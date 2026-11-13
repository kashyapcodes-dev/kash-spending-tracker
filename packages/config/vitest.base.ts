import { defineConfig } from 'vitest/config';

interface VitestBaseConfig {
  test: {
    environment: 'node';
    include: string[];
  };
}

const config = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}) as VitestBaseConfig;

export default config;
