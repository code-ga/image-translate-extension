import type { OCRBox, OCRRegion } from "@/types";
import type { TranslationUnit } from "../types";
import { MAX_TRANSLATION_CHARS } from "../types";
import { normalizeText } from "./normalize";

const SAME_LINE_Y_TOLERANCE_RATIO = 0.3;
const MAX_HORIZONTAL_GAP_RATIO = 1.5;

type BoxReference = {
	box: OCRBox;
	regionIndex: number;
	boxIndex: number;
};

function computeBounds(boxes: OCRBox[]): TranslationUnit["bbox"] {
	if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	const minX = Math.min(...boxes.map((box) => box.box.x));
	const minY = Math.min(...boxes.map((box) => box.box.y));
	const maxX = Math.max(...boxes.map((box) => box.box.x + box.box.width));
	const maxY = Math.max(...boxes.map((box) => box.box.y + box.box.height));
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function averageHeight(references: BoxReference[]): number {
	if (references.length === 0) return 20;
	return (
		references.reduce((sum, item) => sum + item.box.box.height, 0) /
		references.length
	);
}

function sortReferences(
	references: BoxReference[],
	height: number,
): BoxReference[] {
	return references.slice().sort((a, b) => {
		const yDifference = a.box.box.y - b.box.box.y;
		if (Math.abs(yDifference) < height * SAME_LINE_Y_TOLERANCE_RATIO) {
			return a.box.box.x - b.box.box.x;
		}
		return yDifference;
	});
}

function groupBoxesIntoLines(
	references: BoxReference[],
	height: number,
): BoxReference[][] {
	const lines: BoxReference[][] = [];
	let currentLine: BoxReference[] = [];
	let previous: BoxReference | null = null;

	for (const reference of sortReferences(references, height)) {
		if (!previous) {
			currentLine = [reference];
			previous = reference;
			continue;
		}

		const overlap = Math.max(
			0,
			Math.min(
				previous.box.box.y + previous.box.box.height,
				reference.box.box.y + reference.box.box.height,
			) - Math.max(previous.box.box.y, reference.box.box.y),
		);
		const minHeight = Math.min(
			previous.box.box.height,
			reference.box.box.height,
		);
		const overlapRatio = minHeight > 0 ? overlap / minHeight : 0;
		const gap =
			reference.box.box.x - (previous.box.box.x + previous.box.box.width);

		if (
			overlapRatio > SAME_LINE_Y_TOLERANCE_RATIO &&
			gap < height * MAX_HORIZONTAL_GAP_RATIO
		) {
			currentLine.push(reference);
		} else {
			lines.push(currentLine);
			currentLine = [reference];
		}
		previous = reference;
	}

	if (currentLine.length > 0) lines.push(currentLine);
	return lines;
}

function splitTextIntoChunks(text: string): string[] {
	if (text.length <= MAX_TRANSLATION_CHARS) return [text];
	const chunks: string[] = [];
	let current = "";
	for (const sentence of text.split(/(?<=[.!?。？！])\s*/u)) {
		if (!sentence) continue;
		if (
			current &&
			current.length + sentence.length + 1 > MAX_TRANSLATION_CHARS
		) {
			chunks.push(current);
			current = "";
		}
		if (sentence.length > MAX_TRANSLATION_CHARS) {
			if (current) chunks.push(current);
			current = "";
			for (
				let index = 0;
				index < sentence.length;
				index += MAX_TRANSLATION_CHARS
			) {
				chunks.push(sentence.slice(index, index + MAX_TRANSLATION_CHARS));
			}
			continue;
		}
		current = current ? `${current} ${sentence}` : sentence;
	}
	if (current) chunks.push(current);
	return chunks;
}

function referencesForChunk(
	lineReferences: BoxReference[],
	lineText: string,
	chunk: string,
): BoxReference[] {
	const startIndex = lineText.indexOf(chunk);
	if (startIndex < 0) return lineReferences;
	const endIndex = startIndex + chunk.length;
	let offset = 0;
	const selected = new Set<BoxReference>();
	for (const reference of lineReferences) {
		const nextOffset = offset + reference.box.text.length;
		if (nextOffset >= startIndex && offset <= endIndex) selected.add(reference);
		offset = nextOffset + 1;
	}
	return [...selected];
}

export function groupRegionsIntoTranslationUnits(
	regions: OCRRegion[],
): TranslationUnit[] {
	const references: BoxReference[] = [];
	regions.forEach((region, regionIndex) => {
		region.boxes.forEach((box, boxIndex) => {
			if (box.text.trim()) references.push({ box, regionIndex, boxIndex });
		});
	});

	const units: TranslationUnit[] = [];
	let unitIndex = 0;
	for (const line of groupBoxesIntoLines(
		references,
		averageHeight(references),
	)) {
		const sorted = sortReferences(line, averageHeight(line));
		const parts = sorted.map((reference) => normalizeText(reference.box.text));
		const lineText = normalizeText(parts.filter(Boolean).join(" "));
		if (!lineText) continue;

		for (const chunk of splitTextIntoChunks(lineText)) {
			const chunkReferences = referencesForChunk(sorted, lineText, chunk);
			const boxes = chunkReferences.map((reference) => reference.box);
			units.push({
				id: `unit_${unitIndex++}`,
				sourceText: chunk,
				bbox: computeBounds(boxes),
				boxReferences: boxes,
				detectedLanguage: "unknown",
				detectionConfidence: 0,
			});
		}
	}
	return units;
}
