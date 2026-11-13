import { describe, expect, test } from 'vitest';
import { screen, waitFor } from '@playwright/user-testing';
import { createHealthResponse } from '@kash/contract';

describe('Health Endpoint', () => {
  test('should render without error and show expected content', async ({ page }) => {
    const health = createHealthResponse('@kash/app-web');
    
    await page.goto('/health');
    
    await waitFor(() => {
      expect(page.locator('h1')).toBeVisible();
    });
    
    expect(await page.locator('h1').textContent()).toContain('Health Check');
    expect(await page.locator('p').nth(0).textContent()).toContain(health.service);
    expect(await page.locator('p').nth(1).textContent()).toContain(health.status);
    expect(await page.locator('p').nth(2).textContent()).toContain(health.timestamp);
  });
});
