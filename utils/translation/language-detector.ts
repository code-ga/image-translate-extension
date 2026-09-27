import type { NllbLanguageCode, TranslationUnit } from "./types";

const SUPPORTED_SCRIPTS: Record<string, NllbLanguageCode> = {
	Hangul: "kor_Hang",
	Hiragana: "jpn_Jpan",
	Katakana: "jpn_Jpan",
	Han: "zho_Hans",
	Hani: "zho_Hans",
	Cyrl: "rus_Cyrl",
	Arab: "ara_Arab",
	Deva: "hin_Deva",
	Thai: "tha_Thai",
	Latn: "eng_Latn",
	Grek: "ell_Grek",
	Hebr: "heb_Hebr",
};

function getScriptStats(text: string): Record<string, number> {
	const stats: Record<string, number> = {};
	for (const char of text) {
		const code = char.charCodeAt(0);
		let script = "Unknown";
		if (code >= 0xac00 && code <= 0xd7af) script = "Hangul";
		else if (code >= 0x3040 && code <= 0x309f) script = "Hiragana";
		else if (code >= 0x30a0 && code <= 0x30ff) script = "Katakana";
		else if (code >= 0x4e00 && code <= 0x9fff) script = "Han";
		else if (code >= 0x3400 && code <= 0x4dbf) script = "Han";
		else if (code >= 0x0400 && code <= 0x04ff) script = "Cyrl";
		else if (code >= 0x0600 && code <= 0x06ff) script = "Arab";
		else if (code >= 0x0900 && code <= 0x097f) script = "Deva";
		else if (code >= 0x0e00 && code <= 0x0e7f) script = "Thai";
		else if (
			(code >= 0x0041 && code <= 0x005a) ||
			(code >= 0x0061 && code <= 0x007a) ||
			(code >= 0x00c0 && code <= 0x024f)
		)
			script = "Latn";
		else if (code >= 0x0370 && code <= 0x03ff) script = "Grek";
		else if (code >= 0x0590 && code <= 0x05ff) script = "Hebr";
		stats[script] = (stats[script] || 0) + 1;
	}
	return stats;
}

function detectScriptLanguage(text: string): NllbLanguageCode | null {
	const stats = getScriptStats(text);
	let maxScript = "";
	let maxCount = 0;
	for (const [script, count] of Object.entries(stats)) {
		if (count > maxCount && SUPPORTED_SCRIPTS[script]) {
			maxCount = count;
			maxScript = script;
		}
	}
	return maxScript ? SUPPORTED_SCRIPTS[maxScript] : null;
}

let tinyLd: any = null;
async function getTinyLd() {
	if (!tinyLd) {
		const mod = await import("tinyld");
		tinyLd = mod.default || mod;
	}
	return tinyLd;
}

export async function detectLanguageForUnit(
	unit: TranslationUnit,
): Promise<{ lang: NllbLanguageCode; confidence: number }> {
	if (unit.detectedLanguage !== "unknown" && unit.detectionConfidence > 0) {
		return {
			lang: unit.detectedLanguage,
			confidence: unit.detectionConfidence,
		};
	}

	const text = unit.sourceText.trim();
	if (!text) {
		return { lang: "eng_Latn", confidence: 0 };
	}

	const scriptLang = detectScriptLanguage(text);
	if (scriptLang) {
		return { lang: scriptLang, confidence: 0.9 };
	}

	try {
		const detector = await getTinyLd();
		const results = await detector.detectAll(text);
		for (const result of results) {
			const langCode = result.language as NllbLanguageCode;
			if (
				Object.values(SUPPORTED_SCRIPTS).includes(langCode) ||
				isSupportedNllbCode(langCode)
			) {
				return { lang: langCode, confidence: result.probability || 0.5 };
			}
		}
	} catch {}

	return { lang: "eng_Latn", confidence: 0.1 };
}

function isSupportedNllbCode(code: string): code is NllbLanguageCode {
	const supported: NllbLanguageCode[] = [
		"eng_Latn",
		"vie_Latn",
		"zho_Hans",
		"zho_Hant",
		"jpn_Jpan",
		"kor_Hang",
		"fra_Latn",
		"deu_Latn",
		"spa_Latn",
		"ita_Latn",
		"por_Latn",
		"rus_Cyrl",
		"ara_Arab",
		"hin_Deva",
		"tha_Thai",
		"ind_Latn",
		"msa_Latn",
		"tur_Latn",
		"pol_Latn",
		"ukr_Cyrl",
		"ces_Latn",
		"nld_Latn",
		"swe_Latn",
		"dan_Latn",
		"fin_Latn",
		"nor_Latn",
		"ell_Grek",
		"heb_Hebr",
		"hun_Latn",
		"ron_Latn",
		"bul_Cyrl",
		"hrv_Latn",
		"slk_Latn",
		"slv_Latn",
		"est_Latn",
		"lav_Latn",
		"lit_Latn",
	];
	return supported.includes(code as NllbLanguageCode);
}

export async function detectLanguagesForUnits(
	units: TranslationUnit[],
): Promise<TranslationUnit[]> {
	return Promise.all(
		units.map(async (unit) => {
			const { lang, confidence } = await detectLanguageForUnit(unit);
			return {
				...unit,
				detectedLanguage: lang,
				detectionConfidence: confidence,
			};
		}),
	);
}
