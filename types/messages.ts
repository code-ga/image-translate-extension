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
			translationProvider: "api" | "local";
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
			translationProvider: "api" | "local";
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

export type ExtensionErrorMessage = Message<
	"extension/error",
	{
		error: string;
	}
>;

export type AppMessage =
	| GetSettingsMessage
	| NotifySettingsChangedMessage
	| SettingsChangedMessage
	| GetImagesMessage
	| GetImageStatusMessage
	| GetCanvasesMessage
	| GetCanvasStatusMessage
	| TranslateImagesCommand
	| TranslateCanvasesCommand
	| TranslateProgressMessage
	| TranslateCompleteMessage
	| ContextMenuTranslateMessage
	| ExtensionErrorMessage;
