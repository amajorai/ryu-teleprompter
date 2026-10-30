/**
 * Align a short transcript with the script to find where the speaker is.
 *
 * Ryu's speech-to-text engines return text for a few seconds of audio (some,
 * like Parakeet, return no word timing), so the matcher aligns the *end* of
 * what was heard with a span of script words near the current position. The
 * returned cursor is the number of script words already spoken.
 */

import { normalizedDistance } from "./levenshtein.ts";
import { spokenWords } from "./tokenizer.ts";

export interface MatchOptions {
	/** Most recent heard words compared against the script. */
	maxQueryWords?: number;
}

const DEFAULT_QUERY_WORDS = 12;
const SHORT_QUERY_WORDS = 2;
const SHORT_LOOK_AHEAD = 4;
const SHORT_MAX_DISTANCE = 0.2;
const MAX_DISTANCE = 0.4;
/** Stricter bar for a jump well past what one window of speech covers. */
const FAR_MAX_DISTANCE = 0.12;
/** Words beyond the heard length that still count as a near jump. */
const NEAR_JUMP_SLACK = 6;
const SPAN_SLACK = 2;
const FORWARD_PENALTY_PER_WORD = 0.002;
const FAR_FORWARD_PENALTY_PER_WORD = 0.02;
const BACKWARD_PENALTY = 0.08;
const BACKWARD_PENALTY_PER_WORD = 0.01;
/**
 * Cost of ignoring heard words as lead-in or trailing ad-lib, scaled by the
 * share of the transcript dropped, so a partial match never outranks a full
 * match of everything that was heard a little further away.
 */
const DROPPED_SHARE_PENALTY = 0.5;

interface Candidate {
	/** Edit distance plus the cost of dropped heard words. */
	distance: number;
	end: number;
	score: number;
}

interface QueryVariant {
	dropped: number;
	text: string;
	words: number;
}

function positionPenalty(end: number, cursor: number, near: number): number {
	if (end >= cursor) {
		const ahead = end - cursor;
		return (
			Math.min(ahead, near) * FORWARD_PENALTY_PER_WORD +
			Math.max(0, ahead - near) * FAR_FORWARD_PENALTY_PER_WORD
		);
	}
	return BACKWARD_PENALTY + (cursor - end) * BACKWARD_PENALTY_PER_WORD;
}

/**
 * The whole heard text plus versions without leading words (lead-in before
 * the script) or trailing words (an ad-lib after it). At least a third of
 * what was heard, and two words, must remain.
 */
function queryVariants(heard: readonly string[]): QueryVariant[] {
	const variants: QueryVariant[] = [
		{ dropped: 0, text: heard.join(" "), words: heard.length },
	];
	const keep = Math.max(2, Math.ceil(heard.length / 3));
	for (let dropped = 1; heard.length - dropped >= keep; dropped += 1) {
		const length = heard.length - dropped;
		variants.push(
			{ dropped, text: heard.slice(dropped).join(" "), words: length },
			{ dropped, text: heard.slice(0, length).join(" "), words: length }
		);
	}
	return variants;
}

/**
 * Returns the new cursor (0..words.length) after hearing `transcript`, or the
 * unchanged cursor when nothing in the nearby script matches confidently.
 */
export function matchTranscript(
	transcript: string,
	words: readonly string[],
	cursor: number,
	options: MatchOptions = {}
): number {
	const anchor = Math.min(Math.max(0, cursor), words.length);
	const heard = spokenWords(transcript).slice(
		-(options.maxQueryWords ?? DEFAULT_QUERY_WORDS)
	);
	if (heard.length === 0 || words.length === 0) {
		return anchor;
	}
	const short = heard.length <= SHORT_QUERY_WORDS;
	const near = heard.length + NEAR_JUMP_SLACK;
	const lookAhead = short ? SHORT_LOOK_AHEAD : heard.length * 3 + 20;
	// A re-read of the previous sentence or two must be reachable backward,
	// or a lookalike further ahead wins by default.
	const lookBehind = short ? 0 : heard.length * 2 + 10;
	const firstEnd = Math.max(1, anchor - lookBehind);
	const lastEnd = Math.min(words.length, anchor + lookAhead);
	const variants = short
		? [{ dropped: 0, text: heard.join(" "), words: heard.length }]
		: queryVariants(heard);

	let best: Candidate | null = null;
	for (let end = firstEnd; end <= lastEnd; end += 1) {
		const penalty = positionPenalty(end, anchor, near);
		for (const variant of variants) {
			const minSpan = Math.max(1, variant.words - SPAN_SLACK);
			const maxSpan = Math.min(end, variant.words + SPAN_SLACK);
			for (let span = minSpan; span <= maxSpan; span += 1) {
				const candidate = words.slice(end - span, end).join(" ");
				const distance =
					normalizedDistance(variant.text, candidate) +
					(variant.dropped / heard.length) * DROPPED_SHARE_PENALTY;
				const score = distance + penalty;
				if (best === null || score < best.score) {
					best = { distance, end, score };
				}
			}
		}
	}
	if (best === null) {
		return anchor;
	}
	let limit = MAX_DISTANCE;
	if (short) {
		limit = SHORT_MAX_DISTANCE;
	} else if (best.end - anchor > near) {
		limit = FAR_MAX_DISTANCE;
	}
	return best.distance > limit ? anchor : best.end;
}
