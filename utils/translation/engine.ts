import { getCachedTranslation, setCachedTranslation } from "./cache";
import { googleTranslateText, toGoogleCode, toNllbCode } from "./google";
import { detectLanguagesForUnits } from "./language-detector";
import type {
	ModelStatus,
	NllbLanguageCode,
	TranslationRequest,
	TranslationResponse,
	TranslationResult,
	TranslationUnit,
} from "./types";

let isDisposed = false;
const MOCK_DELAY = 50;

export async function warmup(): Promise<void> {
	if (isDisposed) throw new Error("Translation engine disposed");
	console.log("[Engine] warmup START");
	await new Promise((r) => setTimeout(r, MOCK_DELAY));
	console.log("[Engine] warmup DONE");
}

export async function getStatus(): Promise<ModelStatus> {
	if (isDisposed) return { state: "unavailable" };
	return { state: "ready" };
}

export async function dispose(): Promise<void> {
	console.log("[Engine] dispose");
	isDisposed = true;
}
export async function translate(
	request: TranslationRequest,
): Promise<TranslationResponse> {
	if (isDisposed) throw new Error("Translation engine disposed");
	if (!request.units.length) return { results: [], errors: [] };

	console.log("[Engine] translate START", {
		unitCount: request.units.length,
		targetLang: request.targetLang,
	});

	await new Promise((r) => setTimeout(r, MOCK_DELAY));

	const unitsWithLang = await detectLanguagesForUnits(request.units);
	const cachedResults: TranslationResult[] = [];
	const uncachedUnits: TranslationUnit[] = [];

	for (const unit of unitsWithLang) {
		const cached = await getCachedTranslation({
			units: [unit],
			targetLang: request.targetLang,
		});
		if (cached) {
			cachedResults.push(...cached);
		} else {
			uncachedUnits.push(unit);
		}
	}

	console.log("[Engine] cache check", {
		cached: cachedResults.length,
		uncached: uncachedUnits.length,
	});

	const newResults: TranslationResult[] = [];

	for (const unit of uncachedUnits) {
		try {
			const srcLang =
				unit.detectedLanguage !== "unknown" ? unit.detectedLanguage : undefined;
			const googleTarget = toGoogleCode(request.targetLang);
			console.log("[Engine] translating unit", {
				unitId: unit.id,
				text: unit.sourceText,
				googleTarget,
			});
			const result = await googleTranslateText(
				unit.sourceText,
				googleTarget,
				srcLang ? toGoogleCode(srcLang) : undefined,
			);

			const sourceLangNllb = srcLang
				? (srcLang as NllbLanguageCode)
				: (toNllbCode(result.sourceLang) as NllbLanguageCode);

			const translationResult: TranslationResult = {
				unitId: unit.id,
				translatedText: result.translatedText,
				sourceLang: sourceLangNllb,
				targetLang: request.targetLang,
				cached: false,
			};
			newResults.push(translationResult);
		} catch (error) {
			console.log("[Engine] translate_FAILED, fallback to original", {
				unitId: unit.id,
				error: error instanceof Error ? error.message : error,
			});
			// Fallback: return original text on error
			const translationResult: TranslationResult = {
				unitId: unit.id,
				translatedText: unit.sourceText,
				sourceLang: (unit.detectedLanguage as NllbLanguageCode) || "eng_Latn",
				targetLang: request.targetLang,
				cached: false,
			};
			newResults.push(translationResult);
		}
	}

	if (uncachedUnits.length > 0) {
		const workerRequest: TranslationRequest = {
			units: uncachedUnits,
			targetLang: request.targetLang,
		};
		await setCachedTranslation(workerRequest, newResults);
	}

	console.log("[Engine] translate DONE", {
		totalResults: cachedResults.length + newResults.length,
	});

	return {
		results: [...cachedResults, ...newResults],
		errors: [],
	};
}
export async function translateText(
	text: string,
	srcLang: string,
	targetLang: NllbLanguageCode,
): Promise<{ translatedText: string; detectedLang: NllbLanguageCode }> {
	if (isDisposed) throw new Error("Translation engine disposed");
	console.log("[Engine] translateText START", { text, srcLang, targetLang });

	const unit: TranslationUnit = {
		id: `text_${Date.now()}_${Math.random().toString(36).slice(2)}`,
		sourceText: text,
		bbox: { x: 0, y: 0, width: 0, height: 0 },
		boxReferences: [],
		detectedLanguage: (srcLang ||
			"unknown") as TranslationUnit["detectedLanguage"],
		detectionConfidence: srcLang ? 1 : 0,
	};

	const response = await translate({ units: [unit], targetLang });
	if (response.results.length > 0) {
		console.log("[Engine] translateText DONE", {
			translatedText: response.results[0].translatedText,
		});
		return {
			translatedText: response.results[0].translatedText,
			detectedLang: response.results[0].sourceLang,
		};
	}
	throw new Error("No translation result");
}
