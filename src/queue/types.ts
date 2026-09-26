import type { Browser } from "wxt/browser";
import type { TranslationError } from "@/src/translation/types";
import type { OCRRegion } from "@/types";

/** Long-lived port shared between extension contexts. */
export type ExtensionPort = Browser.runtime.Port;

/** Port name used by content scripts to reach the background port router. */
export const CONTENT_PORT_NAME = "image-translate/content";

/** Port name used by the background service worker to reach the offscreen document. */
export const OFFSCREEN_PORT_NAME = "image-translate/offscreen";

export type JobType = "ocr" | "translate";

export type OcrJobPayload = {
	kind: "ocr";
	fetchingType: "url" | "base64";
	imageData: string;
	headers?: Record<string, string>;
};

export type TranslateRegionsJobPayload = {
	kind: "translate-regions";
	regions: OCRRegion[];
};

export type TranslateTextJobPayload = {
	kind: "translate-text";
	text: string;
	srcLang: string;
	targetLang: string;
};

export type JobPayload =
	| OcrJobPayload
	| TranslateRegionsJobPayload
	| TranslateTextJobPayload;

export type JobResponse = {
	success: boolean;
	ocrData?: OCRRegion[];
	regions?: OCRRegion[];
	errors?: TranslationError[];
	translatedText?: string;
	error?: string;
};

export type Job = {
	id: string;
	type: JobType;
	payload: JobPayload;
	priority: number;
	sequence: number;
	resolve: (response: JobResponse) => void;
	reject: (error: Error) => void;
};

export type OcrJob = Job & {
	type: "ocr";
	payload: OcrJobPayload;
};

export type JobInput = {
	id?: string;
	payload: JobPayload;
	resolve: (response: JobResponse) => void;
	reject: (error: Error) => void;
};

/** Sent by a client to ask the offscreen document to enqueue a job. */
export type QueueRequest = {
	type: "queue/enqueue";
	jobId: string;
	payload: JobPayload;
};

/** Sent by the offscreen document once its port handler is installed. */
export type QueueReady = {
	type: "queue/ready";
};

/** Client-side handshake probe; the offscreen document answers with `QueueReady`. */
export type QueuePing = {
	type: "queue/ping";
};

/** Sent by the offscreen document when a job finishes (successfully or not). */
export type QueueResult = {
	type: "queue/result";
	jobId: string;
	response: JobResponse;
};

export type PortControlMessage = QueuePing | QueueReady;
