import type { OCRRegion } from "./index";

export type MessageRoute = {
	from: "content" | "background" | "offscreen" | "popup";
	to: "background" | "content" | "offscreen" | "all";
};

export type Message<T extends string, P extends object = Record<string, never>> = MessageRoute & {
	type: T;
} & P;

export type ProcessOcrMessage = Message<
	"ocr/process",
	{
		fetchingType: "url" | "base64";
		imageData: string;
		headers?: Record<string, string>;
		/** Kind of element the OCR request originates from. */
		targetType?: "image" | "canvas";
		/** Human readable identifier of the element (image src / canvas index). */
		target?: string;
	}
>;

export type ProcessOcrResponse = {
	success: boolean;
	ocrData?: OCRRegion[];
	error?: string;
	/** Identifier of the OCR job tracked by the background job registry. */
	jobId?: string;
};

export type OcrJobStatus = "queued" | "processing" | "done" | "error";

export type OcrJob = {
	id: string;
	tabId: number;
	tabUrl: string;
	type: "image" | "canvas";
	target: string;
	status: OcrJobStatus;
	createdAt: number;
	finishedAt?: number;
	error?: string;
};

export type OcrJobStartedMessage = Message<
	"ocr/job-started",
	{
		jobId: string;
		/** Kind of element the job belongs to. */
		targetType: "image" | "canvas";
		/** Human readable identifier of the element (image src / canvas index). */
		target: string;
		tabId?: number;
		tabUrl?: string;
	}
>;

export type OcrJobCompletedMessage = Message<
	"ocr/job-completed",
	{
		jobId: string;
	}
>;

export type OcrJobFailedMessage = Message<
	"ocr/job-failed",
	{
		jobId: string;
		error?: string;
	}
>;

export type GetOcrQueueMessage = Message<"ocr/get-queue">;

export type GetOcrQueueResponse = {
	jobs: OcrJob[];
};

export type BatchRunOcrMessage = Message<
	"offscreen/batch-run-ocr",
	{
		items: {
			fetchingType: "url" | "base64";
			imageData: string;
		}[];
	}
>;

export type BatchRunOcrResponse = {
	success: boolean;
	results?: any[];
	error?: string;
};

export type GetSettingsMessage = Message<"settings/get">;

export type NotifySettingsChangedMessage = Message<
	"settings/notify-changed",
	{
		settings: {
			enabled: boolean;
			enabledDomains:
				| string
				| { pattern: string; matchType: "domain" | "include" | "regex" }[];
			targetLang: string;
		};
	}
>;

export type SettingsChangedMessage = Message<
	"settings/changed",
	{
		settings: {
			enabled: boolean;
			enabledDomains:
				| string
				| { pattern: string; matchType: "domain" | "include" | "regex" }[];
			targetLang: string;
		};
	}
>;

export type GetImagesMessage = Message<"ui/get-images">;

export type GetImageStatusMessage = Message<"ui/get-image-status">;

export type GetCanvasesMessage = Message<"ui/get-canvases">;

export type GetCanvasStatusMessage = Message<"ui/get-canvas-status">;

export type ImagesListResponse = {
	type: "ui/images-list";
	images: { src: string; currentSrc: string; width: number; height: number }[];
};

export type CanvasListResponse = {
	type: "ui/canvas-list";
	canvases: { index: number; width: number; height: number }[];
};

export type ImageStatusListResponse = {
	type: "ui/image-status-list";
	images: {
		src: string;
		currentSrc: string;
		width: number;
		height: number;
		status: "pending" | "processing" | "done" | "error";
	}[];
};

export type CanvasStatusListResponse = {
	type: "ui/canvas-status-list";
	canvases: {
		index: number;
		width: number;
		height: number;
		status: "pending" | "processing" | "done" | "error";
	}[];
};

export type TranslateImagesCommand = Message<
	"translate/images",
	{
		urls: string[];
	}
>;

export type TranslateCanvasesCommand = Message<
	"translate/canvases",
	{
		indices: number[];
	}
>;

export type TranslateProgressMessage = Message<
	"translate/progress",
	{
		url: string;
		index: number;
		total: number;
		success: boolean;
		error?: string;
	}
>;

export type TranslateCompleteMessage = Message<
	"translate/complete",
	{
		total: number;
		successCount: number;
	}
>;

export type ContextMenuTranslateMessage = Message<
	"background/translate",
	{
		url: string;
	}
>;

export type TranslateTextMessage = Message<
	"translate/text",
	{
		text: string;
		srcLang: string;
		targetLang: string;
	}
>;

export type TranslateTextResponse = {
	success: boolean;
	translatedText?: string;
	error?: string;
};

export type TranslateRegionsMessage = Message<
	"translate/regions",
	{
		regions: OCRRegion[];
	}
>;

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

export type TranslateRegionsResponse = {
	success: boolean;
	regions?: OCRRegion[];
	errors?: TranslationError[];
	error?: string;
};

export type OffscreenTranslateTextMessage = Message<
	"offscreen/translate-text",
	{
		text: string;
		srcLang: string;
		targetLang: string;
	}
>;

export type OffscreenTranslateTextResponse = {
	success: boolean;
	translatedText?: string;
	detectedLang?: string;
	error?: string;
};

export type OffscreenTranslateRegionsMessage = Message<
	"offscreen/translate-regions",
	{
		regions: OCRRegion[];
		targetLang: string;
	}
>;

export type OffscreenTranslateRegionsResponse = {
	success: boolean;
	regions?: OCRRegion[];
	errors?: TranslationError[];
	error?: string;
};

export type ExtensionErrorMessage = Message<
	"extension/error",
	{
		error: string;
	}
>;

export type AppMessage =
	| ProcessOcrMessage
	| BatchRunOcrMessage
	| GetSettingsMessage
	| NotifySettingsChangedMessage
	| SettingsChangedMessage
	| GetImagesMessage
	| GetImageStatusMessage
	| GetCanvasesMessage
	| GetCanvasStatusMessage
	| TranslateImagesCommand
	| TranslateCanvasesCommand
	| TranslateTextMessage
	| TranslateRegionsMessage
	| OffscreenTranslateTextMessage
	| OffscreenTranslateRegionsMessage
	| TranslateProgressMessage
	| TranslateCompleteMessage
	| ContextMenuTranslateMessage
	| ExtensionErrorMessage
	| OcrJobStartedMessage
	| OcrJobCompletedMessage
	| OcrJobFailedMessage
	| GetOcrQueueMessage;
