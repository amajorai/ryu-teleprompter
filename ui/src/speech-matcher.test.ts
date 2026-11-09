import { expect, test } from "bun:test";
import { buildScript } from "./script.ts";
import { matchTranscript } from "./speech-matcher.ts";

const { words } = buildScript(
	`Good evening and welcome to the show. Tonight we are talking about the
future of local speech recognition, why privacy matters, and how a small model
running on your own computer can keep up with a person reading out loud. The
show is about the future, and the future is about the show.`,
	false
);

test("advances to the end of what was heard", () => {
	expect(matchTranscript("good evening and welcome", words, 0)).toBe(4);
	expect(matchTranscript("welcome to the show tonight we are", words, 4)).toBe(
		10
	);
});

test("tolerates recognition errors and filler", () => {
	const cursor = matchTranscript(
		"tonite we're talking about the futur of local speech",
		words,
		7
	);
	expect(cursor).toBe(17);
});

test("does not move on unrelated speech", () => {
	expect(
		matchTranscript("let me grab a glass of water quickly", words, 10)
	).toBe(10);
	expect(matchTranscript("", words, 10)).toBe(10);
});

test("overlapping windows re-match the same place instead of drifting", () => {
	const first = matchTranscript(
		"why privacy matters and how a small",
		words,
		18
	);
	const again = matchTranscript("matters and how a small", words, first);
	expect(again).toBe(first);
});

test("prefers the nearest repetition ahead of the cursor", () => {
	const repeated = words.indexOf("show", 10) + 1;
	expect(
		matchTranscript("the show is about the future", words, repeated - 6)
	).toBe(repeated + 4);
});

test("allows a short backtrack when the speaker restarts a sentence", () => {
	const start = words.indexOf("why");
	expect(matchTranscript("why privacy matters", words, start + 6)).toBe(
		start + 3
	);
});

test("short queries only step a few words forward on close matches", () => {
	expect(matchTranscript("evening", words, 0)).toBe(2);
	expect(matchTranscript("show", words, 0)).toBe(0);
});

test("keeps the cursor within the script", () => {
	expect(matchTranscript("hello", [], 3)).toBe(0);
	expect(matchTranscript("good evening", words, -5)).toBe(2);
	expect(matchTranscript("good evening", words, 999)).toBe(words.length);
});

const churchill = buildScript(
	`We shall go on to the end, we shall fight in France, we shall fight on the
seas and oceans, we shall fight with growing confidence and growing strength in
the air, we shall defend our island, whatever the cost may be, we shall fight on
the beaches, we shall fight on the landing grounds, we shall fight in the fields
and in the streets, we shall fight in the hills; we shall never surrender.`,
	false
).words;

test("a re-read of an earlier sentence moves back instead of leaping ahead", () => {
	expect(churchill.slice(7, 12).join(" ")).toBe("we shall fight in france");
	expect(matchTranscript("we shall fight in france", churchill, 25)).toBe(12);
});

test("an ad-lib that resembles later text does not jump far ahead", () => {
	expect(
		matchTranscript("the show is great and the future is bright", words, 26)
	).toBe(26);
});

test("a trailing ad-lib does not push the cursor past the speaker", () => {
	const cursor = matchTranscript(
		"we shall fight in france um sorry let me get that",
		churchill,
		6
	);
	expect(cursor).toBe(12);
});

test("a clean match after a missed window may still jump far ahead", () => {
	const heard = churchill.slice(13, 25).join(" ");
	expect(matchTranscript(heard, churchill, 0)).toBe(25);
});

test("lead-in speech before the script still finds the position", () => {
	const short = buildScript("Hello world.", false).words;
	expect(matchTranscript("hi there everyone hello world", short, 0)).toBe(2);
	expect(
		matchTranscript("okay here we go good evening and welcome", words, 0)
	).toBe(4);
});
