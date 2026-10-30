import { RyuAppField } from "@ryu/blocks/companion/app-ui";
import { Slider } from "@ryu/ui/components/slider.tsx";
import type { Settings } from "./library.ts";
import type { VoiceStatus } from "./voice.ts";

function sliderNumber(value: number | readonly number[]): number {
	return typeof value === "number" ? value : (value[0] ?? 0);
}

export function DisplaySlider({
	label,
	max,
	min,
	onChange,
	step = 1,
	unit,
	value,
}: {
	label: string;
	max: number;
	min: number;
	onChange(value: number): void;
	step?: number;
	unit: string;
	value: number;
}) {
	return (
		<RyuAppField label={`${label} · ${value}${unit}`}>
			<Slider
				aria-label={label}
				max={max}
				min={min}
				onValueChange={(next) => onChange(sliderNumber(next))}
				step={step}
				value={value}
			/>
		</RyuAppField>
	);
}

export function statusLabel(
	running: boolean,
	follow: Settings["follow"],
	voice: VoiceStatus
): string {
	if (!running) {
		return "Paused";
	}
	if (follow === "auto") {
		return "Auto-scrolling";
	}
	if (voice === "starting") {
		return "Starting microphone…";
	}
	if (voice === "stopping") {
		return "Stopping…";
	}
	return "Listening";
}

export function prefersReducedMotion(): boolean {
	return (
		globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
	);
}
