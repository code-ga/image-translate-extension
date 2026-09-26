import type { LanguageDetectionResult, ScriptStats } from "../types";
import { DETECTION_CONFIDENCE_THRESHOLD } from "../types";
import { detectLanguageWithScript } from "./language-detector";
import {
	detectScript,
	getDominantScript,
	identifyLanguageFromScript,
	createEmptyScriptStats,
} from "./script-detector";

const USELESS_PATTERNS = [
	/^[\s\d.!?,;:\-()[\]{}|@#$%^&*+=_~`<>/\\]+$/,
	/^\.{3,}$/,
	/^!{3,}$/,
	/^\?{3,}$/,
];

function isUselessText(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length < 2) return true;
	return USELESS_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function calculateScriptDistribution(
	units: {
		text: string;
		bbox: { x: number; y: number; width: number; height: number };
	}[],
): ScriptStats {
	const combinedStats = createEmptyScriptStats();

	for (const unit of units) {
		if (isUselessText(unit.text)) continue;
		const stats = detectScript(unit.text);
		for (const key of Object.keys(stats) as Array<keyof ScriptStats>) {
			combinedStats[key] += stats[key];
		}
	}
	return combinedStats;
}

export async function resolveLanguage(
	units: {
		text: string;
		bbox: { x: number; y: number; width: number; height: number };
	}[],
): Promise<LanguageDetectionResult> {
	const validUnits = units.filter((unit) => !isUselessText(unit.text));
	if (validUnits.length === 0) return createUnknownResult();

	const scriptStats = calculateScriptDistribution(validUnits);
	const scriptLang = identifyLanguageFromScript(scriptStats);
	if (scriptLang) {
		const dominantScript = getDominantScript(scriptStats);
		const knownTotal = Object.entries(scriptStats).reduce(
			(sum, [script, count]) => (script === "unknown" ? sum : sum + count),
			0,
		);
		const scriptRatio =
			knownTotal === 0 ? 0 : scriptStats[dominantScript] / knownTotal;
		if (scriptRatio >= DETECTION_CONFIDENCE_THRESHOLD) {
			return {
				language: scriptLang,
				confidence: scriptRatio,
				method: "script",
				scriptStats,
				candidates: [{ language: scriptLang, score: scriptRatio }],
			};
		}
	}

	const concatenatedText = validUnits.map((unit) => unit.text).join(" ");
	const candidates = await detectLanguageWithScript(
		concatenatedText,
		scriptStats,
	);
	if (candidates.length === 0) return createUnknownResult(scriptStats);

	const topCandidate = candidates[0];
	if (topCandidate.language === "vie") {
		return {
			language: "vie",
			confidence: topCandidate.score,
			method: "passthrough",
			scriptStats,
			candidates,
		};
	}
	if (topCandidate.score < DETECTION_CONFIDENCE_THRESHOLD) {
		return {
			language: "unknown",
			confidence: topCandidate.score,
			method: "tinyld",
			scriptStats,
			candidates,
		};
	}

	return {
		language: topCandidate.language,
		confidence: topCandidate.score,
		method: "tinyld",
		scriptStats,
		candidates,
	};
}

function createUnknownResult(
	scriptStats?: ScriptStats,
): LanguageDetectionResult {
	const defaultStats = createEmptyScriptStats();
	return {
		language: "unknown",
		confidence: 0,
		method: "tinyld",
		scriptStats: scriptStats ?? defaultStats,
		candidates: [],
	};
}
