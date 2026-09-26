export type Point = { x: number; y: number };

export type OCRBox = {
	text: string;
	box: { x: number; y: number; width: number; height: number };
	polygon: Point[];
	translation?: string;
};

export type OCRRegion = {
	text: string;
	boxes: OCRBox[];
	bounds: { top: number; left: number; width: number; height: number };
	translation?: string;
};

export type OCRResult = OCRBox[];

/** One image handed to the OCR engine. `imageData` is base64 for `base64` and a URL for `url`. */
export type OcrInputItem = {
	fetchingType: "url" | "base64";
	imageData: string;
	headers?: Record<string, string>;
};

export type CanvasInfo = {
	index: number;
	width: number;
	height: number;
};

export type DomainPattern =
	| string
	| { pattern: string; matchType: "domain" | "include" | "regex" };

export type ImageInfoWithStatus = {
	src: string;
	currentSrc: string;
	width: number;
	height: number;
	status: "pending" | "processing" | "done" | "error";
};

export type CanvasInfoWithStatus = {
	index: number;
	width: number;
	height: number;
	status: "pending" | "processing" | "done" | "error";
};

export * from "./messages";
