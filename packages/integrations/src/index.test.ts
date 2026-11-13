import { describe, it, expect } from 'vitest';
import { integrationsVersion } from './index';

describe('@kash/integrations', () => {
  it('should export an integrations version constant', () => {
    expect(integrationsVersion).toBe('0.0.1');
  });
});
