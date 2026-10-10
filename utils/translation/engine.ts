import { getCachedTranslation, setCachedTranslation } from "./cache";
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
const MOCK_DELAY = 100;

function mockTranslateText(text: string, targetLang: NllbLanguageCode): string {
	const mockTranslations: Record<string, Record<NllbLanguageCode, string>> = {
		Hello: { vie_Latn: "Xin chào", eng_Latn: "Hello" },
		World: { vie_Latn: "Thế giới", eng_Latn: "World" },
		Test: { vie_Latn: "Kiểm tra", eng_Latn: "Test" },
	};
	return mockTranslations[text]?.[targetLang] || `[${targetLang}] ${text}`;
}

export async function warmup(): Promise<void> {
	if (isDisposed) throw new Error("Translation engine disposed");
	await new Promise((r) => setTimeout(r, MOCK_DELAY));
}

export async function getStatus(): Promise<ModelStatus> {
	if (isDisposed) return { state: "unavailable" };
	return { state: "ready" };
}

export async function dispose(): Promise<void> {
	isDisposed = true;
}

export async function translate(
	request: TranslationRequest,
): Promise<TranslationResponse> {
	if (isDisposed) throw new Error("Translation engine disposed");
	if (!request.units.length) return { results: [], errors: [] };

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

	const newResults: TranslationResult[] = uncachedUnits.map((unit) => ({
		unitId: unit.id,
		translatedText: mockTranslateText(unit.sourceText, request.targetLang),
		sourceLang: unit.detectedLanguage,
		targetLang: request.targetLang,
		cached: false,
	}));

	const workerRequest: TranslationRequest = {
		units: uncachedUnits,
		targetLang: request.targetLang,
	};
	await setCachedTranslation(workerRequest, newResults);

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
		return {
			translatedText: response.results[0].translatedText,
			detectedLang: response.results[0].sourceLang,
		};
	}
	throw new Error("No translation result");
}
