import { expect, test } from "bun:test";
import type {
	MediaRecordingInput,
	MediaRecordingResult,
} from "@ryu/app-host/media-recording";
import { STT_SAMPLE_RATE, wavDataUrl } from "./audio-window.ts";
import type { TeleprompterBridge } from "./bridge.ts";
import {
	friendlyVoiceError,
	VoiceFollower,
	type VoiceStatus,
} from "./voice.ts";

function speech(seconds: number, amplitude = 0.3): Float32Array {
	const samples = new Float32Array(Math.round(STT_SAMPLE_RATE * seconds));
	for (let index = 0; index < samples.length; index += 1) {
		samples[index] =
			amplitude * Math.sin((2 * Math.PI * 180 * index) / STT_SAMPLE_RATE);
	}
	return samples;
}

function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve, reject) => {
		const poll = () => {
			if (check()) {
				resolve();
			} else if (Date.now() > deadline) {
				reject(new Error("Timed out"));
			} else {
				setTimeout(poll, 5);
			}
		};
		poll();
	});
}

/** A host that records one clip per start/stop and records every call. */
function fakeHost(clips: Float32Array[], transcripts: string[]) {
	const calls: MediaRecordingInput["action"][] = [];
	const uploads: string[] = [];
	let clip = 0;
	let state: MediaRecordingResult["state"] = "idle";
	const recording = async (
		input: MediaRecordingInput
	): Promise<MediaRecordingResult> => {
		calls.push(input.action);
		if (input.action === "start") {
			state = "recording";
			return { available: true, background: false, state, id: "clip-1" };
		}
		if (input.action === "stop") {
			state = "pending";
		}
		if (input.action === "discard") {
			state = "idle";
		}
		if (input.action === "read") {
			const samples = clips[clip % clips.length] ?? new Float32Array(0);
			clip += 1;
			return {
				available: true,
				background: false,
				state,
				id: "clip-1",
				audio: await wavDataUrl(samples),
			};
		}
		return { available: true, background: false, state, id: "clip-1" };
	};
	const host: TeleprompterBridge = {
		media: {
			recording,
			transcribe: (input) => {
				uploads.push(input.audio);
				return Promise.resolve(transcripts[uploads.length - 1] ?? "");
			},
		},
	};
	return { calls, host, uploads };
}

test("records short clips, skips silence, and transcribes overlapping windows", async () => {
	const { calls, host, uploads } = fakeHost(
		[speech(0.2), new Float32Array(3200), speech(0.2)],
		["good evening", "and welcome"]
	);
	const heard: string[] = [];
	const statuses: VoiceStatus[] = [];
	const follower = new VoiceFollower(host, {
		clipMs: 5,
		overlapMs: 100,
		onError: (message) => {
			throw new Error(message);
		},
		onStatus: (status) => statuses.push(status),
		onTranscript: (text) => heard.push(text),
	});
	await follower.start();
	await until(() => heard.length >= 2);
	await follower.stop();
	expect(heard.slice(0, 2)).toEqual(["good evening", "and welcome"]);
	expect(uploads[0]?.startsWith("data:audio/wav;base64,")).toBe(true);
	// The second window carries the previous clip's tail ahead of the new clip.
	expect((uploads[1]?.length ?? 0) > (uploads[0]?.length ?? 0)).toBe(true);
	expect(calls[0]).toBe("status");
	expect(calls).toContain("discard");
	expect(statuses).toEqual(
		expect.arrayContaining(["starting", "listening", "stopping", "idle"])
	);
	expect(statuses.at(-1)).toBe("idle");
	expect(follower.running).toBe(false);
});

test("reports missing speech-to-text without starting the microphone", async () => {
	const errors: string[] = [];
	const follower = new VoiceFollower(
		{},
		{
			onError: (message) => errors.push(message),
			onStatus: () => undefined,
			onTranscript: () => undefined,
		}
	);
	await follower.start();
	expect(follower.running).toBe(false);
	expect(errors[0]).toContain("Speech recognition isn't available");
});

