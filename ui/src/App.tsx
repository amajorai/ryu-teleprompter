import { useLiteralMessages } from "@ryu/i18n/react";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppStorage, bridge, errorMessage } from "./bridge.ts";
import { Editor } from "./Editor.tsx";
import {
	DEFAULT_SETTINGS,
	type Draft,
	SAMPLE_SCRIPT,
	ScriptLibrary,
	type Settings,
} from "./library.ts";
import { Prompter } from "./Prompter.tsx";

const SAVE_DELAY_MS = 600;

const SAMPLE_DRAFT: Draft = {
	id: null,
	name: "",
	content: SAMPLE_SCRIPT,
	markdown: true,
};

/** Debounced write of a value once it has been loaded from storage. */
function usePersisted<T>(
	value: T,
	ready: boolean,
	write: (value: T) => Promise<void>,
	onResult: (error: string | null) => void
) {
	const writeRef = useRef(write);
	writeRef.current = write;
	const resultRef = useRef(onResult);
	resultRef.current = onResult;
	useEffect(() => {
		if (!ready) {
			return;
		}
		const timer = setTimeout(() => {
			writeRef.current(value).then(
				() => resultRef.current(null),
				(reason: unknown) =>
					resultRef.current(
						`Couldn't save your latest changes to Ryu: ${errorMessage(reason)}`
					)
			);
		}, SAVE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [value, ready]);
}

export function App() {
	const storage = useMemo(() => new AppStorage(bridge()?.storage ?? null), []);
	const library = useMemo(() => new ScriptLibrary(storage), [storage]);
	const scripts = useQuery({
		queryKey: ["teleprompter-scripts"],
		queryFn: () => library.list(),
	});
	const [mode, setMode] = useState<"edit" | "prompter">("edit");
	const [draft, setDraft] = useState<Draft>(SAMPLE_DRAFT);
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [ready, setReady] = useState(false);
	const [storageError, setStorageError] = useState<string | null>(null);
	const tl = useLiteralMessages();
	// Read through a ref so a locale change never re-runs the one-time draft load.
	const tlRef = useRef(tl);
	tlRef.current = tl;

	useEffect(() => {
		let alive = true;
		Promise.all([library.draft(), library.settings()]).then(
			([storedDraft, storedSettings]) => {
				if (!alive) {
					return;
				}
				if (storedDraft) {
					setDraft(storedDraft);
				}
				setSettings(storedSettings);
				setReady(true);
			},
			(reason: unknown) => {
				// Autosave stays off so the sample text never overwrites a stored draft.
				if (alive) {
					setStorageError(
						tlRef.current(
							"Couldn't load your draft from Ryu, so it isn't saved automatically: {error}",
							{ error: errorMessage(reason) }
						)
					);
				}
			}
		);
		return () => {
			alive = false;
		};
	}, [library]);

	usePersisted(
		draft,
		ready,
		(value) => library.saveDraft(value),
		setStorageError
	);
	usePersisted(
		settings,
		ready,
		(value) => library.saveSettings(value),
		setStorageError
	);

	const updateSettings = useCallback((patch: Partial<Settings>) => {
		setSettings((current) => ({ ...current, ...patch }));
	}, []);
	const exitPrompter = useCallback(() => setMode("edit"), []);

	if (mode === "prompter") {
		return (
			<Prompter
				draft={draft}
				onExit={exitPrompter}
				onSettingsChange={updateSettings}
				settings={settings}
			/>
		);
	}
	return (
		<Editor
			draft={draft}
			library={library}
			onDraftChange={setDraft}
			onSettingsChange={updateSettings}
			onStart={() => setMode("prompter")}
			preview={storage.isPreview}
			scripts={scripts}
			settings={settings}
			storageError={storageError}
		/>
	);
}
