import { describe, expect, test } from "bun:test";
import { encodeWav } from "@ryu/blocks/companion/audio-pcm";
import {
	base64ToBytes,
	bytesToBase64,
	EnergyGate,
	parseWav,
	parseWavDataUrl,
	RollingWindow,
	STT_SAMPLE_RATE,
	wavDataUrl,
} from "./audio-window.ts";

function tone(seconds: number, amplitude: number): Float32Array {
	const samples = new Float32Array(Math.round(STT_SAMPLE_RATE * seconds));
	for (let index = 0; index < samples.length; index += 1) {
		samples[index] =
			amplitude * Math.sin((2 * Math.PI * 220 * index) / STT_SAMPLE_RATE);
	}
	return samples;
}

describe("wav", () => {
	test("round-trips 16-bit mono PCM through a data URL", async () => {
		const source = tone(0.1, 0.5);
		const decoded = parseWavDataUrl(await wavDataUrl(source));
		expect(decoded.sampleRate).toBe(STT_SAMPLE_RATE);
		expect(decoded.samples.length).toBe(source.length);
		expect(
			Math.abs((decoded.samples[40] ?? 0) - (source[40] ?? 0))
		).toBeLessThan(0.001);
	});

	test("mixes stereo to mono and rejects other files", () => {
		const bytes = new Uint8Array(44 + 8);
		const view = new DataView(bytes.buffer);
		const ascii = (offset: number, text: string) => {
			for (let index = 0; index < text.length; index += 1) {
				view.setUint8(offset + index, text.charCodeAt(index));
			}
		};
		ascii(0, "RIFF");
		view.setUint32(4, 44, true);
		ascii(8, "WAVE");
		ascii(12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 2, true);
		view.setUint32(24, 8000, true);
		view.setUint16(34, 16, true);
		ascii(36, "data");
		view.setUint32(40, 8, true);
		view.setInt16(44, 16_384, true);
		view.setInt16(46, 0, true);
		view.setInt16(48, -16_384, true);
		view.setInt16(50, -16_384, true);
		const { samples, sampleRate } = parseWav(bytes);
		expect(sampleRate).toBe(8000);
		expect([...samples]).toEqual([0.25, -0.5]);
		expect(() => parseWav(new Uint8Array(20))).toThrow("not a WAV");
		expect(() => parseWavDataUrl("data:text/plain;base64,AA==")).toThrow();
	});

	test("base64 helpers round-trip large buffers", async () => {
		const bytes = new Uint8Array(
			await encodeWav(tone(1, 0.2), STT_SAMPLE_RATE).arrayBuffer()
		);
		expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
	});
});

describe("energy gate", () => {
	test("passes speech-level audio and skips silence and room hum", () => {
		const gate = new EnergyGate();
		expect(
			gate.hasSpeech({ sampleRate: STT_SAMPLE_RATE, samples: tone(1, 0.002) })
		).toBe(false);
		const speech = new Float32Array(STT_SAMPLE_RATE);
		speech.set(tone(0.4, 0.3), 4000);
		expect(
			gate.hasSpeech({ sampleRate: STT_SAMPLE_RATE, samples: speech })
		).toBe(true);
		expect(
			gate.hasSpeech({
				sampleRate: STT_SAMPLE_RATE,
				samples: new Float32Array(0),
			})
		).toBe(false);
	});

	test("ignores a click shorter than the minimum speech length", () => {
		const clip = new Float32Array(STT_SAMPLE_RATE);
		clip.set(tone(0.03, 0.8), 1000);
		expect(
			new EnergyGate().hasSpeech({ sampleRate: STT_SAMPLE_RATE, samples: clip })
		).toBe(false);
	});
});

describe("rolling window", () => {
	test("prefixes each clip with the previous tail", () => {
		const window = new RollingWindow(1000, 4);
		expect([...window.push(new Float32Array([1, 2, 3, 4, 5, 6]))]).toEqual([
			1, 2, 3, 4, 5, 6,
		]);
		expect([...window.push(new Float32Array([7, 8]))]).toEqual([
			3, 4, 5, 6, 7, 8,
		]);
		window.reset();
		expect([...window.push(new Float32Array([9]))]).toEqual([9]);
	});
});

test("continuous speech does not raise the noise floor past speech", () => {
	const gate = new EnergyGate();
	for (let clip = 0; clip < 20; clip += 1) {
		expect(
			gate.hasSpeech({ sampleRate: STT_SAMPLE_RATE, samples: tone(0.5, 0.3) })
		).toBe(true);
	}
});
