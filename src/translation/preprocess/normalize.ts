const CONTROL_CHARS_PATTERN = "[\\x00-\\x08\\x0B-\\x0C\\x0E-\\x1F\\x7F]";
const OCR_ARTIFACT_PATTERNS: RegExp[] = [
	new RegExp(CONTROL_CHARS_PATTERN, "gu"),
	/[\u200B-\u200D\uFEFF]/gu,
	/[\uFFFD]/gu,
];

const INLINE_WHITESPACE = /[ \t\f\v]+/g;
const LINE_BREAK_NORMALIZE = /\r\n|\r/g;
const SENTENCE_END_REGEX = /[.!?。？！]\s*/g;
const ISOLATED_NOISE = /^[^\p{L}\p{N}]+$/u;

export function normalizeText(text: string): string {
	if (!text) return "";

	let result = text.replace(LINE_BREAK_NORMALIZE, "\n");
	for (const pattern of OCR_ARTIFACT_PATTERNS) {
		result = result.replace(pattern, " ");
	}

	return result
		.split("\n")
		.map((line) => line.replace(INLINE_WHITESPACE, " ").trim())
		.filter((line) => line.length > 0 && !ISOLATED_NOISE.test(line))
		.join("\n")
		.trim();
}

export function normalizeForTranslation(text: string): string {
	return normalizeText(text);
}

export function splitSentences(text: string, maxChars: number): string[] {
	if (text.length <= maxChars) return [text];

	const sentences: string[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(SENTENCE_END_REGEX)) {
		const endIndex = match.index + match[0].length;
		const sentence = text.slice(lastIndex, endIndex).trim();
		if (sentence) sentences.push(sentence);
		lastIndex = endIndex;
	}

	const remaining = text.slice(lastIndex).trim();
	if (remaining) sentences.push(remaining);

	const chunks: string[] = [];
	let currentChunk = "";
	for (const sentence of sentences) {
		if (currentChunk && currentChunk.length + sentence.length + 1 > maxChars) {
			chunks.push(currentChunk);
			currentChunk = "";
		}
		if (sentence.length > maxChars) {
			if (currentChunk) chunks.push(currentChunk);
			currentChunk = "";
			chunks.push(...splitLongSentence(sentence, maxChars));
			continue;
		}
		currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
	}
	if (currentChunk) chunks.push(currentChunk);
	return chunks;
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
	const parts: string[] = [];
	for (let index = 0; index < sentence.length; index += maxChars) {
		parts.push(sentence.slice(index, index + maxChars));
	}
	return parts;
}
