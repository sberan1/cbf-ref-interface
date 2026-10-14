import { defineConfig } from 'vitest/config';

// Unit tests of server-side code (no SvelteKit plugin needed); e2e tests run via Playwright.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node'
	}
});
