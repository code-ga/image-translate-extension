import { getFromCache, setInCache } from "./cache/translation-cache";
import { mapToNllbCode } from "./language/language-map";
import { translateTexts as runTranslation } from "./model-manager";
import { normalizeOutput } from "./postprocess/normalize-output";
import { normalizeText } from "./preprocess/normalize";
import { protectTokens, type TokenMap } from "./preprocess/protect-tokens";
import type {
	ModelProgress,
	NllbLanguageCode,
	TranslationError,
	TranslationProvider,
	TranslationRequest,
	TranslationResponse,
	TranslationResult,
	TranslationUnit,
} from "./types";
import { ENGINE_VERSION, MODEL_VERSION, TARGET_LANGUAGE } from "./types";

type CachedUnit = {
	unit: TranslationUnit;
	srcLang: NllbLanguageCode;
	protectedText: string;
	tokens: TokenMap;
};

/**
 * Cached translations are namespaced per provider so switching between the
 * hosted API and the local model never serves one engine's output to the other.
 */
const API_CACHE_NAMESPACE = "google-translate-api-v1";

function cacheNamespace(provider: TranslationProvider): string {
	return provider === "api" ? API_CACHE_NAMESPACE : MODEL_VERSION;
}

function originalResult(unit: TranslationUnit): TranslationResult {
	return {
		unitId: unit.id,
		translatedText: unit.sourceText,
		sourceLanguage: unit.detectedLanguage,
		cached: false,
		bbox: unit.bbox,
		boxReferences: unit.boxReferences,
		boxIndexes: unit.boxIndexes,
	};
}

function languageError(
	unit: TranslationUnit,
	code: TranslationError["code"],
	message: string,
): TranslationError {
	return { code, message, unitId: unit.id, recoverable: true };
}

export async function scheduleTranslation(
	request: TranslationRequest,
	onProgress?: (progress: ModelProgress) => void,
): Promise<TranslationResponse> {
	const provider: TranslationProvider = request.provider ?? "local";
	const cacheVersion = cacheNamespace(provider);
	const results = new Map<string, TranslationResult>();
	const errors: TranslationError[] = [];
	const translatable: CachedUnit[] = [];

	for (const unit of request.units) {
		if (!unit.sourceText.trim()) {
			results.set(unit.id, originalResult(unit));
			continue;
		}
		if (unit.detectedLanguage === "vie") {
			results.set(unit.id, originalResult(unit));
			continue;
		}
		if (unit.detectedLanguage === "unknown") {
			results.set(unit.id, originalResult(unit));
			errors.push(
				languageError(
					unit,
					"LANGUAGE_UNKNOWN",
					"Language detection confidence too low; original text returned",
				),
			);
			continue;
		}

		const srcLang = mapToNllbCode(unit.detectedLanguage);
		if (!srcLang) {
			results.set(unit.id, originalResult(unit));
			errors.push(
				languageError(
					unit,
					"LANGUAGE_UNSUPPORTED",
					"Detected language is not supported",
				),
			);
			continue;
		}

		try {
			const normalizedText = normalizeText(unit.sourceText);
			const { protectedText, tokens } = protectTokens(normalizedText);
			translatable.push({ unit, srcLang, protectedText, tokens });
		} catch (error) {
			results.set(unit.id, originalResult(unit));
			errors.push(
				languageError(
					unit,
					"PREPROCESS_FAILED",
					error instanceof Error ? error.message : "Text preprocessing failed",
				),
			);
		}
	}

	const grouped = new Map<NllbLanguageCode, CachedUnit[]>();
	for (const unit of translatable) {
		const group = grouped.get(unit.srcLang) ?? [];
		group.push(unit);
		grouped.set(unit.srcLang, group);
	}

	for (const [srcLang, units] of grouped) {
		const cachedByIndex = new Map<number, string>();
		const uncached: CachedUnit[] = [];

		for (let index = 0; index < units.length; index++) {
			const unit = units[index];
			const cached = await getFromCache(
				cacheVersion,
				ENGINE_VERSION,
				srcLang,
				TARGET_LANGUAGE,
				unit.protectedText,
			);
			if (cached !== null) {
				cachedByIndex.set(index, cached);
			} else {
				uncached.push(unit);
			}
		}

		let translatedTexts: string[] = [];
		if (uncached.length > 0) {
			try {
				translatedTexts = await runTranslation(
					uncached.map((unit) => unit.protectedText),
					srcLang,
					onProgress,
					provider,
					request.targetLang ?? TARGET_LANGUAGE,
				);
				for (let index = 0; index < uncached.length; index++) {
					const unit = uncached[index];
					const translated = translatedTexts[index] ?? unit.protectedText;
					const finalText = normalizeOutput(translated, unit.tokens);
					results.set(unit.unit.id, {
						unitId: unit.unit.id,
						translatedText: finalText,
						sourceLanguage: unit.unit.detectedLanguage,
						cached: false,
						bbox: unit.unit.bbox,
						boxReferences: unit.unit.boxReferences,
						boxIndexes: unit.unit.boxIndexes,
					});
					await setInCache(
						cacheVersion,
						ENGINE_VERSION,
						srcLang,
						TARGET_LANGUAGE,
						unit.protectedText,
						finalText,
					);
				}
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Translation inference failed";
				for (const unit of uncached) {
					results.set(unit.unit.id, originalResult(unit.unit));
					errors.push(languageError(unit.unit, "INFERENCE_FAILED", message));
				}
			}
		}

		for (let index = 0; index < units.length; index++) {
			const unit = units[index];
			if (results.has(unit.unit.id)) continue;
			const cached = cachedByIndex.get(index);
			if (cached !== undefined) {
				results.set(unit.unit.id, {
					unitId: unit.unit.id,
					translatedText: cached,
					sourceLanguage: unit.unit.detectedLanguage,
					cached: true,
					bbox: unit.unit.bbox,
					boxReferences: unit.unit.boxReferences,
					boxIndexes: unit.unit.boxIndexes,
				});
			} else {
				results.set(unit.unit.id, originalResult(unit.unit));
			}
		}
	}

	return {
		results: request.units.map(
			(unit) => results.get(unit.id) ?? originalResult(unit),
		),
		errors,
	};
}
