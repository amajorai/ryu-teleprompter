/** Edit distance between two strings using a single rolling row. */
export function levenshtein(left: string, right: string): number {
	if (left === right) {
		return 0;
	}
	if (left.length === 0) {
		return right.length;
	}
	if (right.length === 0) {
		return left.length;
	}
	const row = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i += 1) {
		let diagonal = row[0] ?? 0;
		row[0] = i;
		for (let j = 1; j <= right.length; j += 1) {
			const above = row[j] ?? 0;
			const before = row[j - 1] ?? 0;
			row[j] =
				left[i - 1] === right[j - 1]
					? diagonal
					: 1 + Math.min(diagonal, above, before);
			diagonal = above;
		}
	}
	return row[right.length] ?? 0;
}

/** Edit distance scaled to 0 (identical) .. 1 (nothing in common). */
export function normalizedDistance(left: string, right: string): number {
	const longest = Math.max(left.length, right.length);
	return longest === 0 ? 0 : levenshtein(left, right) / longest;
}
