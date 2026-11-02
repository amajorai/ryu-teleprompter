/** Pure prompter controls: keyboard mapping, cursor bounds, and auto-scroll pacing. */

export type PrompterAction =
	| { kind: "toggle" }
	| { kind: "move"; words: number }
	| { kind: "restart" }
	| { kind: "exit" };

const KEY_ACTIONS: Record<string, PrompterAction> = {
	Space: { kind: "toggle" },
	ArrowRight: { kind: "move", words: 5 },
	ArrowLeft: { kind: "move", words: -5 },
	ArrowDown: { kind: "move", words: 15 },
	ArrowUp: { kind: "move", words: -15 },
	Home: { kind: "restart" },
	Escape: { kind: "exit" },
};

/** Elements whose own keyboard handling must win over prompter shortcuts. */
const INTERACTIVE_TARGET =
	'input, textarea, select, [contenteditable="true"], [role="slider"], [role="radio"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [data-slot="switch"], [data-slot="toggle-group"]';

interface KeyLike {
	altKey: boolean;
	code: string;
	ctrlKey: boolean;
	metaKey: boolean;
	target: EventTarget | null;
}

export function prompterKeyAction(event: KeyLike): PrompterAction | null {
	if (event.altKey || event.ctrlKey || event.metaKey) {
		return null;
	}
	const action = KEY_ACTIONS[event.code];
	if (!action) {
		return null;
	}
	const target =
		typeof Element !== "undefined" && event.target instanceof Element
			? event.target
			: null;
	// Escape always leaves the prompter; other keys belong to focused controls.
	if (action.kind === "exit" || target === null) {
		return action;
	}
	if (target.closest(INTERACTIVE_TARGET) !== null) {
		return null;
	}
	// A focused button already activates itself on Space.
	if (action.kind === "toggle" && target.closest("button") !== null) {
		return null;
	}
	return action;
}

export function clampCursor(cursor: number, wordCount: number): number {
	return Math.min(Math.max(0, Math.round(cursor)), Math.max(0, wordCount));
}

/**
 * Advance a fractional word budget by elapsed time at a words-per-minute pace.
 * Returns whole words to move now and the fraction carried to the next frame.
 */
export function autoScrollStep(
	carry: number,
	elapsedMs: number,
	wordsPerMinute: number
): { carry: number; words: number } {
	// Clamp long frame gaps (a backgrounded tab) so the cursor never leaps.
	const budget =
		carry + (Math.min(Math.max(0, elapsedMs), 500) * wordsPerMinute) / 60_000;
	const words = Math.floor(budget);
	return { carry: budget - words, words };
}

/**
 * Scroll offset that centers a word (by its vertical midpoint, in scroll
 * coordinates) inside the reading-line band.
 */
export function readingScrollTop(
	wordCenter: number,
	viewportHeight: number,
	readingLinePercent: number,
	bandHeight: number
): number {
	const bandCenter =
		(viewportHeight * readingLinePercent) / 100 + bandHeight / 2;
	return Math.max(0, Math.round(wordCenter - bandCenter));
}
