import type { OCRBox } from "@/types";

export type NllbLanguageCode =
	| "eng_Latn"
	| "jpn_Jpan"
	| "zho_Hans"
	| "zho_Hant"
	| "kor_Hang"
	| "fra_Latn"
	| "deu_Latn"
	| "spa_Latn"
	| "por_Latn"
	| "ita_Latn"
	| "rus_Cyrl"
	| "arb_Arab"
	| "hin_Deva"
	| "tha_Thai"
	| "vie_Latn";

export type SupportedSourceLanguage =
	| "eng"
	| "jpn"
	| "cmn"
	| "zho"
	| "kor"
	| "fra"
	| "deu"
	| "spa"
	| "por"
	| "ita"
	| "rus"
	| "ara"
	| "hin"
	| "tha"
	| "vie";

export type ScriptType =
	| "latin"
	| "hiragana"
	| "katakana"
	| "han"
	| "hangul"
	| "cyrillic"
	| "arabic"
	| "devanagari"
	| "thai"
	| "bengali"
	| "gurmukhi"
	| "gujarati"
	| "kannada"
	| "malayalam"
	| "odia"
	| "tamil"
	| "telugu"
	| "sinhala"
	| "myanmar"
	| "khmer"
	| "lao"
	| "georgian"
	| "greek"
	| "hebrew"
	| "armenian"
	| "ethiopic"
	| "unknown";

export type ScriptStats = Record<ScriptType, number>;

export type LanguageCandidate = {
	language: SupportedSourceLanguage;
	score: number;
};

export type LanguageDetectionResult = {
	language: SupportedSourceLanguage | "unknown" | "vie";
	confidence: number;
	method: "script" | "tinyld" | "passthrough";
	scriptStats: ScriptStats;
	candidates: LanguageCandidate[];
};

export type TranslationUnit = {
	id: string;
	sourceText: string;
	bbox: { x: number; y: number; width: number; height: number };
	boxReferences: OCRBox[];
	detectedLanguage: SupportedSourceLanguage | "unknown" | "vie";
	detectionConfidence: number;
};

export type TranslationRequest = {
	units: TranslationUnit[];
	targetLang?: NllbLanguageCode;
};

export type TranslationResponse = {
	results: TranslationResult[];
	errors: TranslationError[];
};

export type TranslationResult = {
	unitId: string;
	translatedText: string;
	sourceLanguage: SupportedSourceLanguage | "unknown" | "vie";
	cached: boolean;
	bbox: TranslationUnit["bbox"];
};

export type TranslationErrorCode =
	| "MODEL_DOWNLOAD_FAILED"
	| "MODEL_LOAD_FAILED"
	| "LANGUAGE_UNKNOWN"
	| "LANGUAGE_UNSUPPORTED"
	| "INFERENCE_FAILED"
	| "CACHE_ERROR"
	| "WORKER_ERROR"
	| "TOKEN_PROTECTION_FAILED"
	| "GROUPING_FAILED"
	| "PREPROCESS_FAILED"
	| "POSTPROCESS_FAILED";

export type TranslationError = {
	code: TranslationErrorCode;
	message: string;
	unitId?: string;
	recoverable: boolean;
};

export type TranslationCacheKey = {
	hash: string;
	modelVersion: string;
	engineVersion: string;
	srcLang: NllbLanguageCode;
	targetLang: NllbLanguageCode;
};

export type ModelStatus =
	| "UNAVAILABLE"
	| "DOWNLOADING"
	| "LOADING"
	| "READY"
	| "INFERENCE"
	| "ERROR";

export type ModelProgress = {
	status: ModelStatus;
	message?: string;
	progress?: number;
	file?: string;
};

export type TranslationWorkerRequest =
	| {
			type: "translate";
			payload: TranslationRequest;
			requestId: string;
	  }
	| {
			type: "warmup" | "dispose" | "status";
			payload?: undefined;
			requestId: string;
	  };

export type TranslationWorkerResponse =
	| {
			type: "result";
			payload: TranslationResponse;
			requestId: string;
	  }
	| {
			type: "progress";
			payload: ModelProgress;
			requestId: string;
	  }
	| {
			type: "error";
			payload: TranslationError;
			requestId: string;
	  }
	| {
			type: "status";
			payload: ModelStatus;
			requestId: string;
	  };

export type TranslationCacheEntry = {
	hash: string;
	modelVersion: string;
	engineVersion: string;
	srcLang: NllbLanguageCode;
	targetLang: NllbLanguageCode;
	result: string;
	timestamp: number;
};

export const MAX_TRANSLATION_CHARS = 800;
export const TARGET_LANGUAGE: NllbLanguageCode = "vie_Latn";
export const MODEL_VERSION = "nllb-200-distilled-600M-v1";
export const ENGINE_VERSION = "1.0.0";
export const DETECTION_CONFIDENCE_THRESHOLD = 0.6;
export const IDLE_UNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
