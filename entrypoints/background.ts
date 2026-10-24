declare const self: ServiceWorkerGlobalScope;

import { OCR_BATCH_DEBOUNCE_MS, OCR_BATCH_SIZE } from "@/config/ocr-config";
import type {
	AppMessage,
	GetOcrQueueResponse,
	OCRRegion,
	OcrJob,
	OcrJobStatus,
	OffscreenTranslateRegionsMessage,
	OffscreenTranslateRegionsResponse,
	OffscreenTranslateTextMessage,
	OffscreenTranslateTextResponse,
	ProcessOcrMessage,
	ProcessOcrResponse,
	TranslateRegionsMessage,
	TranslateRegionsResponse,
	TranslateTextMessage,
	TranslateTextResponse,
} from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { getExtensionSettings } from "@/utils/extension-settings";
import { hashImageData, OcrCache } from "@/utils/ocr-cache";

export default defineBackground({
	type: "module",
	async main() {
		browser.runtime.onStartup.addListener(async () => {
			await ensureOffscreenRunning();
			console.log("model init successful");
		});

		browser.runtime.onInstalled.addListener(async () => {
			console.log("browser extension installed");
			await ensureOffscreenRunning();
			console.log("model init successful");
		});

		browser.runtime.onInstalled.addListener(() => {
			browser.contextMenus.create({
				id: "translate-image",
				title: "Xử lý phần tường này",
				contexts: ["all"],
			});
		});

		browser.contextMenus.onClicked.addListener(async (info, tab) => {
			if (info.menuItemId !== "translate-image") return;
			if (!tab?.id || !info.srcUrl) return;

			const settings = await getExtensionSettings();
			const tabUrl = tab.url || "";
			const isAllowed =
				settings.enabled &&
				settings.enabledDomains.length > 0 &&
				isUrlAllowed(tabUrl, settings.enabledDomains);
			if (!isAllowed) return;

			browser.tabs
				.sendMessage(tab.id, {
					from: "background",
					to: "content",
					type: "background/translate",
					url: info.srcUrl,
				})
				.catch(() => {});
		});

		browser.action.onClicked.addListener((tab) => {
			console.log("Extension icon clicked", tab);
		});

		browser.runtime.onMessage.addListener(
			(msg: AppMessage, sender, sendResponse) => {
				switch (msg.type) {
					case "ocr/process": {
						const job = createOcrJob(
							msg,
							sender.tab?.id ?? -1,
							sender.tab?.url ?? "",
						);
						ocrBatchQueue.push({
							msg,
							sendResponse,
							jobId: job.id,
							responded: false,
						});
						scheduleBatchFlush();
						return true;
					}
					case "ocr/job-started": {
						updateOcrJobMetadata(msg.jobId, {
							type: msg.targetType,
							target: msg.target,
							tabId: msg.tabId,
							tabUrl: msg.tabUrl,
						});
						sendResponse({ ok: true });
						return true;
					}
					case "ocr/job-completed": {
						settleOcrJob(msg.jobId, "done");
						sendResponse({ ok: true });
						return true;
					}
					case "ocr/job-failed": {
						settleOcrJob(msg.jobId, "error", msg.error);
						sendResponse({ ok: true });
						return true;
					}
					case "ocr/get-queue": {
						pruneOcrJobs();
						sendResponse({
							jobs: Array.from(ocrJobRegistry.values()),
						} satisfies GetOcrQueueResponse);
						return true;
					}
					case "settings/get":
						getExtensionSettings().then((settings) => {
							sendResponse(settings);
						});
						return true;
					case "settings/notify-changed":
						browser.tabs.query({}, (tabs) => {
							for (const tab of tabs) {
								if (tab.id) {
									browser.tabs
										.sendMessage(tab.id, {
											from: "background",
											to: "all",
											type: "settings/changed",
											settings: msg.settings,
										})
										.catch(() => {});
								}
							}
						});
						sendResponse({ ok: true });
						return true;
					case "extension/error":
						browser.tabs.query({}, (tabs) => {
							for (const tab of tabs) {
								if (tab.id) {
									browser.tabs
										.sendMessage(tab.id, {
											from: "background",
											to: "all",
											type: "extension/error",
											error: msg.error,
										})
										.catch(() => {});
								}
							}
						});
						browser.runtime.sendMessage({
							from: "background",
							to: "all",
							type: "extension/error",
							error: msg.error,
						});
						sendResponse({ ok: true });
						return true;
					case "translate/text": {
						console.log("[Background] translate/text received", {
							text: msg.text,
							srcLang: msg.srcLang,
							targetLang: msg.targetLang,
						});
						forwardTranslateText(msg, sendResponse);
						return true;
					}
					case "translate/regions": {
						console.log("[Background] translate/regions received", {
							regionCount: msg.regions.length,
						});
						forwardTranslateRegions(msg, sendResponse);
						return true;
					}
				}
			},
		);
	},
});

interface OcrBatchItem {
	msg: ProcessOcrMessage;
	sendResponse: (response: ProcessOcrResponse) => void;
	jobId: string;
	responded: boolean;
}

