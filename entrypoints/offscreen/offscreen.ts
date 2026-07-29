import { installAssetFetchCache } from "@/utils/asset-cache";
import { runBatchOcr } from "@/utils/ocr-batcher";

installAssetFetchCache();

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.target === "offscreen" && message.type === "batch-run-ocr") {
		(async () => {
			try {
				const results = await runBatchOcr(message.items);
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
