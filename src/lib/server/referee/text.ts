/** Lowercase, without Czech/Slovak diacritics (mirrors the SQL `translate` in queries.ts). */
export function foldText(value: string): string {
	return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
