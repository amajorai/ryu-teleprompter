import { memo, type ReactNode, useMemo } from "react";
import type { PrompterBlock, PrompterChunk, PrompterScript } from "./script.ts";

type WordState = "spoken" | "current" | "upcoming";

function wordState(word: number, cursor: number): WordState {
	if (word < cursor) {
		return "spoken";
	}
	return word === cursor ? "current" : "upcoming";
}

function ChunkText({
	chunk,
	cursor,
}: {
	chunk: PrompterChunk;
	cursor: number;
}) {
	const content = chunk.tokens.map((token, index) => {
		const key = `${index}-${token.text}`;
		if (token.kind === "cue") {
			return (
				<span className="prompter-cue" key={key}>
					{token.text}
				</span>
			);
		}
		if (token.word === undefined) {
			return token.text;
		}
		return (
			<span
				className="prompter-word"
				data-state={wordState(token.word, cursor)}
				data-word={token.word}
				key={key}
			>
				{token.text}
			</span>
		);
	});
	if (chunk.bold && chunk.italic) {
		return (
			<strong>
				<em>{content}</em>
			</strong>
		);
	}
	if (chunk.bold) {
		return <strong>{content}</strong>;
	}
	return chunk.italic ? <em>{content}</em> : content;
}

function chunksText(chunks: PrompterChunk[], cursor: number): ReactNode {
	return chunks.map((chunk, index) => (
		<ChunkText
			chunk={chunk}
			cursor={cursor}
			key={`${index}-${chunk.tokens.length}`}
		/>
	));
}

/** Word range of a block, so blocks far from the cursor skip re-rendering. */
function blockRange(block: PrompterBlock): [number, number] | null {
	if (block.kind === "blank") {
		return null;
	}
	let first = -1;
	let last = -1;
	for (const chunk of block.chunks) {
		for (const token of chunk.tokens) {
			if (token.word !== undefined) {
				first = first === -1 ? token.word : first;
				last = token.word;
			}
		}
	}
	return first === -1 ? null : [first, last];
}

/** Cursor as seen by one block: clamped so unchanged blocks keep equal props. */
function localCursor(range: [number, number] | null, cursor: number): number {
	if (range === null) {
		return 0;
	}
	if (cursor < range[0]) {
		return range[0] - 1;
	}
	return cursor > range[1] + 1 ? range[1] + 1 : cursor;
}

const HEADING_TAGS = { 1: "h2", 2: "h3", 3: "h4" } as const;

const Block = memo(function Block({
	block,
	cursor,
}: {
	block: PrompterBlock;
	cursor: number;
}) {
	if (block.kind === "blank") {
		return <div aria-hidden="true" className="prompter-blank" />;
	}
	if (block.kind === "heading") {
		const Tag = HEADING_TAGS[block.level];
		return (
			<Tag className="prompter-heading" data-level={block.level}>
				{chunksText(block.chunks, cursor)}
			</Tag>
		);
	}
	return (
		<p className={block.kind === "item" ? "prompter-item" : undefined}>
			{chunksText(block.chunks, cursor)}
		</p>
	);
});

export function ScriptText({
	cursor,
	script,
}: {
	cursor: number;
	script: PrompterScript;
}) {
	const ranges = useMemo(() => script.blocks.map(blockRange), [script]);
	return (
		<>
			{script.blocks.map((block, index) => (
				<Block
					block={block}
					cursor={localCursor(ranges[index] ?? null, cursor)}
					// Blocks are positional; the script is rebuilt as a whole when edited.
					key={`${index}-${block.kind}`}
				/>
			))}
		</>
	);
}
