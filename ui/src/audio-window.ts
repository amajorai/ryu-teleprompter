/**
 * Pure audio helpers for voice following: WAV decode/encode, a speech energy
 * gate, and short rolling windows with overlap so a word split across two
 * clips is still heard whole by the speech-to-text engine.
 */

import { encodeWav } from "@ryu/blocks/companion/audio-pcm";

export const STT_SAMPLE_RATE = 16_000;

export interface Pcm {
	sampleRate: number;
	samples: Float32Array;
}

function ascii(view: DataView, offset: number, length: number): string {
	let text = "";
	for (let index = 0; index < length; index += 1) {
		text += String.fromCharCode(view.getUint8(offset + index));
	}
	return text;
}

/** Decode a 16-bit PCM RIFF/WAVE file to mono floats (channels are averaged). */
export function parseWav(bytes: Uint8Array): Pcm {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		bytes.byteLength < 12 ||
		ascii(view, 0, 4) !== "RIFF" ||
		ascii(view, 8, 4) !== "WAVE"
	) {
		throw new Error("The recording is not a WAV file.");
	}
	let offset = 12;
	let channels = 1;
	let sampleRate = STT_SAMPLE_RATE;
	let bitsPerSample = 16;
	let format = 1;
	while (offset + 8 <= bytes.byteLength) {
		const id = ascii(view, offset, 4);
		const size = view.getUint32(offset + 4, true);
		const body = offset + 8;
		if (id === "fmt ") {
			format = view.getUint16(body, true);
			channels = view.getUint16(body + 2, true);
			sampleRate = view.getUint32(body + 4, true);
			bitsPerSample = view.getUint16(body + 14, true);
		} else if (id === "data") {
			if (format !== 1 || bitsPerSample !== 16 || channels < 1) {
				throw new Error("Only 16-bit PCM recordings are supported.");
			}
			const available = Math.min(size, bytes.byteLength - body);
			const frames = Math.floor(available / (2 * channels));
			const samples = new Float32Array(frames);
			for (let frame = 0; frame < frames; frame += 1) {
				let sum = 0;
				for (let channel = 0; channel < channels; channel += 1) {
					sum += view.getInt16(body + (frame * channels + channel) * 2, true);
				}
				samples[frame] = sum / channels / 0x80_00;
			}
			return { sampleRate, samples };
		}
		offset = body + size + (size % 2);
	}
	throw new Error("The recording has no audio data.");
}

export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 8192) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
	}
	return btoa(binary);
}

const DATA_URL = /^data:audio\/[\w.+-]+(?:;[\w=.-]+)*;base64,(.*)$/s;

export function parseWavDataUrl(dataUrl: string): Pcm {
	const match = DATA_URL.exec(dataUrl);
	if (!match?.[1]) {
		throw new Error("The recording audio is unavailable.");
	}
	return parseWav(base64ToBytes(match[1]));
}

export async function wavDataUrl(samples: Float32Array): Promise<string> {
	const wav = encodeWav(samples, STT_SAMPLE_RATE);
	return `data:audio/wav;base64,${bytesToBase64(new Uint8Array(await wav.arrayBuffer()))}`;
}

function frameRms(samples: Float32Array, start: number, end: number): number {
	let sum = 0;
	for (let index = start; index < end; index += 1) {
		const value = samples[index] ?? 0;
		sum += value * value;
	}
	return Math.sqrt(sum / Math.max(1, end - start));
}

/** Above this RMS a frame always counts as speech, however noisy the room. */
const MAX_THRESHOLD = 0.08;

export interface EnergyGateOptions {
	/** Analysis frame length in ms. */
	frameMs?: number;
	/** Absolute RMS floor that always counts as silence. */
	minRms?: number;
	/** Minimum loud speech, in ms, before a clip is worth transcribing. */
	minSpeechMs?: number;
	/** Speech must be this many times louder than the tracked noise floor. */
	noiseRatio?: number;
}

/**
 * Skips silent clips so Core is only asked to transcribe audio that probably
 * contains speech. The noise floor adapts to the room from quiet frames.
 */
export class EnergyGate {
	private noiseFloor: number | null = null;
	private readonly frameMs: number;
	private readonly minSpeechMs: number;
	private readonly minRms: number;
	private readonly noiseRatio: number;

	constructor(options: EnergyGateOptions = {}) {
		this.frameMs = options.frameMs ?? 20;
		this.minSpeechMs = options.minSpeechMs ?? 120;
		this.minRms = options.minRms ?? 0.01;
		this.noiseRatio = options.noiseRatio ?? 2.5;
	}

	/** Forget the learned noise floor, for a new listening session. */
	reset() {
		this.noiseFloor = null;
	}

	hasSpeech({ sampleRate, samples }: Pcm): boolean {
		const frameLength = Math.max(
			1,
			Math.round((sampleRate * this.frameMs) / 1000)
		);
		const levels: number[] = [];
		for (let start = 0; start < samples.length; start += frameLength) {
			levels.push(
				frameRms(samples, start, Math.min(samples.length, start + frameLength))
			);
		}
		if (levels.length === 0) {
			return false;
		}
		const sorted = [...levels].sort((left, right) => left - right);
		const quiet = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
		// The floor drops at once in a quieter room but rises slowly, so a clip
		// of continuous speech cannot teach the gate that speech is noise.
		const floor = this.noiseFloor ?? Math.min(quiet, this.minRms);
		this.noiseFloor = quiet < floor ? quiet : floor + (quiet - floor) * 0.1;
		const threshold = Math.max(
			this.minRms,
			Math.min(this.noiseFloor * this.noiseRatio, MAX_THRESHOLD)
		);
		const loudFrames = levels.filter((level) => level > threshold).length;
		return loudFrames * this.frameMs >= this.minSpeechMs;
	}
}

/**
 * Builds overlapping windows from consecutive clips: each window is the tail
 * of the previous clip followed by the new clip.
 */
export class RollingWindow {
	private tail = new Float32Array(0);
	private readonly overlapSamples: number;

	constructor(overlapMs: number, sampleRate = STT_SAMPLE_RATE) {
		this.overlapSamples = Math.max(
			0,
			Math.round((sampleRate * overlapMs) / 1000)
		);
	}

	push(clip: Float32Array): Float32Array {
		const window = new Float32Array(this.tail.length + clip.length);
		window.set(this.tail, 0);
		window.set(clip, this.tail.length);
		this.tail = window.slice(Math.max(0, window.length - this.overlapSamples));
		return window;
	}

	reset() {
		this.tail = new Float32Array(0);
	}
}
