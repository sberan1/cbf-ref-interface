import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'The database connection string.',
		// optional at build time (the build analyses routes without a database); required at runtime,
		// enforced by getDb() on first use
		schema: (value) => value || undefined
	}
});
