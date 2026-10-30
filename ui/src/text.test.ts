import { describe, expect, test } from "bun:test";
import { levenshtein, normalizedDistance } from "./levenshtein.ts";
import {
	parseInline,
	parseMarkdownBlocks,
	plainBlocks,
	stripMarkdown,
} from "./markdown.ts";
import { buildScript, speakingTime } from "./script.ts";
import { normalizeWord, spokenWords, tokenize } from "./tokenizer.ts";

describe("tokenizer", () => {
	test("splits words, gaps, and bracketed cues without losing text", () => {
		const text = "Hello, world! [pause] Don’t stop—it's 2026.";
		const tokens = tokenize(text);
		expect(tokens.map((token) => token.text).join("")).toBe(text);
		expect(
			tokens.filter((token) => token.kind === "word").map((token) => token.text)
		).toEqual(["Hello", "world", "Don’t", "stop", "it's", "2026"]);
		expect(tokens.find((token) => token.kind === "cue")?.text).toBe("[pause]");
	});

	test("normalizes case, accents, and punctuation for comparison", () => {
		expect(normalizeWord("Café")).toBe("cafe");
		expect(normalizeWord("Don’t")).toBe("dont");
		expect(normalizeWord("Привет")).toBe("привет");
		expect(spokenWords("Hello, World! [cue] Again.")).toEqual([
			"hello",
			"world",
			"again",
		]);
	});
});

describe("levenshtein", () => {
	test("counts insertions, deletions, and substitutions", () => {
		expect(levenshtein("kitten", "sitting")).toBe(3);
		expect(levenshtein("", "abc")).toBe(3);
		expect(levenshtein("same", "same")).toBe(0);
	});

	test("normalizes by the longer string", () => {
		expect(normalizedDistance("", "")).toBe(0);
		expect(normalizedDistance("abcd", "abce")).toBe(0.25);
		expect(normalizedDistance("abc", "xyz")).toBe(1);
	});
});

describe("markdown", () => {
	test("parses headings, list items, paragraphs, and collapsed blanks", () => {
		const blocks = parseMarkdownBlocks(
			"# Title\nfirst line\nsecond line\n\n\n- one\n2. two\n#### Deep"
		);
		expect(blocks.map((block) => block.kind)).toEqual([
			"heading",
			"paragraph",
			"blank",
			"item",
			"item",
			"heading",
		]);
		expect(blocks[1]).toEqual({
			kind: "paragraph",
			chunks: [{ text: "first line second line", bold: false, italic: false }],
		});
		expect(blocks[5]).toMatchObject({ kind: "heading", level: 3 });
	});

	test("parses emphasis and keeps snake_case intact", () => {
		expect(parseInline("a **b** *c* ***d*** e")).toEqual([
			{ text: "a ", bold: false, italic: false },
			{ text: "b", bold: true, italic: false },
			{ text: " ", bold: false, italic: false },
			{ text: "c", bold: false, italic: true },
			{ text: " ", bold: false, italic: false },
			{ text: "d", bold: true, italic: true },
			{ text: " e", bold: false, italic: false },
		]);
		expect(parseInline("call my_var_name now")).toEqual([
			{ text: "call my_var_name now", bold: false, italic: false },
		]);
		expect(parseInline("see [docs](https://x.test) and `code`")[0]?.text).toBe(
			"see docs and code"
		);
	});

	test("strips markup to readable text and keeps plain mode literal", () => {
		expect(stripMarkdown("## Hi **there**\n\n- _one_")).toBe("Hi there\n\none");
		expect(plainBlocks("# not a heading\n\nx")).toEqual([
			{
				kind: "paragraph",
				chunks: [{ text: "# not a heading", bold: false, italic: false }],
			},
			{ kind: "blank" },
			{
				kind: "paragraph",
				chunks: [{ text: "x", bold: false, italic: false }],
			},
		]);
	});
});

describe("script", () => {
	test("numbers spoken words consistently across blocks and skips cues", () => {
		const script = buildScript(
			"# Hello there\n\nGood **morning** [smile] all",
			true
		);
		expect(script.words).toEqual(["hello", "there", "good", "morning", "all"]);
		const numbered = script.blocks.flatMap((block) =>
			block.kind === "blank"
				? []
				: block.chunks.flatMap((chunk) =>
						chunk.tokens.flatMap((token) =>
							token.word === undefined ? [] : [[token.text, token.word]]
						)
					)
		);
		expect(numbered).toEqual([
			["Hello", 0],
			["there", 1],
			["Good", 2],
			["morning", 3],
			["all", 4],
		]);
	});

	test("estimates speaking time", () => {
		expect(speakingTime(150, 150)).toBe("1:00");
		expect(speakingTime(35, 140)).toBe("0:15");
	});
});
