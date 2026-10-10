import type { NllbLanguageCode, TranslationUnit } from "./types";

const _SCRIPT_TO_LANG: Record<string, NllbLanguageCode> = {
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

function detectScript(text: string): NllbLanguageCode | null {
	for (const char of text) {
		const code = char.charCodeAt(0);
		if (code >= 0xac00 && code <= 0xd7af) return "kor_Hang";
		if (code >= 0x3040 && code <= 0x309f) return "jpn_Jpan";
		if (code >= 0x30a0 && code <= 0x30ff) return "jpn_Jpan";
		if (code >= 0x4e00 && code <= 0x9fff) return "zho_Hans";
		if (code >= 0x3400 && code <= 0x4dbf) return "zho_Hans";
		if (code >= 0x0400 && code <= 0x04ff) return "rus_Cyrl";
		if (code >= 0x0600 && code <= 0x06ff) return "ara_Arab";
		if (code >= 0x0900 && code <= 0x097f) return "hin_Deva";
		if (code >= 0x0e00 && code <= 0x0e7f) return "tha_Thai";
		if (
			(code >= 0x0041 && code <= 0x005a) ||
			(code >= 0x0061 && code <= 0x007a) ||
			(code >= 0x00c0 && code <= 0x024f)
		)
			return "eng_Latn";
		if (code >= 0x0370 && code <= 0x03ff) return "ell_Grek";
		if (code >= 0x0590 && code <= 0x05ff) return "heb_Hebr";
	}
	return null;
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

	const scriptLang = detectScript(text);
	if (scriptLang) {
		return { lang: scriptLang, confidence: 0.9 };
	}

	return { lang: "eng_Latn", confidence: 0.1 };
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
