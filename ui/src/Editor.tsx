import {
	Delete02Icon,
	FloppyDiskIcon,
	PlayIcon,
	PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	RyuAppActions,
	RyuAppEmpty,
	RyuAppField,
	RyuAppList,
	RyuAppListItem,
	RyuAppMain,
	RyuAppSection,
	RyuAppToolbar,
} from "@ryu/blocks/companion/app-ui";
import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Spinner,
	Switch,
	Textarea,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import type { QueryResult } from "@ryu/ui/hooks/use-query.ts";
import { formatDate } from "@ryu/ui/lib/timezone.ts";
import { useId, useMemo, useState } from "react";
import { errorMessage } from "./bridge.ts";
import {
	type Draft,
	defaultScriptName,
	newScriptId,
	type SavedScript,
	type ScriptLibrary,
	type Settings,
} from "./library.ts";
import { buildScript, speakingTime } from "./script.ts";

interface EditorProps {
	draft: Draft;
	library: ScriptLibrary;
	onDraftChange(draft: Draft): void;
	onSettingsChange(patch: Partial<Settings>): void;
	onStart(): void;
	/** No Ryu host is attached (plain-browser preview). */
	preview: boolean;
	scripts: QueryResult<SavedScript[]>;
	settings: Settings;
	/** Autosave or load failure reported by the app. */
	storageError: string | null;
}

