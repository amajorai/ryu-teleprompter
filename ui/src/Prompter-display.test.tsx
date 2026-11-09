import { afterEach, describe, expect, test } from "bun:test";
import { registerLiteralCatalogLoader } from "@ryu/i18n/core";
import { I18nProvider, useLiteralMessages } from "@ryu/i18n/react";
import { renderToStaticMarkup } from "react-dom/server";
import { DisplaySlider } from "./Prompter-display.tsx";

// The Display field labels were `${label} · ${value}${unit}` with English
// units ("72 characters", "35% from top"), so no locale could word the reading
// or move the number. The stub catalogs stand in for the shipped entries.

const CHARACTERS = "{width, plural, one {# character} other {# characters}}";
const FROM_TOP = "{percent}% from top";
const SPEED = "{speed} words/min";
const SEPARATOR = "{setting} · {value}";

const CATALOGS: Record<string, Record<string, string>> = {
	ar: {
		[CHARACTERS]:
			"{width, plural, zero {# حرف} one {حرف واحد} two {حرفان} few {# أحرف} many {# حرفًا} other {# حرف}}",
		"Line width": "عرض السطر",
		[SEPARATOR]: "{setting} · {value}",
	},
	de: {
		"Auto-scroll speed": "Scrollgeschwindigkeit",
		[SEPARATOR]: "{setting}: {value}",
		[SPEED]: "{speed} Wörter/Min.",
	},
	ja: {
		[CHARACTERS]: "{width, plural, other {#文字}}",
		[FROM_TOP]: "上から{percent}%",
		"Line width": "行の幅",
		"Reading line": "読み取りライン",
		[SEPARATOR]: "{setting}：{value}",
	},
};

type Field = "line" | "reading" | "speed";

function Slider({ field, value }: { field: Field; value: number }) {
	const tl = useLiteralMessages();
	if (field === "line") {
		return (
			<DisplaySlider
				formatValue={(next) => tl(CHARACTERS, { width: next })}
				label={tl("Line width")}
				max={90}
				min={16}
				onChange={() => undefined}
				value={value}
			/>
		);
	}
	if (field === "reading") {
		return (
			<DisplaySlider
				formatValue={(next) => tl(FROM_TOP, { percent: next })}
				label={tl("Reading line")}
				max={70}
				min={5}
				onChange={() => undefined}
				value={value}
			/>
		);
	}
	return (
		<DisplaySlider
			formatValue={(next) => tl(SPEED, { speed: next })}
			label={tl("Auto-scroll speed")}
			max={260}
			min={60}
			onChange={() => undefined}
			value={value}
		/>
	);
}

function render(locale: string, field: Field, value: number): string {
	registerLiteralCatalogLoader((requested) =>
		requested.startsWith(locale) ? (CATALOGS[locale] ?? {}) : {}
	);
	return renderToStaticMarkup(
		<I18nProvider
			autoLocalizeDom={false}
			initialLocale={locale}
			initialPackId={null}
		>
			<Slider field={field} value={value} />
		</I18nProvider>
	);
}

afterEach(() => registerLiteralCatalogLoader(null));

describe("DisplaySlider field label", () => {
	test("reads naturally in English", () => {
		expect(render("en", "line", 72)).toContain("Line width · 72 characters");
		expect(render("en", "reading", 35)).toContain(
			"Reading line · 35% from top"
		);
	});

	test("words the setting and its reading in Japanese", () => {
		expect(render("ja", "line", 72)).toContain("行の幅：72文字");
		const reading = render("ja", "reading", 35);
		expect(reading).toContain("読み取りライン：上から35%");
		expect(reading).not.toContain("from top");
	});

	test("uses the locale's plural forms and separators", () => {
		expect(render("ar", "line", 3)).toContain("عرض السطر · 3 أحرف");
		expect(render("de", "speed", 180)).toContain(
			"Scrollgeschwindigkeit: 180 Wörter/Min."
		);
	});
});
