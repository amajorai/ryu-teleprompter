import {
	ArrowLeft01Icon,
	Mic01Icon,
	PauseIcon,
	PlayIcon,
	PreviousIcon,
	SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { RyuAppSection, RyuAppToolbar } from "@ryu/blocks/companion/app-ui";
import {
	Badge,
	Button,
	Label,
	Switch,
	ToggleGroup,
	ToggleGroupItem,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import {
	type CSSProperties,
	type MouseEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { bridge } from "./bridge.ts";
import type { Draft, Settings } from "./library.ts";
import {
	DisplaySlider,
	prefersReducedMotion,
	statusLabel,
} from "./Prompter-display.tsx";
import { ScriptText } from "./Prompter-script-text.tsx";
import {
	autoScrollStep,
	clampCursor,
	type PrompterAction,
	prompterKeyAction,
	readingScrollTop,
} from "./prompter.ts";
import { buildScript } from "./script.ts";
import { matchTranscript } from "./speech-matcher.ts";
import { VoiceFollower, type VoiceStatus } from "./voice.ts";

interface PrompterProps {
	draft: Draft;
	onExit(): void;
	onSettingsChange(patch: Partial<Settings>): void;
	settings: Settings;
}

/**
 * Stop of the most recent voice session. Kept at module scope so leaving and
 * re-entering the prompter also waits for the old session to release the
 * host microphone before a new one starts.
 */
let previousFollowerStop: Promise<void> = Promise.resolve();

export function Prompter({
	draft,
	onExit,
	onSettingsChange,
	settings,
}: PrompterProps) {
	const tl = useLiteralMessages();
	const script = useMemo(
		() => buildScript(draft.content, draft.markdown),
		[draft.content, draft.markdown]
	);
	const total = script.words.length;
	const [cursor, setCursor] = useState(0);
	const [running, setRunning] = useState(false);
	const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
	const [voiceError, setVoiceError] = useState<string | null>(null);
	const [speaking, setSpeaking] = useState(false);
	const [heard, setHeard] = useState("");
	const [displayOpen, setDisplayOpen] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const startRef = useRef<HTMLButtonElement>(null);
	const bandRef = useRef<HTMLDivElement>(null);
	const wordsRef = useRef(script.words);
	wordsRef.current = script.words;
	const wpmRef = useRef(settings.wordsPerMinute);
	wpmRef.current = settings.wordsPerMinute;
	const mirrorId = useId();

	// Give the frame keyboard focus so shortcuts work inside Island and Desktop.
	useEffect(() => {
		startRef.current?.focus();
	}, []);

	useEffect(() => {
		setCursor((current) => clampCursor(current, total));
	}, [total]);

	useEffect(() => {
		if (running && cursor >= total) {
			setRunning(false);
		}
	}, [cursor, running, total]);

	// Voice following: host microphone clips → Ryu speech-to-text → matcher.
	useEffect(() => {
		if (!(running && settings.follow === "voice")) {
			return;
		}
		setVoiceError(null);
		// Callbacks from a follower whose effect was cleaned up are ignored, so a
		// late "idle" or error cannot overwrite the next session's state.
		let alive = true;
		const follower = new VoiceFollower(bridge(), {
			onError: (message) => {
				if (alive) {
					setVoiceError(message);
					setRunning(false);
				}
			},
			onHeard: (speech) => {
				if (alive) {
					setSpeaking(speech);
				}
			},
			onStatus: (status) => {
				if (alive) {
					setVoiceStatus(status);
				}
			},
			onTranscript: (text) => {
				if (!alive) {
					return;
				}
				setHeard(text);
				setCursor((current) =>
					matchTranscript(text, wordsRef.current, current)
				);
			},
		});
		// Both followers share the host recording owner, so a new session starts
		// only after the previous one has released its clip.
		const started = previousFollowerStop
			.then(() => (alive ? follower.start() : undefined))
			.catch(() => undefined);
		return () => {
			alive = false;
			previousFollowerStop = started
				.then(() => follower.stop())
				.catch(() => undefined);
			setSpeaking(false);
			setVoiceStatus("idle");
		};
	}, [running, settings.follow]);

	// Auto-scroll fallback at a steady words-per-minute pace.
	useEffect(() => {
		if (!(running && settings.follow === "auto")) {
			return;
		}
		let carry = 0;
		let last = performance.now();
		let frame = 0;
		const tick = (now: number) => {
			const step = autoScrollStep(carry, now - last, wpmRef.current);
			last = now;
			carry = step.carry;
			if (step.words > 0) {
				setCursor((current) => clampCursor(current + step.words, total));
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [running, settings.follow, total]);

	// Keep the current word on the reading line.
	useLayoutEffect(() => {
		const container = scrollRef.current;
		if (!container || total === 0) {
			return;
		}
		const target = Math.min(cursor, total - 1);
		const word = container.querySelector<HTMLElement>(
			`[data-word="${target}"]`
		);
		if (!word) {
			return;
		}
		const rect = word.getBoundingClientRect();
		const wordCenter =
			rect.top +
			rect.height / 2 -
			container.getBoundingClientRect().top +
			container.scrollTop;
		container.scrollTo({
			top: readingScrollTop(
				wordCenter,
				container.clientHeight,
				settings.readingLine,
				bandRef.current?.offsetHeight ?? 0
			),
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	}, [
		cursor,
		total,
		settings.readingLine,
		settings.fontSize,
		settings.lineWidth,
	]);

	const toggle = useCallback(() => {
		setVoiceError(null);
		// Starting again from the last word replays the script from the top.
		if (!running && cursor >= total) {
			setCursor(0);
		}
		setRunning(!running);
	}, [cursor, running, total]);

	const perform = useCallback(
		(action: PrompterAction) => {
			if (action.kind === "toggle") {
				toggle();
			} else if (action.kind === "move") {
				setCursor((current) => clampCursor(current + action.words, total));
			} else if (action.kind === "restart") {
				setCursor(0);
			} else {
				setRunning(false);
				onExit();
			}
		},
		[onExit, toggle, total]
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const action = prompterKeyAction(event);
			if (action) {
				event.preventDefault();
				perform(action);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [perform]);

	function jumpToWord(event: MouseEvent<HTMLDivElement>) {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}
		const word = target.closest<HTMLElement>("[data-word]")?.dataset.word;
		if (word !== undefined) {
			setCursor(clampCursor(Number(word), total));
		}
	}

	const status = statusLabel(running, settings.follow, voiceStatus);
	const viewportStyle = {
		"--prompter-font-size": `${settings.fontSize}px`,
		"--prompter-line-width": `${settings.lineWidth}ch`,
		"--prompter-reading-line": `${settings.readingLine}%`,
	} as CSSProperties;

	return (
		<div className="prompter" data-display={displayOpen ? "open" : "closed"}>
			<RyuAppToolbar
				actions={
					<>
						<Badge
							aria-live="polite"
							className="prompter-badge"
							data-speaking={running && speaking ? "true" : "false"}
							role="status"
							variant={running ? "default" : "outline"}
						>
							{settings.follow === "voice" && running ? (
								<HugeiconsIcon aria-hidden="true" icon={Mic01Icon} />
							) : null}
							{status}
						</Badge>
						<span className="prompter-progress">
							{Math.min(cursor, total)} / {total}
						</span>
					</>
				}
				className="prompter-toolbar"
			>
				<div className="prompter-controls">
					<Button
						aria-keyshortcuts="Escape"
						onClick={() => perform({ kind: "exit" })}
						size="sm"
						title="Back to the editor (Esc)"
						variant="ghost"
					>
						<HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
						<span className="prompter-label">Edit</span>
					</Button>
					<Button
						aria-keyshortcuts="Space"
						disabled={total === 0}
						onClick={toggle}
						ref={startRef}
						size="sm"
						title={running ? "Pause (Space)" : "Start (Space)"}
					>
						<HugeiconsIcon
							aria-hidden="true"
							icon={running ? PauseIcon : PlayIcon}
						/>
						<span className="prompter-label">
							{running ? "Pause" : "Start"}
						</span>
					</Button>
					<Button
						aria-keyshortcuts="Home"
						aria-label="Back to the start"
						onClick={() => perform({ kind: "restart" })}
						size="sm"
						title="Back to the start (Home)"
						variant="ghost"
					>
						<HugeiconsIcon aria-hidden="true" icon={PreviousIcon} />
					</Button>
					<ToggleGroup
						aria-label="Scroll mode"
						onValueChange={(values: string[]) => {
							const next = values[0];
							if (next === "voice" || next === "auto") {
								onSettingsChange({ follow: next });
							}
						}}
						size="sm"
						spacing={0}
						value={[settings.follow]}
						variant="outline"
					>
						<ToggleGroupItem title="Follow my voice" value="voice">
							Voice
						</ToggleGroupItem>
						<ToggleGroupItem title="Scroll at a steady pace" value="auto">
							Auto
						</ToggleGroupItem>
					</ToggleGroup>
					<Button
						aria-expanded={displayOpen}
						onClick={() => setDisplayOpen((open) => !open)}
						size="sm"
						title="Display settings"
						variant="ghost"
					>
						<HugeiconsIcon aria-hidden="true" icon={SlidersHorizontalIcon} />
						<span className="prompter-label">Display</span>
					</Button>
				</div>
			</RyuAppToolbar>
			{voiceError ? (
				<div className="prompter-alert" role="alert">
					<span>{voiceError}</span>
					<Button
						onClick={() => {
							onSettingsChange({ follow: "auto" });
							setVoiceError(null);
						}}
						size="sm"
						variant="secondary"
					>
						Use auto-scroll
					</Button>
				</div>
			) : null}
			<div className="prompter-body">
				<section
					aria-label="Script"
					className="prompter-viewport"
					style={viewportStyle}
				>
					<div
						aria-hidden="true"
						className="prompter-reading-line"
						ref={bandRef}
					/>
					{/* Words are also reachable with the arrow-key shortcuts. */}
					{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut for jumping to a word; arrows move by keyboard */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: arrow-key shortcuts provide the keyboard path */}
					<div className="prompter-scroll" onClick={jumpToWord} ref={scrollRef}>
						<div className="prompter-spacer-top" />
						<div
							className="prompter-text"
							data-mirror={settings.mirror ? "true" : "false"}
						>
							<ScriptText cursor={cursor} script={script} />
						</div>
						<div className="prompter-spacer-bottom" />
					</div>
					{settings.follow === "voice" && heard && running ? (
						<p className="prompter-heard">
							{tl("Heard: “{heard}”", { heard })}
						</p>
					) : null}
				</section>
				{displayOpen ? (
					<RyuAppSection className="prompter-display" title="Display">
						<DisplaySlider
							label="Text size"
							max={160}
							min={16}
							onChange={(fontSize) => onSettingsChange({ fontSize })}
							unit="px"
							value={settings.fontSize}
						/>
						<DisplaySlider
							label="Line width"
							max={90}
							min={16}
							onChange={(lineWidth) => onSettingsChange({ lineWidth })}
							unit=" characters"
							value={settings.lineWidth}
						/>
						<DisplaySlider
							label="Reading line"
							max={70}
							min={5}
							onChange={(readingLine) => onSettingsChange({ readingLine })}
							unit="% from top"
							value={settings.readingLine}
						/>
						<DisplaySlider
							label="Auto-scroll speed"
							max={260}
							min={60}
							onChange={(wordsPerMinute) =>
								onSettingsChange({ wordsPerMinute })
							}
							step={5}
							unit=" words/min"
							value={settings.wordsPerMinute}
						/>
						<div className="prompter-inline">
							<Switch
								checked={settings.mirror}
								id={mirrorId}
								onCheckedChange={(mirror) => onSettingsChange({ mirror })}
							/>
							<Label htmlFor={mirrorId}>
								Mirror text for teleprompter glass
							</Label>
						</div>
						<p className="prompter-hint">
							Space starts or pauses. Arrow keys move 5 or 15 words. Home goes
							back to the start. Escape returns to the editor. Click a word to
							jump to it.
						</p>
					</RyuAppSection>
				) : null}
			</div>
		</div>
	);
}
