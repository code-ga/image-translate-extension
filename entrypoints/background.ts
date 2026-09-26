declare const self: ServiceWorkerGlobalScope;

import {
	CONTENT_PORT_NAME,
	type ExtensionPort,
	type JobPayload,
	type JobResponse,
	OFFSCREEN_PORT_NAME,
	type PortControlMessage,
	type QueueRequest,
	type QueueResult,
} from "@/src/queue/types";
import type { AppMessage } from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { getExtensionSettings } from "@/utils/extension-settings";

const OFFSCREEN_READY_TIMEOUT_MS = 2000;
const OFFSCREEN_CONNECT_ATTEMPTS = 5;
const OFFSCREEN_RECONNECT_DELAY_MS = 150;

export default defineBackground({
	type: "module",
	main() {
		browser.runtime.onStartup.addListener(() => {
			ensureOffscreenRunning().catch((error) => {
				console.error("Failed to start the offscreen document", error);
			});
		});

		browser.runtime.onInstalled.addListener(() => {
			console.log("browser extension installed");
			ensureOffscreenRunning().catch((error) => {
				console.error("Failed to start the offscreen document", error);
			});
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

		// Long-lived port traffic (OCR + translation) replaces the async
		// sendMessage handshake that used to break when the worker was evicted.
		browser.runtime.onConnect.addListener((port) => {
			if (port.name !== CONTENT_PORT_NAME) return;
			handleContentPort(port);
		});

		// Lightweight, non-queued traffic keeps using one-shot messages.
		browser.runtime.onMessage.addListener(
			(msg: AppMessage, _sender, sendResponse) => {
				switch (msg.type) {
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
						browser.runtime
							.sendMessage({
								from: "background",
								to: "all",
								type: "extension/error",
								error: msg.error,
							})
							.catch(() => {});
						sendResponse({ ok: true });
						return true;
				}
			},
		);
	},
});

/** jobId -> content port that is waiting for the result. */
const jobRoutes = new Map<string, ExtensionPort>();

let offscreenPort: ExtensionPort | null = null;
let offscreenConnecting: Promise<ExtensionPort> | null = null;
let routeCounter = 0;

function handleContentPort(port: ExtensionPort): void {
	port.onMessage.addListener((message: QueueRequest) => {
		if (message?.type !== "queue/enqueue") return;

		routeCounter += 1;
		const jobId = message.jobId || `job_${routeCounter}_${Date.now()}`;
		jobRoutes.set(jobId, port);
		void forwardToOffscreen(port, jobId, message.payload);
	});

	port.onDisconnect.addListener(() => {
		for (const [jobId, target] of jobRoutes) {
			if (target === port) jobRoutes.delete(jobId);
		}
	});
}

async function forwardToOffscreen(
	contentPort: ExtensionPort,
	jobId: string,
	payload: JobPayload,
): Promise<void> {
	try {
		const target = await getOffscreenPort();
		target.postMessage({ type: "queue/enqueue", jobId, payload });
	} catch (error) {
		jobRoutes.delete(jobId);
		postToContent(contentPort, jobId, {
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to reach the queue",
		});
	}
}

function postToContent(
	port: ExtensionPort,
	jobId: string,
	response: JobResponse,
): void {
	try {
		port.postMessage({ type: "queue/result", jobId, response });
	} catch {
		// The requesting tab is gone; nothing to deliver the result to.
	}
}

function getOffscreenPort(): Promise<ExtensionPort> {
	if (offscreenPort) return Promise.resolve(offscreenPort);
	if (offscreenConnecting) return offscreenConnecting;

	offscreenConnecting = connectOffscreen().finally(() => {
		offscreenConnecting = null;
	});
	return offscreenConnecting;
}

async function connectOffscreen(): Promise<ExtensionPort> {
	await ensureOffscreenRunning();

	let lastError: Error | null = null;
	for (let attempt = 0; attempt < OFFSCREEN_CONNECT_ATTEMPTS; attempt++) {
		let port: ExtensionPort;
		try {
			port = browser.runtime.connect({ name: OFFSCREEN_PORT_NAME });
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			await delay(OFFSCREEN_RECONNECT_DELAY_MS);
			continue;
		}

		if (await waitForOffscreenReady(port)) {
			attachOffscreenPort(port);
			offscreenPort = port;
			return port;
		}

		try {
			port.disconnect();
		} catch {
			// already gone
		}
		lastError = new Error("The offscreen document did not become ready");
		await delay(OFFSCREEN_RECONNECT_DELAY_MS);
	}

	throw lastError ?? new Error("Could not connect to the offscreen document");
}

function waitForOffscreenReady(port: ExtensionPort): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;

		const finish = (ready: boolean) => {
			if (settled) return;
			settled = true;
			clearInterval(pingTimer);
			clearTimeout(timer);
			port.onMessage.removeListener(onMessage);
			port.onDisconnect.removeListener(onDisconnect);
			resolve(ready);
		};

		const onMessage = (message: PortControlMessage) => {
			if (message?.type === "queue/ready") finish(true);
		};

		const onDisconnect = () => finish(false);

		const ping = () => {
			try {
				port.postMessage({ type: "queue/ping" });
			} catch {
				finish(false);
			}
		};

		const pingTimer = setInterval(ping, 300);
		const timer = setTimeout(() => finish(false), OFFSCREEN_READY_TIMEOUT_MS);

		port.onMessage.addListener(onMessage);
		port.onDisconnect.addListener(onDisconnect);
		ping();
	});
}

function attachOffscreenPort(port: ExtensionPort): void {
	port.onMessage.addListener((message: QueueResult) => {
		if (message?.type !== "queue/result") return;
		const target = jobRoutes.get(message.jobId);
		if (!target) return;
		jobRoutes.delete(message.jobId);
		postToContent(target, message.jobId, message.response);
	});

	port.onDisconnect.addListener(() => {
		if (offscreenPort !== port) return;
		offscreenPort = null;
		failPendingRoutes("The offscreen document closed before the job finished");
	});
}

function failPendingRoutes(reason: string): void {
	for (const [jobId, target] of jobRoutes) {
		postToContent(target, jobId, { success: false, error: reason });
	}
	jobRoutes.clear();
}

let offscreenStartPromise: Promise<void> | null = null;

function ensureOffscreenRunning(): Promise<void> {
	if (offscreenStartPromise) return offscreenStartPromise;
	offscreenStartPromise = ensureOffscreenDocument().finally(() => {
		offscreenStartPromise = null;
	});
	return offscreenStartPromise;
}

async function ensureOffscreenDocument() {
	const contexts = await browser.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
	});

	if (contexts.length === 0) {
		await browser.offscreen.createDocument({
			url: "offscreen.html",
			reasons: ["WORKERS"],
			justification:
				"Hosts the priority queue, the PaddleOCR engine and the translation worker used by the extension.",
		});
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