/** Sends the OCR response exactly once per queued item. */
function respondToItem(item: OcrBatchItem, response: ProcessOcrResponse) {
	if (item.responded) return;
	item.responded = true;
	item.sendResponse(response);
}

const ocrBatchQueue: OcrBatchItem[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let activeBatchCount = 0;

/**
 * Shared OCR result cache. Lives in the background service worker so every
 * tab reuses the same instance — the same image opened in two tabs only runs
 * the PaddleOCR engine once.
 */
const ocrCache = new OcrCache();

/** Cross-tab registry of OCR jobs, used by the popup's processing queue. */
const ocrJobRegistry = new Map<string, OcrJob>();
const OCR_JOB_TTL_MS = 10 * 60 * 1000;
const OCR_JOB_MAX_ENTRIES = 500;

function pruneOcrJobs() {
	const now = Date.now();
	for (const [id, job] of ocrJobRegistry) {
		if (now - job.createdAt > OCR_JOB_TTL_MS) {
			ocrJobRegistry.delete(id);
		}
	}
	while (ocrJobRegistry.size > OCR_JOB_MAX_ENTRIES) {
		const oldest = ocrJobRegistry.keys().next();
		if (oldest.done) break;
		ocrJobRegistry.delete(oldest.value);
	}
}

function createOcrJob(
	msg: ProcessOcrMessage,
	tabId: number,
	tabUrl: string,
): OcrJob {
	pruneOcrJobs();
	const job: OcrJob = {
		id: crypto.randomUUID(),
		tabId,
		tabUrl,
		type: msg.targetType ?? "image",
		target: msg.target ?? "",
		status: "queued",
		createdAt: Date.now(),
	};
	ocrJobRegistry.set(job.id, job);
	return job;
}

function updateOcrJobMetadata(
	jobId: string,
	metadata: {
		type?: "image" | "canvas";
		target?: string;
		tabId?: number;
		tabUrl?: string;
	},
) {
	const job = ocrJobRegistry.get(jobId);
	if (!job) return;
	if (metadata.type !== undefined) job.type = metadata.type;
	if (metadata.target !== undefined) job.target = metadata.target;
	if (metadata.tabId !== undefined) job.tabId = metadata.tabId;
	if (metadata.tabUrl !== undefined) job.tabUrl = metadata.tabUrl;
	if (job.status === "queued") job.status = "processing";
}

function markJobProcessing(jobId: string) {
	const job = ocrJobRegistry.get(jobId);
	if (!job) return;
	if (job.status === "queued") job.status = "processing";
}

function settleOcrJob(
	jobId: string | undefined,
	status: OcrJobStatus,
	error?: string,
) {
	if (!jobId) return;
	const job = ocrJobRegistry.get(jobId);
	if (!job) return;
	if (job.status === "done" || job.status === "error") return;
	job.status = status;
	job.finishedAt = Date.now();
	if (error) job.error = error;
}

function scheduleBatchFlush() {
	if (batchTimer !== null) return;
	batchTimer = setTimeout(() => {
		batchTimer = null;
		flushOcrBatch();
	}, OCR_BATCH_DEBOUNCE_MS);
}

async function ensureOffscreenRunning() {
	const contexts = await browser.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
	});

	if (contexts.length === 0) {
		await browser.offscreen.createDocument({
			url: "offscreen.html",
			reasons: ["WORKERS"],
			justification:
				"Maintains persistent memory cache for the PaddleOCR engine.",
		});
	}
}

