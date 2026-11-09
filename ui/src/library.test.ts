import { describe, expect, test } from "bun:test";
import {
	AppStorage,
	type KeyValueStorage,
	LocalStorageFallback,
	transcriptText,
} from "./bridge.ts";
import {
	DEFAULT_SETTINGS,
	defaultScriptName,
	NAMESPACE,
	ScriptLibrary,
} from "./library.ts";

class MemoryStorage implements KeyValueStorage {
	readonly values = new Map<string, string>();
	get({ namespace, key }: { namespace: string; key: string }) {
		return Promise.resolve(this.values.get(`${namespace}/${key}`) ?? null);
	}
	set({
		namespace,
		key,
		value,
	}: {
		namespace: string;
		key: string;
		value: string;
	}) {
		this.values.set(`${namespace}/${key}`, value);
		return Promise.resolve(true);
	}
	delete({ namespace, key }: { namespace: string; key: string }) {
		this.values.delete(`${namespace}/${key}`);
		return Promise.resolve(true);
	}
	keys({ namespace }: { namespace: string }) {
		return Promise.resolve(
			[...this.values.keys()]
				.filter((id) => id.startsWith(`${namespace}/`))
				.map((id) => id.slice(namespace.length + 1))
		);
	}
}

const failing: KeyValueStorage = {
	get: () => Promise.reject(new Error("denied")),
	set: () => Promise.reject(new Error("denied")),
	delete: () => Promise.reject(new Error("denied")),
	keys: () => Promise.reject(new Error("denied")),
};

describe("script library", () => {
	test("saves, lists newest first, and removes scripts", async () => {
		const storage = new MemoryStorage();
		const library = new ScriptLibrary(storage);
		await library.save({
			id: "a",
			name: "Older",
			content: "one",
			markdown: true,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await library.save({
			id: "b",
			name: "Newer",
			content: "two",
			markdown: false,
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
		storage.values.set(`${NAMESPACE}/script:broken`, "{not json");
		storage.values.set(
			`${NAMESPACE}/script:wrong`,
			JSON.stringify({ id: "other", name: "x", content: "", updatedAt: "" })
		);
		expect((await library.list()).map((script) => script.name)).toEqual([
			"Newer",
			"Older",
		]);
		await library.remove("b");
		expect((await library.list()).map((script) => script.id)).toEqual(["a"]);
	});

	test("keeps a draft and repairs invalid settings with defaults", async () => {
		const storage = new MemoryStorage();
		const library = new ScriptLibrary(storage);
		expect(await library.draft()).toBeNull();
		await library.saveDraft({
			id: null,
			name: "",
			content: "Hi",
			markdown: true,
		});
		expect(await library.draft()).toEqual({
			id: null,
			name: "",
			content: "Hi",
			markdown: true,
		});
		expect(await library.settings()).toEqual(DEFAULT_SETTINGS);
		storage.values.set(
			`${NAMESPACE}/settings`,
			JSON.stringify({ fontSize: 999, mirror: true, follow: "auto" })
		);
		expect(await library.settings()).toEqual({
			...DEFAULT_SETTINGS,
			mirror: true,
			follow: "auto",
		});
	});

	test("names untitled scripts from their first line", () => {
		expect(defaultScriptName("\n# **Launch** talk\nbody")).toBe("Launch talk");
		expect(defaultScriptName("   ")).toBe("Untitled script");
		expect(defaultScriptName("x".repeat(80))).toHaveLength(58);
	});
});

describe("app storage", () => {
	test("host failures reach the caller instead of switching stores", async () => {
		const fallback = new LocalStorageFallback();
		const storage = new AppStorage(failing, fallback);
		expect(storage.isPreview).toBe(false);
		await expect(
			storage.set({ namespace: "n", key: "k", value: "v" })
		).rejects.toThrow();
		expect(await fallback.keys({ namespace: "n" })).toEqual([]);
		await expect(storage.keys({ namespace: "n" })).rejects.toThrow();
	});

	test("uses the host when it exists and the fallback only without one", async () => {
		const host = new MemoryStorage();
		const storage = new AppStorage(host);
		await storage.set({ namespace: "n", key: "k", value: "v" });
		expect(host.values.get("n/k")).toBe("v");
		expect(storage.isPreview).toBe(false);
		const preview = new AppStorage(null, new LocalStorageFallback());
		expect(preview.isPreview).toBe(true);
		await preview.set({ namespace: "n", key: "k", value: "v" });
		expect(await preview.get({ namespace: "n", key: "k" })).toBe("v");
	});
});

test("reads plain and detailed transcription results", () => {
	expect(transcriptText("  hello ")).toBe("hello");
	expect(transcriptText({ text: "hi there", segments: [] })).toBe("hi there");
	expect(transcriptText(42)).toBe("");
});
