/**
 * The small Markdown subset a prompter script needs: headings, list items,
 * paragraphs, blank-line spacing, and bold/italic emphasis. Everything else is
 * reduced to its readable text so it can still be spoken and matched.
 */

export interface InlineChunk {
	bold: boolean;
	italic: boolean;
	text: string;
}

export type MarkdownBlock =
	| { kind: "heading"; level: 1 | 2 | 3; chunks: InlineChunk[] }
	| { kind: "item"; chunks: InlineChunk[] }
	| { kind: "paragraph"; chunks: InlineChunk[] }
	| { kind: "blank" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
// Underscore emphasis must not split snake_case words.
const EMPHASIS =
	/\*\*\*(.+?)\*\*\*|(?<![\p{L}\p{N}])___(.+?)___(?![\p{L}\p{N}])|\*\*(.+?)\*\*|(?<![\p{L}\p{N}])__(.+?)__(?![\p{L}\p{N}])|\*(.+?)\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])/gu;

/** Reduce links, code, and strikethrough to plain readable text. */
function plainInline(text: string): string {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/~~(.+?)~~/g, "$1");
}

export function parseInline(source: string): InlineChunk[] {
	const text = plainInline(source);
	const chunks: InlineChunk[] = [];
	let last = 0;
	for (const match of text.matchAll(EMPHASIS)) {
		const start = match.index ?? 0;
		if (start > last) {
			chunks.push({
				text: text.slice(last, start),
				bold: false,
				italic: false,
			});
		}
		const [, both3, both_, bold2, bold_, italic1, italic_] = match;
		const both = both3 ?? both_;
		const bold = bold2 ?? bold_;
		const italic = italic1 ?? italic_;
		if (both !== undefined) {
			chunks.push({ text: both, bold: true, italic: true });
		} else if (bold === undefined) {
			chunks.push({ text: italic ?? "", bold: false, italic: true });
		} else {
			chunks.push({ text: bold, bold: true, italic: false });
		}
		last = start + match[0].length;
	}
	if (last < text.length) {
		chunks.push({ text: text.slice(last), bold: false, italic: false });
	}
	return chunks.length > 0 ? chunks : [{ text, bold: false, italic: false }];
}

function headingLevel(hashes: string): 1 | 2 | 3 {
	if (hashes.length === 1) {
		return 1;
	}
	return hashes.length === 2 ? 2 : 3;
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	let paragraph: string[] = [];
	const flush = () => {
		if (paragraph.length > 0) {
			blocks.push({
				kind: "paragraph",
				chunks: parseInline(paragraph.join(" ")),
			});
			paragraph = [];
		}
	};
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const heading = HEADING.exec(line);
		const item = heading ? null : LIST_ITEM.exec(line);
		if (heading) {
			flush();
			blocks.push({
				kind: "heading",
				level: headingLevel(heading[1] ?? "#"),
				chunks: parseInline(heading[2] ?? ""),
			});
		} else if (item) {
			flush();
			blocks.push({ kind: "item", chunks: parseInline(item[1] ?? "") });
		} else if (line.trim() === "") {
			flush();
			if (blocks.at(-1)?.kind !== "blank") {
				blocks.push({ kind: "blank" });
			}
		} else {
			paragraph.push(line.trim());
		}
	}
	flush();
	return blocks;
}

/** Plain-text view of a script: one paragraph per source line, no emphasis. */
export function plainBlocks(text: string): MarkdownBlock[] {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map(
			(line): MarkdownBlock =>
				line.trim() === ""
					? { kind: "blank" }
					: {
							kind: "paragraph",
							chunks: [{ text: line, bold: false, italic: false }],
						}
		);
}

/** Markdown reduced to the text a speaker would actually read. */
export function stripMarkdown(text: string): string {
	return parseMarkdownBlocks(text)
		.map((block) =>
			block.kind === "blank"
				? ""
				: block.chunks.map((chunk) => chunk.text).join("")
		)
		.join("\n");
}
