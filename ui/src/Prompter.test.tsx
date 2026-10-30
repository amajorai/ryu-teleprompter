import { afterEach, describe, expect, test } from "bun:test";
import { NAMESPACE } from "./library.ts";
import {
	App,
	act,
	button,
	click,
	createRoot,
	field,
	hasButton,
	installHost,
	MemoryStorage,
	press,
	settle,
	statusText,
	track,
	unmountAll,
} from "./test-support.tsx";

afterEach(unmountAll);

/** Mount the whole app against a fake host bridge (no media). */
async function mountApp(host: { storage: MemoryStorage }) {
	const container = installHost(host);
	const root = track(createRoot(container));
	await act(async () => {
		root.render(<App />);
	});
	await settle();
	return container;
}

const SCRIPT =
	"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";

async function openPrompter(settings: Record<string, unknown> = {}) {
	const storage = new MemoryStorage();
	await storage.set({
		namespace: NAMESPACE,
		key: "draft",
		value: JSON.stringify({
			content: SCRIPT,
			id: null,
			markdown: false,
			name: "",
		}),
	});
	await storage.set({
		namespace: NAMESPACE,
		key: "settings",
		value: JSON.stringify(settings),
	});
	await mountApp({ storage });
	await click(button("Open the prompter"));
	return storage;
}

function progress(): string {
	return (
		document.querySelector(".prompter-progress")?.textContent ?? ""
	).replace(/\s+/g, " ");
}

function word(index: number): HTMLElement {
	return field<HTMLElement>(`[data-word="${index}"]`);
}

describe("Teleprompter prompter", () => {
	test("voice following without host speech offers the switch to auto-scroll", async () => {
		const storage = await openPrompter();
		expect(statusText()).toBe("Paused");

		// The fake host grants storage only, so voice following cannot start.
		await click(button("Start (Space)"));
		await settle(10);
		const alert = field<HTMLElement>('[role="alert"]');
		expect(alert.textContent).toContain("Use auto-scroll");
		expect(statusText()).toBe("Paused");

		await click(button("Use auto-scroll"));
		expect(document.querySelector('[role="alert"]')).toBe(null);
		await settle(700);
		const stored = storage.values.get(`${NAMESPACE}/settings`) ?? "{}";
		expect(JSON.parse(stored)).toMatchObject({ follow: "auto" });

		await click(button("Start (Space)"));
		expect(statusText()).toBe("Auto-scrolling");
		await click(button("Pause (Space)"));
		expect(statusText()).toBe("Paused");
	});

	test("scroll-mode toggle switches between voice and auto", async () => {
		await openPrompter({ follow: "auto" });
		const voice = button("Follow my voice");
		const auto = button("Scroll at a steady pace");
		expect(auto.getAttribute("aria-pressed")).toBe("true");
		await click(voice);
		expect(button("Follow my voice").getAttribute("aria-pressed")).toBe("true");
		await click(button("Scroll at a steady pace"));
		expect(button("Scroll at a steady pace").getAttribute("aria-pressed")).toBe(
			"true"
		);
	});

	test("keyboard, click-to-jump, restart, and exit move through the script", async () => {
		await openPrompter({ follow: "auto" });
		expect(progress()).toBe("0 / 20");
		expect(word(0).dataset.state).toBe("current");

		await press("ArrowRight");
		expect(progress()).toBe("5 / 20");
		await press("ArrowDown");
		expect(progress()).toBe("20 / 20");
		await press("ArrowUp");
		expect(progress()).toBe("5 / 20");

		await click(word(12));
		expect(progress()).toBe("12 / 20");
		expect(word(11).dataset.state).toBe("spoken");
		expect(word(12).dataset.state).toBe("current");

		await click(button("Back to the start"));
		expect(progress()).toBe("0 / 20");

		await press("Space", " ");
		expect(statusText()).toBe("Auto-scrolling");
		await press("Space", " ");
		expect(statusText()).toBe("Paused");

		await click(button("Back to the editor (Esc)"));
		expect(
			field<HTMLTextAreaElement>('textarea[aria-label="Script text"]').value
		).toBe(SCRIPT);

		await click(button("Open the prompter"));
		await press("Escape");
		expect(hasButton("Open the prompter")).toBe(true);
	});

	test("Display opens settings and the mirror switch flips the text", async () => {
		const storage = await openPrompter({ follow: "auto" });
		expect(document.querySelector(".prompter-display")).toBe(null);
		await click(button("Display settings"));
		expect(document.querySelector(".prompter-display")).not.toBe(null);
		expect(document.querySelectorAll('[aria-label="Text size"]').length).toBe(
			1
		);

		const text = field<HTMLElement>(".prompter-text");
		expect(text.dataset.mirror).toBe("false");
		await click(field<HTMLElement>('.prompter-display [role="switch"]'));
		expect(field<HTMLElement>(".prompter-text").dataset.mirror).toBe("true");
		await settle(700);
		expect(
			JSON.parse(storage.values.get(`${NAMESPACE}/settings`) ?? "{}")
		).toMatchObject({ mirror: true });

		await click(button("Display settings"));
		expect(document.querySelector(".prompter-display")).toBe(null);
	});
});
