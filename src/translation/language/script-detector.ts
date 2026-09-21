import type {
	ScriptStats,
	ScriptType,
	SupportedSourceLanguage,
} from "../types";

const SCRIPT_RANGES: Record<
	Exclude<ScriptType, "unknown">,
	[number, number][]
> = {
	latin: [
		[0x0041, 0x005a],
		[0x0061, 0x007a],
		[0x00c0, 0x00d6],
		[0x00d8, 0x00f6],
		[0x00f8, 0x024f],
		[0x1e00, 0x1eff],
		[0x2c60, 0x2c7f],
		[0xa720, 0xa7ff],
		[0xff21, 0xff3a],
		[0xff41, 0xff5a],
	],
	hiragana: [[0x3040, 0x309f]],
	katakana: [
		[0x30a0, 0x30ff],
		[0x31f0, 0x31ff],
		[0xff65, 0xff9f],
	],
	han: [
		[0x3400, 0x4dbf],
		[0x4e00, 0x9fff],
		[0xf900, 0xfaff],
		[0x20000, 0x2a6df],
		[0x2a700, 0x2b73f],
		[0x2b740, 0x2b81f],
		[0x2b820, 0x2ceaf],
	],
	hangul: [
		[0x1100, 0x11ff],
		[0x3130, 0x318f],
		[0xac00, 0xd7af],
		[0xd7b0, 0xd7ff],
	],
	cyrillic: [
		[0x0400, 0x04ff],
		[0x0500, 0x052f],
		[0x2de0, 0x2dff],
		[0xa640, 0xa69f],
	],
	arabic: [
		[0x0600, 0x06ff],
		[0x0750, 0x077f],
		[0x08a0, 0x08ff],
		[0xfb50, 0xfdff],
		[0xfe70, 0xfeff],
	],
	devanagari: [
		[0x0900, 0x097f],
		[0xa8e0, 0xa8ff],
	],
	thai: [[0x0e00, 0x0e7f]],
	bengali: [[0x0980, 0x09ff]],
	gurmukhi: [[0x0a00, 0x0a7f]],
	gujarati: [[0x0a80, 0x0aff]],
	odia: [[0x0b00, 0x0b7f]],
	tamil: [[0x0b80, 0x0bff]],
	telugu: [[0x0c00, 0x0c7f]],
	kannada: [[0x0c80, 0x0cff]],
	malayalam: [[0x0d00, 0x0d7f]],
	sinhala: [[0x0d80, 0x0dff]],
	myanmar: [
		[0x1000, 0x109f],
		[0xaa60, 0xaa7f],
		[0xa9e0, 0xa9ff],
	],
	khmer: [[0x1780, 0x17ff]],
	lao: [[0x0e80, 0x0eff]],
	georgian: [
		[0x10a0, 0x10ff],
		[0x2d00, 0x2d2f],
	],
	greek: [[0x0370, 0x03ff]],
	hebrew: [[0x0590, 0x05ff]],
	armenian: [[0x0530, 0x058f]],
	ethiopic: [
		[0x1200, 0x137f],
		[0x2d80, 0x2ddf],
	],
};

export function createEmptyScriptStats(): ScriptStats {
	return {
		latin: 0,
		hiragana: 0,
		katakana: 0,
		han: 0,
		hangul: 0,
		cyrillic: 0,
		arabic: 0,
		devanagari: 0,
		thai: 0,
		bengali: 0,
		gurmukhi: 0,
		gujarati: 0,
		odia: 0,
		tamil: 0,
		telugu: 0,
		kannada: 0,
		malayalam: 0,
		sinhala: 0,
		myanmar: 0,
		khmer: 0,
		lao: 0,
		georgian: 0,
		greek: 0,
		hebrew: 0,
		armenian: 0,
		ethiopic: 0,
		unknown: 0,
	};
}

function getScriptType(codePoint: number): ScriptType {
	for (const [script, ranges] of Object.entries(SCRIPT_RANGES)) {
		for (const [start, end] of ranges) {
			if (codePoint >= start && codePoint <= end) {
				return script as ScriptType;
			}
		}
	}
	return "unknown";
}

export function detectScript(text: string): ScriptStats {
	const stats: ScriptStats = {
		latin: 0,
		hiragana: 0,
		katakana: 0,
		han: 0,
		hangul: 0,
		cyrillic: 0,
		arabic: 0,
		devanagari: 0,
		thai: 0,
		bengali: 0,
		gurmukhi: 0,
		gujarati: 0,
		odia: 0,
		tamil: 0,
		telugu: 0,
		kannada: 0,
		malayalam: 0,
		sinhala: 0,
		myanmar: 0,
		khmer: 0,
		lao: 0,
		georgian: 0,
		greek: 0,
		hebrew: 0,
		armenian: 0,
		ethiopic: 0,
		unknown: 0,
	};

	for (let i = 0; i < text.length; i++) {
		const codePoint = text.codePointAt(i);
		if (codePoint === undefined) continue;
		const script = getScriptType(codePoint);
		stats[script]++;
		if (codePoint > 0xffff) i++;
	}

	return stats;
}

export function identifyLanguageFromScript(
	stats: ScriptStats,
): SupportedSourceLanguage | null {
	const knownTotal = Object.entries(stats).reduce(
		(sum, [script, count]) => (script === "unknown" ? sum : sum + count),
		0,
	);
	if (knownTotal === 0) return null;

	const ratio = (script: ScriptType) => stats[script] / knownTotal;
	if (ratio("hangul") > 0.3) return "kor";
	if (ratio("hiragana") > 0.3 || ratio("katakana") > 0.3) return "jpn";
	if (ratio("thai") > 0.3) return "tha";
	if (ratio("devanagari") > 0.3) return "hin";
	if (ratio("arabic") > 0.3) return "ara";
	if (ratio("cyrillic") > 0.3) return "rus";
	if (ratio("han") > 0.5 && ratio("latin") === 0) return "cmn";
	return null;
}

export function getDominantScript(stats: ScriptStats): ScriptType {
	let dominant: ScriptType = "unknown";
	let maxCount = 0;
	for (const [script, count] of Object.entries(stats)) {
		if (count > maxCount) {
			maxCount = count;
			dominant = script as ScriptType;
		}
	}
	return dominant;
}
