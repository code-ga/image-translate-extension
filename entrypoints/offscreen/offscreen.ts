import {
	applyTranslationsToRegions,
	translateRegions,
	translationEngine,
} from "@/src/translation/engine";
import type {
	NllbLanguageCode,
	TranslationResponse,
	TranslationUnit,
} from "@/src/translation/types";
import type {
	AppMessage,
	OCRRegion,
	OffscreenTranslateRegionsMessage,
	OffscreenTranslateTextMessage,
	TranslateRegionsResponse,
	TranslateTextResponse,
} from "@/types";
import { installAssetFetchCache } from "@/utils/asset-cache";
import { runBatchOcr } from "@/utils/ocr-batcher";

installAssetFetchCache();

browser.runtime.onMessage.addListener(
	(message: AppMessage, _sender, sendResponse) => {
		switch (message.type) {
			case "offscreen/batch-run-ocr": {
				if (message.to !== "offscreen" || message.from !== "background") break;
				(async () => {
					try {
						const results = await runBatchOcr(message.items);
						const processedResults = results.map((result) => {
							if (result.success) {
								const returnObject = structuredClone(result);
								returnObject.data = returnObject.data.map((item) => {
									return {
										...item,
										translation: undefined,
									};
								});
								return returnObject;
							}
							return result;
						});
						sendResponse({ success: true, results: processedResults });
					} catch (error) {
						console.error("Batch OCR error:", error);
						sendResponse({
							success: false,
							error:
								error instanceof Error ? error.message : "Batch OCR failed",
						});
					}
				})();
				return true;
			}
			case "offscreen/translate-text": {
				if (message.to !== "offscreen" || message.from !== "background") break;
				void handleOffscreenTranslateText(message, sendResponse);
				return true;
			}
			case "offscreen/translate-regions": {
				if (message.to !== "offscreen" || message.from !== "background") break;
				void handleOffscreenTranslateRegions(message, sendResponse);
				return true;
			}
		}
	},
);

async function handleOffscreenTranslateText(
	message: OffscreenTranslateTextMessage,
	sendResponse: (response: TranslateTextResponse) => void,
): Promise<void> {
	try {
		const units: TranslationUnit[] = [
			{
				id: `text_${Date.now()}`,
				sourceText: message.text,
				bbox: { x: 0, y: 0, width: 0, height: 0 },
				boxReferences: [],
				boxIndexes: [],
				detectedLanguage: (message.srcLang ||
					"unknown") as TranslationUnit["detectedLanguage"],
				detectionConfidence: message.srcLang ? 1 : 0,
			},
		];
		const response = await translationEngine.translate({
			units,
			targetLang: message.targetLang as NllbLanguageCode,
		});
		const result = response.results[0];
		if (!result) {
			sendResponse({
				success: false,
				error: response.errors[0]?.message || "No translation result",
			});
			return;
		}
		sendResponse({ success: true, translatedText: result.translatedText });
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}

async function handleOffscreenTranslateRegions(
	message: OffscreenTranslateRegionsMessage,
	sendResponse: (response: TranslateRegionsResponse) => void,
): Promise<void> {
	try {
		const response: TranslationResponse = await translateRegions(
			message.regions,
		);
		const regions: OCRRegion[] = applyTranslationsToRegions(
			message.regions,
			response,
		);
		sendResponse({ success: true, regions, errors: response.errors });
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}
