import { describe, it, expect } from 'vitest';
import { mcpVersion } from './index';

describe('@kash/mcp', () => {
  it('should export an MCP version constant', () => {
    expect(mcpVersion).toBe('0.0.1');
  });
});
