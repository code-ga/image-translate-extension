const GOOGLE_TRANSLATE_ENDPOINT =
	"https://translate.googleapis.com/translate_a/single";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;
const MAX_CONCURRENT_REQUESTS = 5;

type GoogleResponse = [
	Array<[string, ...unknown[]] | null>,
	unknown,
	string,
	unknown,
	unknown,
];

/**
 * Google `tl` codes for the NLLB codes this extension can target. The local
 * engine is hard-wired to Vietnamese; the API path honours the requested
 * target, so the popup's language choice actually works there.
 */
const GOOGLE_TARGET_CODES: Record<string, string> = {
	eng_Latn: "en",
	jpn_Jpan: "ja",
	zho_Hans: "zh-CN",
	zho_Hant: "zh-TW",
	kor_Hang: "ko",
	fra_Latn: "fr",
	deu_Latn: "de",
	spa_Latn: "es",
	por_Latn: "pt",
	ita_Latn: "it",
	rus_Cyrl: "ru",
	arb_Arab: "ar",
	hin_Deva: "hi",
	tha_Thai: "th",
	vie_Latn: "vi",
};

/** ISO 639-3 (as used by the language detector) to ISO 639-1 (as Google wants). */
const ISO_639_3_TO_639_1: Record<string, string> = {
	eng: "en",
	jpn: "ja",
	zho: "zh",
	cmn: "zh",
	kor: "ko",
	fra: "fr",
	deu: "de",
	spa: "es",
	por: "pt",
	ita: "it",
	rus: "ru",
	ara: "ar",
	arb: "ar",
	hin: "hi",
	tha: "th",
	vie: "vi",
	tur: "tr",
	ind: "id",
	nld: "nl",
	pol: "pl",
};

/** Plain language codes accepted as-is (the popup's list plus common extras). */
const GOOGLE_LANGUAGE_CODES = new Set([
	"ar",
	"bg",
	"cs",
	"da",
	"de",
	"el",
	"en",
	"es",
	"fi",
	"fr",
	"he",
	"hi",
	"hu",
	"id",
	"it",
	"ja",
	"ko",
	"ms",
	"nl",
	"no",
	"pl",
	"pt",
	"ro",
	"ru",
	"sv",
	"th",
	"tl",
	"tr",
	"uk",
	"vi",
	"zh",
]);

const DEFAULT_TARGET = "vi";

export function toGoogleLanguageCode(code: string | undefined): string {
	if (!code) return DEFAULT_TARGET;

	const direct = GOOGLE_TARGET_CODES[code];
	if (direct) return direct;

	// `vie_Latn` -> `vie`; a plain `vi` stays `vi`.
	const base = code.toLowerCase().split("_")[0];
	const mapped = ISO_639_3_TO_639_1[base];
	if (mapped) return mapped;

	// Anything unrecognised would make the endpoint reject the request.
	return GOOGLE_LANGUAGE_CODES.has(base) ? base : DEFAULT_TARGET;
}

async function translateOne(text: string, target: string): Promise<string> {
	const params = new URLSearchParams({
		client: "gtx",
		sl: "auto",
		tl: target,
		dt: "t",
		q: text,
	});

	let lastError: unknown = null;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(
				`${GOOGLE_TRANSLATE_ENDPOINT}?${params.toString()}`,
				{ signal: controller.signal },
			);
			if (!response.ok) {
				throw new Error(`Google Translate responded ${response.status}`);
			}
			const payload = (await response.json()) as GoogleResponse;
			const segments = payload?.[0];
			if (!Array.isArray(segments)) {
				throw new Error("Google Translate returned an unexpected payload");
			}
			return segments
				.map((segment) => (segment ? segment[0] : ""))
				.join("")
				.trim();
		} catch (error) {
			lastError = error;
		} finally {
			clearTimeout(timer);
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("Google Translate request failed");
}

/**
 * Translates texts through the free Google Translate endpoint. Runs inside the
 * translation Web Worker, which inherits the extension's host permissions.
 * At most `MAX_CONCURRENT_REQUESTS` requests are in flight so the endpoint is
 * not hammered on a page with many OCR regions.
 */
export async function translateTextsWithGoogle(
	texts: string[],
	targetLang: string | undefined,
): Promise<string[]> {
	const target = toGoogleLanguageCode(targetLang);
	const results = new Array<string>(texts.length);
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < texts.length) {
			const index = nextIndex++;
			results[index] = await translateOne(texts[index], target);
		}
	};

	const workers = Array.from(
		{ length: Math.min(MAX_CONCURRENT_REQUESTS, texts.length) },
		() => worker(),
	);

	await Promise.all(workers);
	return results;
}
