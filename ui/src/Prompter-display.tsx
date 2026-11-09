import { RyuAppField } from "@ryu/blocks/companion/app-ui";
import { useLiteralMessages } from "@ryu/i18n/react";
import { Slider } from "@ryu/ui/components/slider.tsx";
import type { Settings } from "./library.ts";
import type { VoiceStatus } from "./voice.ts";

function sliderNumber(value: number | readonly number[]): number {
	return typeof value === "number" ? value : (value[0] ?? 0);
}

/** A Display slider whose field label reads "Text size · 64px". The caller owns
 *  both halves as whole messages: `label` is already translated, and
 *  `formatValue` words the reading with its unit ("{speed} words/min"), so no
 *  English unit suffix is glued onto a number. */
export function DisplaySlider({
	formatValue,
	label,
	max,
	min,
	onChange,
	step = 1,
	value,
}: {
	formatValue(value: number): string;
	label: string;
	max: number;
	min: number;
	onChange(value: number): void;
	step?: number;
	value: number;
}) {
	const tl = useLiteralMessages();
	return (
		<RyuAppField
			label={tl("{setting} · {value}", {
				setting: label,
				value: formatValue(value),
			})}
		>
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
