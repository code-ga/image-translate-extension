import { detectAll } from "tinyld";
import type { LanguageCandidate, ScriptStats, ScriptType, SupportedSourceLanguage } from "../types";
import { isSupportedSourceLanguage } from "./language-map";
import { identifyLanguageFromScript } from "./script-detector";

export async function detectLanguage(
	text: string,
): Promise<LanguageCandidate[]> {
	if (!text.trim()) return [];

	const rawResults = detectAll(text);
	return rawResults
		.map((result) => {
			const language = mapTinyLdLanguage(result.lang);
			return language ? { language, score: result.accuracy } : null;
		})
		.filter((candidate): candidate is LanguageCandidate => candidate !== null)
		.filter((candidate) => isSupportedSourceLanguage(candidate.language))
		.sort((a, b) => b.score - a.score);
}

function mapTinyLdLanguage(language: string): SupportedSourceLanguage | null {
	const normalized = language.toLowerCase();
	const direct: Record<string, SupportedSourceLanguage> = {
		en: "eng",
		ja: "jpn",
		zh: "cmn",
		ko: "kor",
		fr: "fra",
		de: "deu",
		es: "spa",
		pt: "por",
		it: "ita",
		ru: "rus",
		ar: "ara",
		hi: "hin",
		th: "tha",
		vi: "vie",
	};
	return direct[normalized] ?? null;
}

export async function detectLanguageWithScript(
	text: string,
	scriptStats: ScriptStats,
): Promise<LanguageCandidate[]> {
	const candidates = await detectLanguage(text);
	const scriptHint = identifyLanguageHintFromScript(scriptStats);
	if (!scriptHint) return candidates;

	const hintIndex = candidates.findIndex(
		(candidate) => candidate.language === scriptHint,
	);
	if (hintIndex >= 0) {
		const [candidate] = candidates.splice(hintIndex, 1);
		candidates.unshift({ ...candidate, score: Math.max(candidate.score, 0.9) });
	} else {
		candidates.unshift({ language: scriptHint, score: 0.9 });
	}
	return candidates;
}

function identifyLanguageHintFromScript(
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
	if (ratio("han") > 0.5) return "cmn";
	return null;
}
