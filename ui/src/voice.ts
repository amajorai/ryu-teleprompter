/**
 * Voice following through Ryu's own speech-to-text.
 *
 * Companion frames cannot open the microphone themselves, so audio comes from
 * the host's `media.recording` in short start/stop clips. Each clip is gated
 * for speech, stitched with the tail of the previous clip, encoded as 16 kHz
 * WAV, and transcribed through `media.transcribe` with the user's Voice
 * Recognition engine, which the host chooses.
 * A direct microphone path is used only where the frame is allowed one.
 */

import { downsample } from "@ryu/blocks/companion/audio-pcm";
import {
	EnergyGate,
	type Pcm,
	parseWavDataUrl,
	RollingWindow,
	STT_SAMPLE_RATE,
	wavDataUrl,
} from "./audio-window.ts";
import {
	errorMessage,
	type TeleprompterBridge,
	transcriptText,
} from "./bridge.ts";

export type VoiceStatus = "idle" | "starting" | "listening" | "stopping";

export interface VoiceFollowerOptions {
	/** Length of each recorded clip. */
	clipMs?: number;
	onError(message: string): void;
	onHeard?(hasSpeech: boolean): void;
	onStatus(status: VoiceStatus): void;
	onTranscript(text: string): void;
	/** Audio from the previous clip repeated at the start of each window. */
	overlapMs?: number;
}

/** Produces consecutive short clips of microphone audio. */
interface ClipSource {
	close(): Promise<void>;
	next(signal: AbortSignal): Promise<Pcm | null>;
	open(): Promise<void>;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}

const UNAVAILABLE_SPEECH =
	"Speech recognition isn't available here. Turn on the Voice app in Ryu, or switch to auto-scroll.";

export function friendlyVoiceError(reason: unknown): string {
	const message = errorMessage(reason);
	if (/unavailable on this surface|capture isn't available/i.test(message)) {
		return "Voice following isn't available in this window. Open Teleprompter in Ryu Desktop or Island, or switch to auto-scroll.";
	}
	if (/not available|not_found|voice app|disabled/i.test(message)) {
		return UNAVAILABLE_SPEECH;
	}
	if (/another app is using the microphone/i.test(message)) {
		return "Another app is using the microphone. Stop its recording, then start the prompter again.";
	}
	if (/denied|notallowed|permission/i.test(message)) {
		return "Ryu doesn't have microphone access. Allow it in your system settings, or switch to auto-scroll.";
	}
	return message;
}

/** Host-owned capture: one clip per start/stop cycle via `media.recording`. */
class HostClipSource implements ClipSource {
	constructor(
		private readonly recording: NonNullable<
			NonNullable<TeleprompterBridge["media"]>["recording"]
		>,
		private readonly clipMs: number
	) {}

	/** The clip this source started and has not yet discarded. */
	private current: string | null = null;

	async open() {
		const status = await this.recording({ action: "status" });
		if (!status.available) {
			throw new Error(
				status.message ??
					"Microphone capture isn't available in this window. Open Teleprompter in Ryu Desktop or Island, or switch to auto-scroll."
			);
		}
		// A clip left over from an interrupted session of this frame would block a
		// new start. The Prompter waits for the previous follower to stop before
		// opening another, so this never discards a live session's clip.
		if (status.id && status.state !== "idle") {
			await this.recording({ action: "discard", id: status.id });
		}
	}

	async next(signal: AbortSignal): Promise<Pcm | null> {
		const started = await this.recording({ action: "start" });
		if (!started.id || started.state !== "recording") {
			throw new Error(
				started.message ?? "The microphone could not start recording."
			);
		}
		const id = started.id;
		this.current = id;
		try {
			await wait(this.clipMs, signal);
			await this.recording({ action: "stop", id });
			if (signal.aborted) {
				return null;
			}
			const clip = await this.recording({ action: "read", id });
			return clip.audio ? parseWavDataUrl(clip.audio) : null;
		} finally {
			if (this.current === id) {
				this.current = null;
			}
			await this.recording({ action: "discard", id }).catch(() => undefined);
		}
	}

	/** Discards only a clip this source started, never another session's. */
	async close() {
		const id = this.current;
		this.current = null;
		if (id) {
			await this.recording({ action: "discard", id }).catch(() => undefined);
		}
	}
}

/** In-frame microphone, for hosts that grant the frame its own capture. */
class DirectMicSource implements ClipSource {
	private stream: MediaStream | null = null;
	private context: AudioContext | null = null;
	private processor: ScriptProcessorNode | null = null;
	private frames: Float32Array[] = [];

	constructor(private readonly clipMs: number) {}

	async open() {
		const media = globalThis.navigator?.mediaDevices;
		if (!media?.getUserMedia) {
			throw new Error(UNAVAILABLE_SPEECH);
		}
		this.stream = await media.getUserMedia({
			audio: {
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
			},
		});
		this.context = new AudioContext();
		const source = this.context.createMediaStreamSource(this.stream);
		this.processor = this.context.createScriptProcessor(4096, 1, 1);
		this.processor.onaudioprocess = (event) => {
			this.frames.push(new Float32Array(event.inputBuffer.getChannelData(0)));
		};
		source.connect(this.processor);
		this.processor.connect(this.context.destination);
		await this.context.resume();
	}

