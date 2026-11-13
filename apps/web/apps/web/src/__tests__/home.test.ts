import { describe, expect, test } from 'vitest';
import { screen, waitFor } from '@playwright/user-testing';

describe('Home Page', () => {
  test('should render without error and show expected content', async ({ page }) => {
    await page.goto('/');
    
    await waitFor(() => {
      expect(page.locator('h1')).toBeVisible();
    });
    
    expect(await page.locator('h1').textContent()).toContain('Kash Spending Tracker');
    expect(await page.locator('a[href="/health"]').count()).toBeGreaterThan(0);
  });
});
