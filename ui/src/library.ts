import { z } from "zod";
import type { KeyValueStorage } from "./bridge.ts";

export const NAMESPACE = "teleprompter.v1";
const SCRIPT_PREFIX = "script:";
const DRAFT_KEY = "draft";
const SETTINGS_KEY = "settings";
const MAX_SCRIPT_LENGTH = 200_000;

export const savedScriptSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().max(200),
	content: z.string().max(MAX_SCRIPT_LENGTH),
	markdown: z.boolean().default(true),
	updatedAt: z.string(),
});
export type SavedScript = z.infer<typeof savedScriptSchema>;

export const draftSchema = z.object({
	id: z.string().max(80).nullable().default(null),
	name: z.string().max(200).default(""),
	content: z.string().max(MAX_SCRIPT_LENGTH),
	markdown: z.boolean().default(true),
});
export type Draft = z.infer<typeof draftSchema>;

export const settingsSchema = z.object({
	fontSize: z.number().min(16).max(160).catch(44),
	lineWidth: z.number().min(16).max(90).catch(36),
	readingLine: z.number().min(5).max(70).catch(30),
	wordsPerMinute: z.number().min(60).max(260).catch(140),
	mirror: z.boolean().catch(false),
	follow: z.enum(["voice", "auto"]).catch("voice"),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const SAMPLE_SCRIPT = `# Welcome to Teleprompter

Write or paste your script here. When you start the prompter, it listens with **Ryu's own speech-to-text** and keeps the line you are reading at the reading line.

Words you have already said fade back, so a glance tells you where you are. [pause]

If you go off script, the prompter waits for you. Press *Space* to start or pause, use the arrow keys to nudge, and press *Escape* to come back here.`;

function parseJson(value: string | null): unknown {
	if (value === null) {
		return null;
	}
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

export function newScriptId(): string {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
	);
}

/** Name used when a script is saved without one: its first heading or line. */
export function defaultScriptName(content: string): string {
	for (const line of content.split("\n")) {
		const text = line
			.replace(/^#+\s*/, "")
			.replace(/[*_`[\]]/g, "")
			.trim();
		if (text) {
			return text.length > 60 ? `${text.slice(0, 57)}…` : text;
		}
	}
	return "Untitled script";
}

/** Saved scripts, draft, and display settings in the app's private key-value store. */
export class ScriptLibrary {
	constructor(private readonly storage: KeyValueStorage) {}

	async list(): Promise<SavedScript[]> {
		const keys = await this.storage.keys({ namespace: NAMESPACE });
		const scripts: SavedScript[] = [];
		for (const key of keys) {
			if (!key.startsWith(SCRIPT_PREFIX)) {
				continue;
			}
			const parsed = savedScriptSchema.safeParse(
				parseJson(await this.storage.get({ namespace: NAMESPACE, key }))
			);
			if (parsed.success && `${SCRIPT_PREFIX}${parsed.data.id}` === key) {
				scripts.push(parsed.data);
			}
		}
		return scripts.sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt)
		);
	}

	async save(script: SavedScript): Promise<SavedScript> {
		const valid = savedScriptSchema.parse(script);
		await this.storage.set({
			namespace: NAMESPACE,
			key: `${SCRIPT_PREFIX}${valid.id}`,
			value: JSON.stringify(valid),
		});
		return valid;
	}

	async remove(id: string): Promise<void> {
		await this.storage.delete({
			namespace: NAMESPACE,
			key: `${SCRIPT_PREFIX}${id}`,
		});
	}

	async draft(): Promise<Draft | null> {
		const parsed = draftSchema.safeParse(
			parseJson(
				await this.storage.get({ namespace: NAMESPACE, key: DRAFT_KEY })
			)
		);
		return parsed.success ? parsed.data : null;
	}

	async saveDraft(draft: Draft): Promise<void> {
		await this.storage.set({
			namespace: NAMESPACE,
			key: DRAFT_KEY,
			value: JSON.stringify(draftSchema.parse(draft)),
		});
	}

	async settings(): Promise<Settings> {
		const stored = parseJson(
			await this.storage.get({ namespace: NAMESPACE, key: SETTINGS_KEY })
		);
		return settingsSchema.parse(
			typeof stored === "object" && stored !== null ? stored : {}
		);
	}

	async saveSettings(settings: Settings): Promise<void> {
		await this.storage.set({
			namespace: NAMESPACE,
			key: SETTINGS_KEY,
			value: JSON.stringify(settingsSchema.parse(settings)),
		});
	}
}
