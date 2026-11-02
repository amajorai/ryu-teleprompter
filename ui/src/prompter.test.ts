import { expect, test } from "bun:test";
import {
	autoScrollStep,
	clampCursor,
	prompterKeyAction,
	readingScrollTop,
} from "./prompter.ts";

const key = (
	code: string,
	extra: Partial<Parameters<typeof prompterKeyAction>[0]> = {}
) =>
	prompterKeyAction({
		altKey: false,
		code,
		ctrlKey: false,
		metaKey: false,
		target: null,
		...extra,
	});

test("maps prompter shortcuts", () => {
	expect(key("Space")).toEqual({ kind: "toggle" });
	expect(key("ArrowRight")).toEqual({ kind: "move", words: 5 });
	expect(key("ArrowLeft")).toEqual({ kind: "move", words: -5 });
	expect(key("ArrowDown")).toEqual({ kind: "move", words: 15 });
	expect(key("ArrowUp")).toEqual({ kind: "move", words: -15 });
	expect(key("Home")).toEqual({ kind: "restart" });
	expect(key("Escape")).toEqual({ kind: "exit" });
	expect(key("KeyA")).toBeNull();
	expect(key("Space", { metaKey: true })).toBeNull();
});

test("clamps the cursor to the script", () => {
	expect(clampCursor(-3, 10)).toBe(0);
	expect(clampCursor(4.6, 10)).toBe(5);
	expect(clampCursor(40, 10)).toBe(10);
	expect(clampCursor(2, 0)).toBe(0);
});

test("paces auto-scroll by words per minute and carries fractions", () => {
	let carry = 0;
	let words = 0;
	for (let frame = 0; frame < 60; frame += 1) {
		const step = autoScrollStep(carry, 1000 / 60, 120);
		carry = step.carry;
		words += step.words;
	}
	expect(words + carry).toBeCloseTo(2);
	expect(autoScrollStep(0, 60_000, 120).words).toBe(1);
	expect(autoScrollStep(0, -10, 120)).toEqual({ carry: 0, words: 0 });
});

test("centers a word in the reading-line band", () => {
	expect(readingScrollTop(530, 400, 25, 60)).toBe(400);
	expect(readingScrollTop(50, 400, 25, 60)).toBe(0);
});

test("focused switches and sliders keep their own keys", () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, "Element");
	/** Minimal element whose `closest` matches selectors naming its role. */
	class RoleElement {
		readonly role: string;
		constructor(role: string) {
			this.role = role;
		}
		closest(selector: string): RoleElement | null {
			return selector.includes(`[role="${this.role}"]`) ? this : null;
		}
	}
	Object.defineProperty(globalThis, "Element", {
		configurable: true,
		value: RoleElement,
		writable: true,
	});
	try {
		const mirrorSwitch = new RoleElement("switch") as unknown as EventTarget;
		expect(key("Space", { target: mirrorSwitch })).toBeNull();
		expect(key("ArrowRight", { target: mirrorSwitch })).toBeNull();
		expect(key("Escape", { target: mirrorSwitch })).toEqual({ kind: "exit" });
		const slider = new RoleElement("slider") as unknown as EventTarget;
		expect(key("ArrowUp", { target: slider })).toBeNull();
		const plain = new RoleElement("presentation") as unknown as EventTarget;
		expect(key("Space", { target: plain })).toEqual({ kind: "toggle" });
	} finally {
		if (original) {
			Object.defineProperty(globalThis, "Element", original);
		} else {
			Reflect.deleteProperty(globalThis, "Element");
		}
	}
});
