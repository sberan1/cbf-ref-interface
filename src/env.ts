import { defineEnvVars } from '@sveltejs/kit/env';

// All optional at build time (the build analyses routes without them); the features that need
// them check at runtime and explain what is missing.
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'The database connection string.',
		schema: optional
	},
	GOOGLE_CLIENT_ID: {
		description: 'OAuth client ID of the Google sign-in (ADR 0008).',
		schema: optional
	},
	GOOGLE_CLIENT_SECRET: {
		description: 'OAuth client secret of the Google sign-in.',
		schema: optional
	},
	ADMIN_EMAILS: {
		description: 'Comma-separated e-mails of admins; they approve the other accounts.',
		schema: optional
	},
	MAPY_API_KEY: {
		description: 'Mapy.com REST API key for geocoding and car routes (PDR 0003).',
		schema: optional
	}
});
