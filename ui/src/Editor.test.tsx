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
	settle,
	track,
	typeInto,
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

function savedScripts(storage: MemoryStorage) {
	return [...storage.values.entries()]
		.filter(([id]) => id.startsWith(`${NAMESPACE}/script:`))
		.map(([, value]) => JSON.parse(value) as { id: string; name: string });
}

function listTitles(): string[] {
	return [
		...document.querySelectorAll('[aria-label="Saved scripts"] button'),
	].map((item) => (item.textContent ?? "").trim());
}

describe("Teleprompter editor", () => {
	test("names, edits, formats, and saves a script to host storage", async () => {
		const storage = new MemoryStorage();
		await mountApp({ storage });
		expect(document.body.textContent).toContain("No saved scripts");

		await typeInto(
			field<HTMLInputElement>('input[aria-label="Script name"]'),
			"Keynote"
		);
		await typeInto(
			field<HTMLTextAreaElement>('textarea[aria-label="Script text"]'),
			"Hello everyone and welcome"
		);
		expect(document.body.textContent).toContain("4 words");

		const markdown = field<HTMLElement>('[role="switch"]');
		expect(markdown.getAttribute("aria-checked")).toBe("true");
		await click(markdown);
		expect(
			field<HTMLElement>('[role="switch"]').getAttribute("aria-checked")
		).toBe("false");

		await click(button("Save script"));
		await settle();
		expect(document.body.textContent).toContain("Saved “Keynote”.");
		const [saved] = savedScripts(storage);
		expect(saved).toMatchObject({
			content: "Hello everyone and welcome",
			markdown: false,
			name: "Keynote",
		});
		expect(listTitles()[0]).toContain("Keynote");
		// Saved and unchanged: the button now offers to save changes, disabled.
		expect(button("Save changes").disabled).toBe(true);
	});

	test("opens a saved script, keeps it on cancel, and deletes only that script", async () => {
		const storage = new MemoryStorage();
		for (const [id, name, updatedAt] of [
			["first", "First take", "2026-01-01T00:00:00.000Z"],
			["second", "Second take", "2026-01-02T00:00:00.000Z"],
		]) {
			await storage.set({
				namespace: NAMESPACE,
				key: `script:${id}`,
				value: JSON.stringify({
					content: `${name} words here`,
					id,
					markdown: true,
					name,
					updatedAt,
				}),
			});
		}
		await mountApp({ storage });
		const titles = listTitles();
		expect(titles).toHaveLength(2);
		expect(titles[0]).toStartWith("Second take");
		expect(titles[1]).toStartWith("First take");

		const first = [
			...document.querySelectorAll('[aria-label="Saved scripts"] button'),
		].find((item) => item.textContent?.includes("First take"));
		if (!first) {
			throw new Error("First take is not listed.");
		}
		await click(first);
		expect(
			field<HTMLTextAreaElement>('textarea[aria-label="Script text"]').value
		).toBe("First take words here");

		await click(button("Delete"));
		expect(document.body.textContent).toContain("Delete this script?");
		await click(button("Keep script"));
		expect(storage.deleted).toEqual([]);

		await click(button("Delete"));
		await click(button("Delete script"));
		await settle();
		expect(storage.deleted).toEqual(["script:first"]);
		expect(savedScripts(storage).map((script) => script.id)).toEqual([
			"second",
		]);
		expect(document.body.textContent).toContain(
			"Script deleted. Your text is still in the editor."
		);
		// The text stays in the editor after its saved copy is removed.
		expect(
			field<HTMLTextAreaElement>('textarea[aria-label="Script text"]').value
		).toBe("First take words here");
		expect(hasButton("Delete")).toBe(false);
	});

	test("New script clears the editor and Start prompter needs words", async () => {
		await mountApp({ storage: new MemoryStorage() });
		expect(button("Open the prompter").disabled).toBe(false);
		await click(button("New script"));
		expect(
			field<HTMLTextAreaElement>('textarea[aria-label="Script text"]').value
		).toBe("");
		expect(button("Open the prompter").disabled).toBe(true);

		await typeInto(
			field<HTMLTextAreaElement>('textarea[aria-label="Script text"]'),
			"Ready"
		);
		await click(button("Open the prompter"));
		expect(document.querySelector('section[aria-label="Script"]')).not.toBe(
			null
		);
	});
});