	async next(signal: AbortSignal): Promise<Pcm | null> {
		await wait(this.clipMs, signal);
		const context = this.context;
		if (signal.aborted || !context) {
			return null;
		}
		const frames = this.frames;
		this.frames = [];
		const merged = new Float32Array(
			frames.reduce((total, frame) => total + frame.length, 0)
		);
		let offset = 0;
		for (const frame of frames) {
			merged.set(frame, offset);
			offset += frame.length;
		}
		return {
			sampleRate: STT_SAMPLE_RATE,
			samples: downsample(merged, context.sampleRate, STT_SAMPLE_RATE),
		};
	}

	async close() {
		this.processor?.disconnect();
		for (const track of this.stream?.getTracks() ?? []) {
			track.stop();
		}
		await this.context?.close().catch(() => undefined);
		this.processor = null;
		this.stream = null;
		this.context = null;
		this.frames = [];
	}
}

/**
 * Runs capture and transcription concurrently: while one window is being
 * transcribed the next clip is recording. Only the newest waiting window is
 * kept, because a prompter cares about where the speaker is now.
 */
export class VoiceFollower {
	private controller: AbortController | null = null;
	private source: ClipSource | null = null;
	private readonly gate = new EnergyGate();
	private readonly window: RollingWindow;
	private readonly clipMs: number;
	private pending: Float32Array | null = null;
	/** Session whose drain loop is running; a stopped session's loop never blocks the next. */
	private drainingFor: AbortSignal | null = null;
	private loop: Promise<void> | null = null;

	constructor(
		private readonly host: TeleprompterBridge | null,
		private readonly options: VoiceFollowerOptions
	) {
		this.clipMs = options.clipMs ?? 2500;
		this.window = new RollingWindow(options.overlapMs ?? 800);
	}

	get running(): boolean {
		return this.controller !== null;
	}

	async start(): Promise<void> {
		if (this.controller) {
			return;
		}
		if (!this.host?.media?.transcribe) {
			this.options.onError(UNAVAILABLE_SPEECH);
			return;
		}
		const controller = new AbortController();
		this.controller = controller;
		this.options.onStatus("starting");
		try {
			this.source = await this.openSource();
		} catch (reason) {
			this.controller = null;
			this.options.onStatus("idle");
			this.options.onError(friendlyVoiceError(reason));
			return;
		}
		if (controller.signal.aborted) {
			await this.source.close();
			this.source = null;
			return;
		}
		this.window.reset();
		this.gate.reset();
		this.options.onStatus("listening");
		this.loop = this.capture(controller.signal, this.source);
	}

	async stop(): Promise<void> {
		const controller = this.controller;
		if (!controller) {
			return;
		}
		this.options.onStatus("stopping");
		controller.abort();
		await this.loop?.catch(() => undefined);
		await this.source?.close().catch(() => undefined);
		this.source = null;
		this.loop = null;
		this.pending = null;
		this.controller = null;
		this.options.onStatus("idle");
	}

	private async openSource(): Promise<ClipSource> {
		const recording = this.host?.media?.recording;
		if (recording) {
			const source = new HostClipSource(recording, this.clipMs);
			try {
				await source.open();
				return source;
			} catch (reason) {
				// Fall through to an in-frame microphone only where one exists.
				const direct = new DirectMicSource(this.clipMs);
				try {
					await direct.open();
					return direct;
				} catch {
					await direct.close();
					throw reason;
				}
			}
		}
		const direct = new DirectMicSource(this.clipMs);
		try {
			await direct.open();
		} catch (reason) {
			await direct.close();
			throw reason;
		}
		return direct;
	}

	private async capture(signal: AbortSignal, source: ClipSource) {
		while (!signal.aborted) {
			let clip: Pcm | null;
			try {
				clip = await source.next(signal);
			} catch (reason) {
				if (!signal.aborted) {
					this.options.onError(friendlyVoiceError(reason));
					this.stop().catch(() => undefined);
				}
				return;
			}
			if (!clip || signal.aborted) {
				continue;
			}
			const samples =
				clip.sampleRate === STT_SAMPLE_RATE
					? clip.samples
					: downsample(clip.samples, clip.sampleRate, STT_SAMPLE_RATE);
			const speech = this.gate.hasSpeech({
				sampleRate: STT_SAMPLE_RATE,
				samples,
			});
			this.options.onHeard?.(speech);
			const window = this.window.push(samples);
			if (speech) {
				this.pending = window;
				this.drain(signal).catch(() => undefined);
			}
		}
	}

	private async drain(signal: AbortSignal) {
		if (this.drainingFor === signal) {
			return;
		}
		this.drainingFor = signal;
		try {
			while (this.pending && !signal.aborted) {
				const window = this.pending;
				this.pending = null;
				const transcribe = this.host?.media?.transcribe;
				if (!transcribe) {
					throw new Error(UNAVAILABLE_SPEECH);
				}
				const payload = await transcribe({
					audio: await wavDataUrl(window),
					filename: "prompter.wav",
					detailed: false,
				});
				const text = transcriptText(payload);
				if (text && !signal.aborted) {
					this.options.onTranscript(text);
				}
			}
		} catch (reason) {
			if (!signal.aborted) {
				this.options.onError(friendlyVoiceError(reason));
				this.stop().catch(() => undefined);
			}
		} finally {
			if (this.drainingFor === signal) {
				this.drainingFor = null;
			}
		}
	}
}