async function flushOcrBatch() {
	if (ocrBatchQueue.length === 0 || activeBatchCount > 0) return;

	const batch = ocrBatchQueue.splice(
		0,
		Math.min(ocrBatchQueue.length, OCR_BATCH_SIZE),
	);
	activeBatchCount++;

	try {
		// Resolve a cache key for every item first — identical images coming
		// from different tabs are served from the cache without touching the
		// offscreen document.
		const prepared = await Promise.all(
			batch.map(async (item) => {
				const key = await hashImageData(
					item.msg.imageData,
					item.msg.fetchingType,
				);
				return { item, key, cached: ocrCache.get(key) };
			}),
		);

		for (const entry of prepared) {
			markJobProcessing(entry.item.jobId);
		}

		const cacheMisses = prepared.filter((entry) => entry.cached === undefined);
		for (const entry of prepared) {
			if (!entry.cached) continue;
			respondToItem(entry.item, {
				success: true,
				ocrData: entry.cached,
				jobId: entry.item.jobId,
			});
		}

		if (cacheMisses.length === 0) return;

		const resolvedItems = await Promise.all(
			cacheMisses.map(async (entry) => {
				const item = entry.item;
				if (item.msg.fetchingType === "url" && item.msg.headers) {
					const base64 = await fetchImageAsBase64(
						item.msg.imageData,
						item.msg.headers,
					);
					return { fetchingType: "base64" as const, imageData: base64 };
				}
				return {
					fetchingType: item.msg.fetchingType,
					imageData: item.msg.imageData,
				};
			}),
		);

		const response = await new Promise<{
			success: boolean;
			results?: { success: boolean; data?: OCRRegion[]; error?: string }[];
			error?: string;
		}>((resolve) => {
			browser.runtime.sendMessage(
				{
					from: "background",
					to: "offscreen",
					type: "offscreen/batch-run-ocr",
					items: resolvedItems,
				},
				(msgResponse) => {
					if (browser.runtime.lastError) {
						resolve({
							success: false,
							error: browser.runtime.lastError.message,
						});
						return;
					}
					resolve(
						msgResponse as {
							success: boolean;
							results?: { success: boolean; data?: OCRRegion[]; error?: string }[];
							error?: string;
						},
					);
				},
			);
		});

		if (response?.success && Array.isArray(response.results)) {
			const results = response.results;
			cacheMisses.forEach((entry, index) => {
				const result = results[index];
				if (result?.success) {
					const ocrData = result.data ?? [];
					ocrCache.set(entry.key, ocrData);
					respondToItem(entry.item, {
						success: true,
						ocrData,
						jobId: entry.item.jobId,
					});
				} else {
					const error = result?.error || "Unknown batch item error";
					settleOcrJob(entry.item.jobId, "error", error);
					respondToItem(entry.item, {
						success: false,
						error,
						jobId: entry.item.jobId,
					});
				}
			});
		} else {
			const error = response?.error || "Batch processing failed";
			cacheMisses.forEach((entry) => {
				settleOcrJob(entry.item.jobId, "error", error);
				respondToItem(entry.item, {
					success: false,
					error,
					jobId: entry.item.jobId,
				});
			});
		}
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : "Batch processing failed";
		batch.forEach((item) => {
			if (item.responded) return;
			settleOcrJob(item.jobId, "error", errorMsg);
			respondToItem(item, {
				success: false,
				error: errorMsg,
				jobId: item.jobId,
			});
		});
	} finally {
		activeBatchCount--;
		scheduleBatchFlush();
	}
}

async function forwardTranslateText(
	msg: TranslateTextMessage,
	sendResponse: (response: TranslateTextResponse) => void,
): Promise<void> {
	try {
		console.log("[Background] forwarding translate-text to offscreen");
		const offscreenMsg: OffscreenTranslateTextMessage = {
			from: "background",
			to: "offscreen",
			type: "offscreen/translate-text",
			text: msg.text,
			srcLang: msg.srcLang,
			targetLang: msg.targetLang,
		};
		const response = await new Promise<OffscreenTranslateTextResponse>(
			(resolve) => {
				browser.runtime.sendMessage(offscreenMsg, (resp) => {
					if (browser.runtime.lastError) {
						resolve({
							success: false,
							error: browser.runtime.lastError.message,
						});
						return;
					}
					resolve(resp as OffscreenTranslateTextResponse);
				});
			},
		);
		console.log("[Background] translate-text response", {
			success: response.success,
			translatedText: response.translatedText,
		});
		sendResponse({
			success: response.success,
			translatedText: response.translatedText,
			error: response.error,
		});
	} catch (error) {
		console.error("[Background] translate-text failed", error);
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}

async function forwardTranslateRegions(
	msg: TranslateRegionsMessage,
	sendResponse: (response: TranslateRegionsResponse) => void,
): Promise<void> {
	try {
		const settings = await getExtensionSettings();
		console.log("[Background] forwarding translate-regions to offscreen", {
			regionCount: msg.regions.length,
			targetLang: settings.targetLang,
		});
		const offscreenMsg: OffscreenTranslateRegionsMessage = {
			from: "background",
			to: "offscreen",
			type: "offscreen/translate-regions",
			regions: msg.regions,
			targetLang: settings.targetLang,
		};
		const response = await new Promise<OffscreenTranslateRegionsResponse>(
			(resolve) => {
				browser.runtime.sendMessage(offscreenMsg, (resp) => {
					if (browser.runtime.lastError) {
						resolve({
							success: false,
							error: browser.runtime.lastError.message,
						});
						return;
					}
					resolve(resp as OffscreenTranslateRegionsResponse);
				});
			},
		);
		console.log("[Background] translate-regions response", {
			success: response.success,
			regionCount: response.regions?.length,
		});
		sendResponse({
			success: response.success,
			regions: response.regions,
			errors: response.errors,
			error: response.error,
		});
	} catch (error) {
		console.error("[Background] translate-regions failed", error);
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}

function arrayBufferToBase64Legacy(buffer: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const len = bytes.byteLength;

	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

async function fetchImageAsBase64(
	url: string,
	headers?: Record<string, string>,
): Promise<string> {
	const headersInit = headers ? new Headers() : undefined;
	if (headers) {
		for (const [key, value] of Object.entries(headers)) {
			headersInit?.append(key, value);
		}
	}
	const response = await fetch(url, { headers: headersInit });
	const arrayBuffer = await response.arrayBuffer();
	return arrayBufferToBase64Legacy(arrayBuffer);
}
