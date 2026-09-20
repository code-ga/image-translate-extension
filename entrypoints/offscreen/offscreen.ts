import type { AppMessage } from "@/types";
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
							error: new String(error),
						});
					}
				})();
				return true;
			}
		}
	},
);
