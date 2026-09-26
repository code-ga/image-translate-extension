import { translateTextsWithGoogle } from "./providers/google-translate";
import type {
	ModelProgress,
	ModelStatus,
	NllbLanguageCode,
	TranslationError,
	TranslationProvider,
} from "./types";
import {
	IDLE_UNLOAD_TIMEOUT_MS,
	MODEL_VERSION,
	TARGET_LANGUAGE,
} from "./types";

const MODEL_ID = "Xenova/nllb-200-distilled-600M";

type ProgressHandler = (progress: ModelProgress) => void;
type Translator = {
	(
		texts: string | string[],
		options?: Record<string, unknown>,
	): Promise<Array<{ translation_text: string }>>;
	dispose(): Promise<void>;
};

let translator: Translator | null = null;
let loadPromise: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let status: ModelStatus = "UNAVAILABLE";
let progressHandler: ProgressHandler | undefined;

function notify(progress: ModelProgress): void {
	progressHandler?.(progress);
}

function progressFromTransformers(info: {
	status: string;
	name?: string;
	file?: string;
	progress?: number;
}): ModelProgress {
	if (info.status === "ready")
		return { status: "READY", message: "Translation model ready" };
	if (info.status === "progress" || info.status === "progress_total") {
		return {
			status: "DOWNLOADING",
			message: info.file ?? info.name,
			progress: info.progress,
			file: info.file ?? info.name,
		};
	}
	if (
		info.status === "initiate" ||
		info.status === "download" ||
		info.status === "done"
	) {
		return {
			status: "DOWNLOADING",
			message: info.file ?? info.name,
			file: info.file ?? info.name,
		};
	}
	return { status: "LOADING", message: info.name };
}

function resetIdleTimer(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		void unloadModel();
	}, IDLE_UNLOAD_TIMEOUT_MS);
}

async function createTranslator(
	onProgress?: ProgressHandler,
): Promise<Translator> {
	const { env, pipeline, LogLevel } = await import("@huggingface/transformers");
	env.useBrowserCache = true;
	env.allowLocalModels = false;
	env.allowRemoteModels = true;
	env.logLevel = LogLevel.NONE;

	const callback = (info: {
		status: string;
		name?: string;
		file?: string;
		progress?: number;
	}) => {
		onProgress?.(progressFromTransformers(info));
	};
	const webGpuError: unknown[] = [];
	try {
		notify({
			status: "LOADING",
			message: "Loading translation model on WebGPU",
		});
		return (await pipeline("translation", MODEL_ID, {
			device: "webgpu",
			progress_callback: callback,
		})) as Translator;
	} catch (error) {
		webGpuError.push(error);
	}

	notify({
		status: "LOADING",
		message: "WebGPU unavailable, loading translation model on WASM",
	});
	try {
		return (await pipeline("translation", MODEL_ID, {
			device: "wasm",
			progress_callback: callback,
		})) as Translator;
	} catch (error) {
		const detail =
			error instanceof Error ? error.message : "Unknown model loading error";
		const webGpuDetail =
			webGpuError[0] instanceof Error
				? webGpuError[0].message
				: "WebGPU unavailable";
		throw new Error(
			`Translation model failed to load: ${webGpuDetail}; ${detail}`,
		);
	}
}

/**
 * In `api` mode no model is ever downloaded or resident: translations go to the
 * hosted endpoint, which keeps the ~2.4 GB NLLB weights off the GPU entirely.
 */
export async function loadModel(
	onProgress?: ProgressHandler,
	provider: TranslationProvider = "local",
): Promise<void> {
	if (provider === "api") {
		status = "READY";
		notify({ status: "READY", message: "Using the hosted translate API" });
		return;
	}

	if (translator) {
		status = "READY";
		return;
	}
	if (loadPromise) return loadPromise;

	status = "DOWNLOADING";
	progressHandler = onProgress ?? undefined;
	notify({ status: "DOWNLOADING", message: `Loading ${MODEL_VERSION}` });
	loadPromise = createTranslator(progressHandler)
		.then((loaded) => {
			translator = loaded;
			status = "READY";
			notify({ status: "READY", message: "Translation model ready" });
			resetIdleTimer();
		})
		.catch((error) => {
			status = "ERROR";
			translator = null;
			throw error;
		})
		.finally(() => {
			loadPromise = null;
		});
	return loadPromise;
}

export async function translateTexts(
	texts: string[],
	srcLang: NllbLanguageCode,
	onProgress?: ProgressHandler,
	provider: TranslationProvider = "local",
	targetLang: NllbLanguageCode = TARGET_LANGUAGE,
): Promise<string[]> {
	if (provider === "api") {
		status = "INFERENCE";
		notify({ status: "INFERENCE", message: "Translating via API" });
		try {
			const output = await translateTextsWithGoogle(texts, targetLang);
			status = "READY";
			return output;
		} catch (error) {
			status = "ERROR";
			throw error;
		}
	}

	if (!translator || status !== "READY") await loadModel(onProgress, "local");
	if (!translator) throw new Error("Translation model is not loaded");

	status = "INFERENCE";
	notify({ status: "INFERENCE", message: "Translating text" });
	try {
		const output = await translator(texts, {
			src_lang: srcLang,
			tgt_lang: TARGET_LANGUAGE,
		});
		status = "READY";
		resetIdleTimer();
		return output.map((item) => item.translation_text);
	} catch (error) {
		status = "ERROR";
		throw error;
	}
}

export async function unloadModel(): Promise<void> {
	if (idleTimer) {
		clearTimeout(idleTimer);
		idleTimer = null;
	}
	const current = translator;
	translator = null;
	status = "UNAVAILABLE";
	if (current) await current.dispose();
	notify({ status: "UNAVAILABLE", message: "Translation model unloaded" });
}

export function getModelStatus(): ModelStatus {
	return status;
}

export function setModelProgressHandler(
	handler: ProgressHandler | undefined,
): void {
	progressHandler = handler;
}

export function getModelVersion(): string {
	return MODEL_VERSION;
}

export function getModelError(unitId?: string): TranslationError {
	return {
		code: "MODEL_LOAD_FAILED",
		message: "Translation model failed to load",
		unitId,
		recoverable: true,
	};
}
