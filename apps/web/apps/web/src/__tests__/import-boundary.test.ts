import { describe, expect, test } from 'vitest';
import { api } from '@kash/fixture-api'; // Should be blocked by @kash/import-boundary

describe('@kash/import-boundary', () => {
  test('should not import from external fixtures in app code', () => {
    expect(api).toBeDefined();
  });
});
