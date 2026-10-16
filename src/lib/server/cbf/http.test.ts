import { describe, expect, it } from 'vitest';
import { errorPageText } from './http';

describe('errorPageText', () => {
	it('recognizes ČBF error texts served with HTTP 200', () => {
		expect(errorPageText('Nepovedlo se pripojit k databázi.<br>No such file or directory')).toBe(
			'Nepovedlo se pripojit k databázi.<br>No such file or directory'
		);
		expect(errorPageText('<!DOCTYPE html><html><body>Maintenance</body></html>')).toMatch(
			/^<!DOCTYPE html>/
		);
	});

	it('lets data through', () => {
		expect(errorPageText('{"game":{}}')).toBeNull();
		expect(errorPageText('[]')).toBeNull();
		expect(errorPageText('<?xml version="1.0"?><divs/>')).toBeNull();
		expect(errorPageText('  ')).toBeNull();
		expect(errorPageText('null')).toBeNull();
	});
});
