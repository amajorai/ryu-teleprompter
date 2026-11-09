/**
 * One prompter document built from the source script. Rendering and speech
 * matching read the same word numbering, so a click, a keyboard jump, and a
 * transcript match always point at the same word.
 */

import {
	type InlineChunk,
	type MarkdownBlock,
	parseMarkdownBlocks,
	plainBlocks,
} from "./markdown.ts";
import { normalizeWord, type ScriptTokenKind, tokenize } from "./tokenizer.ts";

export interface PrompterToken {
	kind: ScriptTokenKind;
	text: string;
	/** Position in `PrompterScript.words` for spoken words. */
	word?: number;
}

export interface PrompterChunk {
	bold: boolean;
	italic: boolean;
	tokens: PrompterToken[];
}

export type PrompterBlock =
	| { kind: "heading"; level: 1 | 2 | 3; chunks: PrompterChunk[] }
	| { kind: "item"; chunks: PrompterChunk[] }
	| { kind: "paragraph"; chunks: PrompterChunk[] }
	| { kind: "blank" };

export interface PrompterScript {
	blocks: PrompterBlock[];
	/** Normalized spoken words, indexed by `PrompterToken.word`. */
	words: string[];
}

export function buildScript(source: string, markdown: boolean): PrompterScript {
	const words: string[] = [];
	const chunkTokens = (chunk: InlineChunk): PrompterChunk => ({
		bold: chunk.bold,
		italic: chunk.italic,
		tokens: tokenize(chunk.text).map((token) => {
			const normalized = token.kind === "word" ? normalizeWord(token.text) : "";
			if (!normalized) {
				return {
					kind: token.kind === "word" ? "gap" : token.kind,
					text: token.text,
				};
			}
			words.push(normalized);
			return { kind: "word", text: token.text, word: words.length - 1 };
		}),
	});
	const sourceBlocks: MarkdownBlock[] = markdown
		? parseMarkdownBlocks(source)
		: plainBlocks(source);
	const blocks = sourceBlocks.map((block): PrompterBlock => {
		if (block.kind === "blank") {
			return block;
		}
		if (block.kind === "heading") {
			return {
				kind: "heading",
				level: block.level,
				chunks: block.chunks.map(chunkTokens),
			};
		}
		return { kind: block.kind, chunks: block.chunks.map(chunkTokens) };
	});
	return { blocks, words };
}

/** Rough speaking time for a word count at a words-per-minute pace. */
export function speakingTime(
	wordCount: number,
	wordsPerMinute: number
): string {
	const totalSeconds = Math.round(
		(wordCount / Math.max(1, wordsPerMinute)) * 60
	);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
