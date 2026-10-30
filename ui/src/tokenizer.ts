/**
 * Script tokenizer shared by the renderer and the speech matcher.
 *
 * A script is split into spoken words, bracketed cues such as `[pause]` that
 * are shown but never matched against speech, and the gaps between them.
 */

export type ScriptTokenKind = "word" | "cue" | "gap";

export interface ScriptToken {
	kind: ScriptTokenKind;
	text: string;
}

const TOKEN_PATTERN =
	/(\[[^\]\n]*\])|([\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*)/gu;

export function tokenize(text: string): ScriptToken[] {
	const tokens: ScriptToken[] = [];
	let last = 0;
	for (const match of text.matchAll(TOKEN_PATTERN)) {
		const start = match.index ?? 0;
		if (start > last) {
			tokens.push({ kind: "gap", text: text.slice(last, start) });
		}
		tokens.push({ kind: match[1] ? "cue" : "word", text: match[0] });
		last = start + match[0].length;
	}
	if (last < text.length) {
		tokens.push({ kind: "gap", text: text.slice(last) });
	}
	return tokens;
}

/** Lowercase, accent-folded letters and digits only, so ASR spelling noise compares cleanly. */
export function normalizeWord(word: string): string {
	return word
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Normalized spoken words of free text, as the matcher compares them. */
export function spokenWords(text: string): string[] {
	const words: string[] = [];
	for (const token of tokenize(text)) {
		if (token.kind !== "word") {
			continue;
		}
		const normalized = normalizeWord(token.text);
		if (normalized) {
			words.push(normalized);
		}
	}
	return words;
}
