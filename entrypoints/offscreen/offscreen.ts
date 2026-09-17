import type { AppMessage, BatchRunOcrResponse } from "@/types";
import { installAssetFetchCache } from "@/utils/asset-cache";
import { type OcrBatchResult, runBatchOcr } from "@/utils/ocr-batcher";

installAssetFetchCache();

browser.runtime.onMessage.addListener(
	(message: AppMessage, _sender, sendResponse) => {
		switch (message.type) {
			case "offscreen/batch-run-ocr": {
				if (message.to !== "offscreen" || message.from !== "background") break;
				(async () => {
					let results: OcrBatchResult[];
					try {
						results = await runBatchOcr(message.items);
					} catch (error) {
						console.error("[image-translate] Offscreen OCR batch failed", {
							itemCount: message.items.length,
							error:
								error instanceof Error
									? {
											name: error.name,
											message: error.message,
											stack: error.stack,
										}
									: { value: String(error) },
							errorMessage:
								error instanceof Error ? error.message : String(error),
						});
						results = message.items.map(() => ({
							success: false,
							error: "OCR engine failed for this image",
						}));
					}

					const response: BatchRunOcrResponse = {
						success: true,
						results: results.map((result) => {
							if (result.success) {
								return {
									success: true,
									data: result.data.map((item) => ({
										...item,
										translation: undefined,
									})),
								};
							}
							return result;
						}),
					};
					sendResponse(response);
				})();
				return true;
			}
		}
	},
);
