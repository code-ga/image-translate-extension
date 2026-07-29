export async function injectContentScript(tabId: number) {
	try {
		await browser.scripting.executeScript({
			target: { tabId },
			files: ["/content-scripts/content.js"],
		});
	} catch (_e) {
		// ignore injection failures (browser://, restricted pages, etc.)
	}
}
