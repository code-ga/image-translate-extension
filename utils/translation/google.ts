import type { NllbLanguageCode } from "./types";

const GOOGLE_TRANSLATE_URL = "https://translate.google.com/translate_a/single";

const NLLB_TO_GOOGLE: Record<string, string> = {
	eng_Latn: "en",
	vie_Latn: "vi",
	zho_Hans: "zh-CN",
	zho_Hant: "zh-TW",
	jpn_Jpan: "ja",
	kor_Hang: "ko",
	fra_Latn: "fr",
	deu_Latn: "de",
	spa_Latn: "es",
	ita_Latn: "it",
	por_Latn: "pt",
	rus_Cyrl: "ru",
	ara_Arab: "ar",
	hin_Deva: "hi",
	tha_Thai: "th",
	ind_Latn: "id",
	msa_Latn: "ms",
	tur_Latn: "tr",
	pol_Latn: "pl",
	ukr_Cyrl: "uk",
	ces_Latn: "cs",
	nld_Latn: "nl",
	swe_Latn: "sv",
	dan_Latn: "da",
	fin_Latn: "fi",
	nor_Latn: "no",
	ell_Grek: "el",
	heb_Hebr: "he",
	hun_Latn: "hu",
	ron_Latn: "ro",
	bul_Cyrl: "bg",
	hrv_Latn: "hr",
	slk_Latn: "sk",
	slv_Latn: "sl",
	est_Latn: "et",
	lav_Latn: "lv",
	lit_Latn: "lt",
};

const GOOGLE_TO_NLLB: Record<string, string> = Object.fromEntries(
	Object.entries(NLLB_TO_GOOGLE).map(([nllb, google]) => [google, nllb]),
);

function toGoogleCode(nllbCode: string): string {
	return NLLB_TO_GOOGLE[nllbCode] || "en";
}

function toNllbCode(googleCode: string): NllbLanguageCode {
	return (GOOGLE_TO_NLLB[googleCode] || "eng_Latn") as NllbLanguageCode;
}

export interface GoogleTranslateResult {
	translatedText: string;
	sourceLang: string;
}

export async function googleTranslateText(
	text: string,
	targetLang: string,
	srcLang?: string,
): Promise<GoogleTranslateResult> {
	console.log("[GoogleTranslate] START", { text, targetLang, srcLang });
	const params = new URLSearchParams({
		client: "gtx",
		sl: srcLang || "auto",
		tl: targetLang,
		dt: "t",
		q: text,
	});

	const url = `${GOOGLE_TRANSLATE_URL}?${params.toString()}`;

	const response = await fetch(url, {
		method: "GET",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Accept: "*/*",
			"Accept-Language": "en-US,en;q=0.9",
		},
	});

	if (!response.ok) {
		console.log("[GoogleTranslate] HTTP_ERROR", { status: response.status });
		throw new Error(`Google Translate HTTP ${response.status}`);
	}

	const data = await response.json();

	if (!Array.isArray(data) || data.length === 0) {
		console.log("[GoogleTranslate] INVALID_RESPONSE", { data });
		throw new Error("Google Translate: invalid response");
	}

	const sentences = data[0];
	if (!Array.isArray(sentences) || sentences.length === 0) {
		console.log("[GoogleTranslate] EMPTY_TRANSLATION");
		throw new Error("Google Translate: empty translation");
	}

	const translated = sentences
		.map((seg: unknown[]) =>
			Array.isArray(seg) && seg.length >= 2 ? seg[0] : "",
		)
		.filter(Boolean)
		.join("");
	console.log(translated);

	const detectedLang =
		data.length >= 13 && typeof data[13] === "string"
			? data[13]
			: srcLang || "auto";

	console.log("[GoogleTranslate] SUCCESS", {
		translated,
		detectedLang,
	});

	return {
		translatedText: translated || text,
		sourceLang: detectedLang,
	};
}

export async function googleTranslateBatch(
	texts: string[],
	targetLang: string,
	srcLang?: string,
): Promise<GoogleTranslateResult[]> {
	const results: GoogleTranslateResult[] = [];
	for (const text of texts) {
		const result = await googleTranslateText(text, targetLang, srcLang);
		results.push(result);
	}
	return results;
}

export { toGoogleCode, toNllbCode };
