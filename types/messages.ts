export type MessageRoute = {
	from: "content" | "background" | "offscreen";
	to: "background" | "content" | "offscreen" | "all";
};

export type Message<T extends string, P extends object = {}> =
	MessageRoute & {
		type: T;
	} & P;

export type ProcessOcrMessage = Message<
	"ocr/process",
	{
		fetchingType: "url" | "base64";
		imageData: string;
		headers?: Record<string, string>;
	}
>;

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
			enabledDomains: string | { pattern: string; matchType: "domain" | "include" | "regex" }[];
			targetLang: string;
		};
	}
>;

export type SettingsChangedMessage = Message<
	"settings/changed",
	{
		settings: {
			enabled: boolean;
			enabledDomains: string | { pattern: string; matchType: "domain" | "include" | "regex" }[];
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
	| TranslateProgressMessage
	| TranslateCompleteMessage
	| ContextMenuTranslateMessage
	| ExtensionErrorMessage;
