import { expect, test } from '@playwright/test';

test('anonymous visitors land on the referee login', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('heading', { name: 'Přihlášení rozhodčího' })).toBeVisible();
});