export function Editor({
	draft,
	library,
	onDraftChange,
	onStart,
	preview,
	scripts,
	settings,
	storageError,
}: EditorProps) {
	const tl = useLiteralMessages();
	const markdownId = useId();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	const [deleteOpen, setDeleteOpen] = useState(false);
	const wordCount = useMemo(
		() => buildScript(draft.content, draft.markdown).words.length,
		[draft.content, draft.markdown]
	);
	const saved = scripts.data?.find((script) => script.id === draft.id);
	const unchanged =
		saved !== undefined &&
		saved.content === draft.content &&
		saved.name === (draft.name.trim() || defaultScriptName(draft.content)) &&
		saved.markdown === draft.markdown;

	async function run(action: () => Promise<string>) {
		if (busy) {
			return;
		}
		setBusy(true);
		setError(null);
		setNotice("");
		try {
			setNotice(await action());
		} catch (reason) {
			setError(errorMessage(reason));
		} finally {
			setBusy(false);
		}
	}

	function save() {
		return run(async () => {
			const script = await library.save({
				id: draft.id ?? newScriptId(),
				name: draft.name.trim() || defaultScriptName(draft.content),
				content: draft.content,
				markdown: draft.markdown,
				updatedAt: new Date().toISOString(),
			});
			onDraftChange({ ...draft, id: script.id, name: script.name });
			await scripts.refetch();
			return `Saved “${script.name}”.`;
		});
	}

	function remove() {
		const id = draft.id;
		if (!id) {
			return;
		}
		setDeleteOpen(false);
		run(async () => {
			await library.remove(id);
			onDraftChange({ ...draft, id: null });
			await scripts.refetch();
			return "Script deleted. Your text is still in the editor.";
		}).catch(() => undefined);
	}

	function open(script: SavedScript) {
		setError(null);
		setNotice("");
		onDraftChange({
			id: script.id,
			name: script.name,
			content: script.content,
			markdown: script.markdown,
		});
	}

	return (
		<>
			<RyuAppToolbar
				actions={
					<Button
						disabled={wordCount === 0}
						onClick={onStart}
						title="Open the prompter"
					>
						<HugeiconsIcon aria-hidden="true" icon={PlayIcon} />
						Start prompter
					</Button>
				}
				title="Teleprompter"
			/>
			<RyuAppMain className="prompter-editor">
				<RyuAppSection title="Script">
					<RyuAppField label="Name">
						<Input
							aria-label="Script name"
							maxLength={200}
							onChange={(event) =>
								onDraftChange({ ...draft, name: event.target.value })
							}
							placeholder={defaultScriptName(draft.content)}
							value={draft.name}
						/>
					</RyuAppField>
					<RyuAppField
						description={tl(
							"{wordCount} words · about {speakingTime} at {wordsPerMinute} words per minute. Text in [brackets] is shown as a cue and never needs to be spoken.",
							{
								wordCount,
								speakingTime: speakingTime(wordCount, settings.wordsPerMinute),
								wordsPerMinute: settings.wordsPerMinute,
							}
						)}
						label="Text"
					>
						<Textarea
							aria-label="Script text"
							className="prompter-editor__text"
							onChange={(event) =>
								onDraftChange({ ...draft, content: event.target.value })
							}
							placeholder="Write or paste what you want to say."
							spellCheck
							value={draft.content}
						/>
					</RyuAppField>
					<div className="prompter-inline">
						<Switch
							checked={draft.markdown}
							id={markdownId}
							onCheckedChange={(checked) =>
								onDraftChange({ ...draft, markdown: checked })
							}
						/>
						<Label htmlFor={markdownId}>
							Format headings, lists, and emphasis
						</Label>
					</div>
					<RyuAppActions>
						<Button
							disabled={busy || unchanged || wordCount === 0}
							onClick={save}
							variant="secondary"
						>
							{busy ? (
								<Spinner />
							) : (
								<HugeiconsIcon aria-hidden="true" icon={FloppyDiskIcon} />
							)}
							{saved ? "Save changes" : "Save script"}
						</Button>
						<Button
							disabled={busy}
							onClick={() =>
								onDraftChange({
									id: null,
									name: "",
									content: "",
									markdown: draft.markdown,
								})
							}
							variant="ghost"
						>
							<HugeiconsIcon aria-hidden="true" icon={PlusSignIcon} />
							New script
						</Button>
						{saved ? (
							<Button
								disabled={busy}
								onClick={() => setDeleteOpen(true)}
								variant="ghost"
							>
								<HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
								Delete
							</Button>
						) : null}
					</RyuAppActions>
					<p aria-live="polite" className="prompter-status" role="status">
						{error || storageError ? (
							<span className="prompter-status__error">
								{error ?? storageError}
							</span>
						) : (
							notice
						)}
					</p>
				</RyuAppSection>
				<RyuAppSection title="Saved scripts">
					{preview ? (
						<Badge variant="outline">Preview: not saved to Ryu</Badge>
					) : null}
					{scripts.isLoading ? (
						<Spinner aria-label="Loading saved scripts" />
					) : null}
					{scripts.isError ? (
						<p className="prompter-status__error" role="alert">
							{tl("Couldn't load saved scripts: {error}", {
								error: errorMessage(scripts.error),
							})}
						</p>
					) : null}
					{!(scripts.isLoading || scripts.isError) &&
					(scripts.data?.length ?? 0) === 0 ? (
						<RyuAppEmpty
							description="Save a script to keep it here for your next take."
							title="No saved scripts"
						/>
					) : null}
					{scripts.data && scripts.data.length > 0 ? (
						<RyuAppList aria-label="Saved scripts">
							{scripts.data.map((script) => (
								<RyuAppListItem
									key={script.id}
									onClick={() => open(script)}
									selected={script.id === draft.id}
									subtitle={tl("{wordCount} words · {updatedDate}", {
										wordCount: buildScript(script.content, script.markdown)
											.words.length,
										updatedDate: formatDate(script.updatedAt),
									})}
									title={script.name}
								/>
							))}
						</RyuAppList>
					) : null}
				</RyuAppSection>
			</RyuAppMain>
			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this script?</DialogTitle>
						<DialogDescription>
							{tl(
								"“{name}” is removed from your saved scripts. The text stays in the editor until you replace it.",
								{ name: saved?.name ?? "" }
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={() => setDeleteOpen(false)} variant="ghost">
							Keep script
						</Button>
						<Button onClick={remove} variant="destructive">
							Delete script
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