test("explains an unavailable host microphone", async () => {
	const errors: string[] = [];
	const follower = new VoiceFollower(
		{
			media: {
				recording: () =>
					Promise.resolve({
						available: false,
						background: false,
						state: "idle",
						message:
							"Microphone capture is unavailable on this surface. Import audio instead.",
					}),
				transcribe: () => Promise.resolve(""),
			},
		},
		{
			onError: (message) => errors.push(message),
			onStatus: () => undefined,
			onTranscript: () => undefined,
		}
	);
	await follower.start();
	expect(follower.running).toBe(false);
	expect(errors[0]).toContain("Open Teleprompter in Ryu Desktop or Island");
});

test("maps host errors to actionable messages", () => {
	expect(
		friendlyVoiceError(new Error("media.transcribe is not available"))
	).toContain("Voice app");
	expect(
		friendlyVoiceError(
			new Error(
				"Another app is using the microphone. Stop its recording first."
			)
		)
	).toContain("Another app");
	expect(
		friendlyVoiceError(new Error("NotAllowedError: Permission denied"))
	).toContain("microphone access");
	expect(friendlyVoiceError("x")).toBe("Something went wrong. Try again.");
});

/**
 * One recording slot per app, like Desktop's host: clips of two followers in
 * the same frame share it, and a discarded clip can no longer be used.
 */
function sharedSlotHost(transcript: string) {
	let next = 0;
	let active: { id: string; state: MediaRecordingResult["state"] } | null =
		null;
	const discarded: string[] = [];
	const gone = () =>
		Promise.reject(
			new Error("This recording is no longer available to this app.")
		);
	const recording = async (
		input: MediaRecordingInput
	): Promise<MediaRecordingResult> => {
		const base = { available: true, background: false } as const;
		if (input.action === "status") {
			return { ...base, state: active?.state ?? "idle", id: active?.id };
		}
		if (input.action === "start") {
			if (active) {
				return gone();
			}
			next += 1;
			active = { id: `clip-${next}`, state: "recording" };
			return { ...base, ...active };
		}
		if (!active || active.id !== input.id) {
			return gone();
		}
		if (input.action === "discard") {
			discarded.push(active.id);
			active = null;
			return { ...base, state: "idle" };
		}
		if (input.action === "stop") {
			active.state = "pending";
			return { ...base, ...active };
		}
		return { ...base, ...active, audio: await wavDataUrl(speech(0.2)) };
	};
	const host: TeleprompterBridge = {
		media: { recording, transcribe: () => Promise.resolve(transcript) },
	};
	return { discarded, host };
}

test("stopping one session never discards the next session's clip", async () => {
	const { host } = sharedSlotHost("good evening");
	const errors: string[] = [];
	const heard: string[] = [];
	const options = {
		clipMs: 20,
		onError: (message: string) => errors.push(message),
		onStatus: () => undefined,
	};
	const first = new VoiceFollower(host, {
		...options,
		onTranscript: () => undefined,
	});
	await first.start();
	const stopping = first.stop();
	const second = new VoiceFollower(host, {
		...options,
		onTranscript: (text) => heard.push(text),
	});
	await stopping;
	await second.start();
	await until(() => heard.length >= 2);
	await second.stop();
	expect(errors).toEqual([]);
	expect(heard[0]).toBe("good evening");
});

test("a restarted follower transcribes its first window", async () => {
	let release: (() => void) | null = null;
	const { host } = sharedSlotHost("unused");
	const transcripts: string[] = [];
	const media = host.media;
	if (!media) {
		throw new Error("fake host has media");
	}
	let calls = 0;
	media.transcribe = () => {
		calls += 1;
		if (calls === 1) {
			// The first session's request is still in flight after it stops.
			return new Promise((resolve) => {
				release = () => resolve("late");
			});
		}
		return Promise.resolve("fresh");
	};
	const follower = new VoiceFollower(host, {
		clipMs: 10,
		onError: (message) => {
			throw new Error(message);
		},
		onStatus: () => undefined,
		onTranscript: (text) => transcripts.push(text),
	});
	await follower.start();
	await until(() => calls === 1);
	await follower.stop();
	await follower.start();
	await until(() => transcripts.includes("fresh"));
	await follower.stop();
	(release as (() => void) | null)?.();
	expect(transcripts).not.toContain("late");
});
