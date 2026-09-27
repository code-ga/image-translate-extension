import type { AppMessage } from "@/types";
import { installAssetFetchCache } from "@/utils/asset-cache";
import { runBatchOcr } from "@/utils/ocr-batcher";
import { translate, translateText, warmup, type TranslationUnit, type NllbLanguageCode } from "@/utils/translation";

installAssetFetchCache();

(async () => {
	await warmup();
})();

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
							error: String(error),
						});
					}
				})();
				return true;
			}
			case "offscreen/translate-text": {
				if (message.to !== "offscreen" || message.from !== "background") break;
				(async () => {
					try {
						const result = await translateText(message.text, message.srcLang, message.targetLang as NllbLanguageCode);
						sendResponse({ success: true, translatedText: result.translatedText, detectedLang: result.detectedLang });
					} catch (error) {
						console.error("Translate text error:", error);
						sendResponse({ success: false, error: String(error) });
					}
				})();
				return true;
			}
			case "offscreen/translate-regions": {
				if (message.to !== "offscreen" || message.from !== "background") break;
				(async () => {
					try {
						const units: TranslationUnit[] = message.regions.flatMap((region, regionIndex) =>
							region.boxes.map((box, boxIndex) => ({
								id: `region_${regionIndex}_box_${boxIndex}`,
								sourceText: box.text,
								bbox: box.box,
								boxReferences: [{ regionIndex, boxIndex }],
								detectedLanguage: "unknown" as TranslationUnit["detectedLanguage"],
								detectionConfidence: 0,
							}))
						);
						const response = await translate({ units, targetLang: message.targetLang as NllbLanguageCode });
						const translatedRegions = message.regions.map((region, regionIndex) => ({
							...region,
							boxes: region.boxes.map((box, boxIndex) => {
								const result = response.results.find(
									(r) => r.unitId === `region_${regionIndex}_box_${boxIndex}`
								);
								return result ? { ...box, translation: result.translatedText } : box;
							}),
						}));
						sendResponse({
							success: true,
							regions: translatedRegions,
							errors: response.errors,
						});
					} catch (error) {
						console.error("Translate regions error:", error);
						sendResponse({ success: false, error: String(error) });
					}
				})();
				return true;
			}
		}
	},
);