import type { OCRRegion } from "./index";

export type MessageRoute = {
	from: "content" | "background" | "offscreen";
	to: "background" | "content" | "offscreen" | "all";
};

export type Message<
	T extends string,
	P extends object = Record<string, never>,
> = MessageRoute & {
	type: T;
} & P;

export type OcrImagePayload = {
	fetchingType: "url" | "base64";
	imageData: string;
	headers?: Record<string, string>;
};

export type OcrResultItem =
	| { success: true; data: OCRRegion[] }
	| { success: false; error: string };

export type ProcessOcrMessage = Message<
	"ocr/process",
	OcrImagePayload & { requestId?: string }
>;

export type OcrResultMessage = Message<
	"ocr/result",
	{
		requestId: string;
		success: boolean;
		ocrData?: OCRRegion[];
		error?: string;
	}
>;

export type BatchRunOcrMessage = Message<
	"offscreen/batch-run-ocr",
	{
		items: OcrImagePayload[];
	}
>;

export type BatchRunOcrResponse =
	| { success: true; results: OcrResultItem[] }
	| { success: false; error: string };

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
		status: "pending" | "processing" | "done";
	}[];
};

export type CanvasStatusListResponse = {
	type: "ui/canvas-status-list";
	canvases: {
		index: number;
		width: number;
		height: number;
		status: "pending" | "processing" | "done";
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

export type ExtensionErrorMessage = Message<
	"extension/error",
	{
		error: string;
		context?: Record<string, unknown>;
	}
>;

export type AppMessage =
	| ProcessOcrMessage
	| OcrResultMessage
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
	| TranslateProgressMessage
	| TranslateCompleteMessage
	| ContextMenuTranslateMessage
	| ExtensionErrorMessage;
