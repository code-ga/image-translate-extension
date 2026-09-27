export type NllbLanguageCode =
	| "eng_Latn"
	| "vie_Latn"
	| "zho_Hans"
	| "zho_Hant"
	| "jpn_Jpan"
	| "kor_Hang"
	| "fra_Latn"
	| "deu_Latn"
	| "spa_Latn"
	| "ita_Latn"
	| "por_Latn"
	| "rus_Cyrl"
	| "ara_Arab"
	| "hin_Deva"
	| "tha_Thai"
	| "ind_Latn"
	| "msa_Latn"
	| "tur_Latn"
	| "pol_Latn"
	| "ukr_Cyrl"
	| "ces_Latn"
	| "nld_Latn"
	| "swe_Latn"
	| "dan_Latn"
	| "fin_Latn"
	| "nor_Latn"
	| "ell_Grek"
	| "heb_Hebr"
	| "hun_Latn"
	| "ron_Latn"
	| "bul_Cyrl"
	| "hrv_Latn"
	| "slk_Latn"
	| "slv_Latn"
	| "est_Latn"
	| "lav_Latn"
	| "lit_Latn";

export type TranslationUnit = {
	id: string;
	sourceText: string;
	bbox: { x: number; y: number; width: number; height: number };
	boxReferences: { regionIndex: number; boxIndex: number }[];
	detectedLanguage: NllbLanguageCode | "unknown";
	detectionConfidence: number;
};

export type TranslationRequest = {
	units: TranslationUnit[];
	targetLang: NllbLanguageCode;
};

export type TranslationResult = {
	unitId: string;
	translatedText: string;
	sourceLang: NllbLanguageCode;
	targetLang: NllbLanguageCode;
	cached: boolean;
};

export type TranslationError = {
	unitId: string;
	message: string;
	code:
		| "MODEL_LOAD_FAILED"
		| "INFERENCE_FAILED"
		| "LANGUAGE_DETECTION_FAILED"
		| "CACHE_ERROR"
		| "WORKER_ERROR"
		| "UNKNOWN_ERROR";
};

export type TranslationResponse = {
	results: TranslationResult[];
	errors: TranslationError[];
};

export type ModelStatus =
	| { state: "unavailable" }
	| { state: "downloading"; progress: number }
	| { state: "loading"; progress: number }
	| { state: "ready" }
	| { state: "inference" }
	| { state: "error"; message: string };

export type WorkerMessage =
	| { type: "translate"; request: TranslationRequest; requestId: string }
	| { type: "warmup"; requestId: string }
	| { type: "dispose"; requestId: string }
	| { type: "status"; requestId: string };

export type WorkerResponse =
	| { type: "translate"; requestId: string; response: TranslationResponse }
	| { type: "warmup"; requestId: string; success: boolean; error?: string }
	| { type: "dispose"; requestId: string; success: boolean }
	| { type: "status"; requestId: string; status: ModelStatus }
	| { type: "error"; requestId: string; error: string };
