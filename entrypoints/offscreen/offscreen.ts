import { installAssetFetchCache } from "@/utils/asset-cache";
import { runBatchOcr } from "@/utils/ocr-batcher";
import { translateDynamic } from "../../utils/translation";

installAssetFetchCache();

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.target === "offscreen" && message.type === "batch-run-ocr") {
		(async () => {
			try {
				const results = (await runBatchOcr(message.items)).map(result => {
					if (result.success) {
						const returnObject = structuredClone(result)
						returnObject.data = returnObject.data.map(item => {
							return {
								...item,
								// TODO: We need to update this from hardcode to dynamic
								translation: translateDynamic(item.text, "en", navigator.language)
							}
						})
						return returnObject
					}
					return result
				});
				sendResponse({ success: true, results });
			} catch (error) {
				console.error("Batch OCR error:", error);
				sendResponse({
					success: false,
					error: new String(error),
				});
			}
		})();
		return true;
	}
});
