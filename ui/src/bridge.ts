import type { RyuAppBridge } from "@ryu/app-host/app-bridge";
import type {
	MediaRecordingInput,
	MediaRecordingResult,
} from "@ryu/app-host/media-recording";
import { z } from "zod";

export interface KeyValueStorage {
	delete(input: { namespace: string; key: string }): Promise<unknown>;
	get(input: { namespace: string; key: string }): Promise<string | null>;
	keys(input: { namespace: string }): Promise<string[]>;
	set(input: {
		namespace: string;
		key: string;
		value: string;
	}): Promise<unknown>;
}

export interface TeleprompterBridge extends RyuAppBridge {
	media?: {
		recording?(input: MediaRecordingInput): Promise<MediaRecordingResult>;
		transcribe?(input: {
			audio: string;
			filename: string;
			detailed: boolean;
		}): Promise<unknown>;
	};
	storage?: KeyValueStorage;
}

declare global {
	interface Window {
		ryu?: TeleprompterBridge;
	}
}

export function bridge(): TeleprompterBridge | null {
	return globalThis.window?.ryu ?? null;
}

/**
 * Per-window storage used only when the host bridge is missing (a plain
 * browser preview). Some browsers throw on localStorage, so memory is the last
 * resort.
 */
export class LocalStorageFallback implements KeyValueStorage {
	private readonly memory = new Map<string, string>();

	private store(): Storage | null {
		try {
			return globalThis.localStorage ?? null;
		} catch {
			return null;
		}
	}

	private static id(namespace: string, key: string) {
		return `${namespace}/${key}`;
	}

	get({ namespace, key }: { namespace: string; key: string }) {
		const id = LocalStorageFallback.id(namespace, key);
		try {
			const stored = this.store()?.getItem(id);
			if (stored !== null && stored !== undefined) {
				return Promise.resolve(stored);
			}
		} catch {
			// Fall through to memory.
		}
		return Promise.resolve(this.memory.get(id) ?? null);
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
		const id = LocalStorageFallback.id(namespace, key);
		this.memory.set(id, value);
		try {
			this.store()?.setItem(id, value);
		} catch {
			// Memory keeps the value for this session.
		}
		return Promise.resolve(true);
	}

	delete({ namespace, key }: { namespace: string; key: string }) {
		const id = LocalStorageFallback.id(namespace, key);
		this.memory.delete(id);
		try {
			this.store()?.removeItem(id);
		} catch {
			// Nothing persisted.
		}
		return Promise.resolve(true);
	}

	keys({ namespace }: { namespace: string }) {
		const prefix = `${namespace}/`;
		const keys = new Set<string>();
		for (const id of this.memory.keys()) {
			if (id.startsWith(prefix)) {
				keys.add(id.slice(prefix.length));
			}
		}
		try {
			const store = this.store();
			for (let index = 0; index < (store?.length ?? 0); index += 1) {
				const id = store?.key(index);
				if (id?.startsWith(prefix)) {
					keys.add(id.slice(prefix.length));
				}
			}
		} catch {
			// Memory keys only.
		}
		return Promise.resolve([...keys]);
	}
}

/**
 * Host `storage:kv` when the bridge exists. Only a plain-browser preview with
 * no host uses the local fallback; once the host is present its failures reach
 * the caller instead of silently switching stores, so nothing written during a
 * hiccup can vanish or resurrect deleted scripts later.
 */
export class AppStorage implements KeyValueStorage {
	private readonly storage: KeyValueStorage;

	/** True when no Ryu host is attached and scripts stay in this browser. */
	readonly isPreview: boolean;

	constructor(
		host: KeyValueStorage | null,
		fallback: KeyValueStorage = new LocalStorageFallback()
	) {
		this.storage = host ?? fallback;
		this.isPreview = host === null;
	}

	get(input: { namespace: string; key: string }) {
		return this.storage.get(input);
	}

	set(input: { namespace: string; key: string; value: string }) {
		return this.storage.set(input);
	}

	delete(input: { namespace: string; key: string }) {
		return this.storage.delete(input);
	}

	keys(input: { namespace: string }) {
		return this.storage.keys(input);
	}
}

const transcriptSchema = z.union([
	z.string(),
	z.object({ text: z.string() }).transform((value) => value.text),
]);

/** Plain transcript text from either result shape `media.transcribe` returns. */
export function transcriptText(payload: unknown): string {
	const parsed = transcriptSchema.safeParse(payload);
	return parsed.success ? parsed.data.trim() : "";
}

export function errorMessage(reason: unknown): string {
	if (reason instanceof Error && reason.message) {
		return reason.message;
	}
	return "Something went wrong. Try again.";
}
