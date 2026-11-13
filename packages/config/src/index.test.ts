import { describe, it, expect } from 'vitest';
import config from './vitest.base';

describe('@kash/config', () => {
  it('should export a default vitest base config', () => {
    expect(config).toBeDefined();
    expect(config.test).toEqual({
      environment: 'node',
      include: ['src/**/*.test.ts'],
    });
  });
});
