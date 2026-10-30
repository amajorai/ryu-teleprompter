// Rendered-interaction harness shared by the Editor and Prompter tests: a
// happy-dom document, an in-memory `storage:kv` host, and React `act` helpers.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { KeyValueStorage, TeleprompterBridge } from "./bridge.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("./App.tsx");

export { App, act, createRoot };

/** In-memory host key-value store that records every write and delete. */
export class MemoryStorage implements KeyValueStorage {
	readonly values = new Map<string, string>();
	readonly deleted: string[] = [];

	private static id(namespace: string, key: string) {
		return `${namespace}/${key}`;
	}

	get({ namespace, key }: { namespace: string; key: string }) {
		return Promise.resolve(
			this.values.get(MemoryStorage.id(namespace, key)) ?? null
		);
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
		this.values.set(MemoryStorage.id(namespace, key), value);
		return Promise.resolve(true);
	}

	delete({ namespace, key }: { namespace: string; key: string }) {
		this.deleted.push(key);
		this.values.delete(MemoryStorage.id(namespace, key));
		return Promise.resolve(true);
	}

	keys({ namespace }: { namespace: string }) {
		const prefix = `${namespace}/`;
		return Promise.resolve(
			[...this.values.keys()]
				.filter((id) => id.startsWith(prefix))
				.map((id) => id.slice(prefix.length))
		);
	}
}

const mounted: Root[] = [];

/** Let pending promises and React updates settle. */
export async function settle(ms = 0): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}

/** Install the fake host bridge (storage, and media only when given). */
export function installHost(
	host: Partial<TeleprompterBridge> & { storage: KeyValueStorage }
): HTMLDivElement {
	Reflect.set(window, "ryu", host);
	const container = document.createElement("div");
	document.body.append(container);
	return container;
}

/** Track a root so `unmountAll` cleans it up after each test. */
export function track(root: Root): Root {
	mounted.push(root);
	return root;
}

export async function unmountAll(): Promise<void> {
	for (const root of mounted.splice(0)) {
		await act(async () => root.unmount());
	}
	document.body.replaceChildren();
	Reflect.deleteProperty(window, "ryu");
}

function buttonText(button: Element): string {
	return (button.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The one button whose visible text, title, or aria-label equals `name`. */
export function button(name: string, scope: ParentNode = document) {
	const matches = [...scope.querySelectorAll("button")].filter(
		(candidate) =>
			buttonText(candidate) === name ||
			candidate.getAttribute("title") === name ||
			candidate.getAttribute("aria-label") === name
	);
	if (matches.length !== 1) {
		throw new Error(`Expected one "${name}" button, found ${matches.length}.`);
	}
	return matches[0] as HTMLButtonElement;
}

export function hasButton(name: string): boolean {
	return [...document.querySelectorAll("button")].some(
		(candidate) =>
			buttonText(candidate) === name ||
			candidate.getAttribute("title") === name ||
			candidate.getAttribute("aria-label") === name
	);
}

export async function click(target: Element): Promise<void> {
	await act(async () => {
		target.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true })
		);
	});
	await settle();
}

export async function press(code: string, key = code): Promise<void> {
	await act(async () => {
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				code,
				key,
			})
		);
	});
	await settle();
}

/** Type into a controlled input or textarea the way React observes it. */
export async function typeInto(
	field: HTMLInputElement | HTMLTextAreaElement,
	value: string
): Promise<void> {
	await act(async () => {
		const prototype =
			field instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
			field,
			value
		);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await settle();
}

export function field<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing ${selector}.`);
	}
	return element;
}

export function statusText(): string {
	return (document.querySelector(".prompter-badge")?.textContent ?? "").trim();
}
