export function startLiveObserver(
	onImage: (img: HTMLImageElement) => void,
	onCanvas: (canvas: HTMLCanvasElement) => void,
) {
	const observer = new MutationObserver((records) => {
		for (let i = 0; i < records.length; i++) {
			const record = records[i];
			for (let j = 0; j < record.addedNodes.length; j++) {
				handleAddedNodes(record.addedNodes[j], onImage, onCanvas);
			}
		}
	});
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
	return observer;
}

export function stopLiveObserver(observer: MutationObserver | null) {
	if (observer) {
		observer.disconnect();
	}
}

function handleAddedNodes(
	node: Node,
	onImage: (img: HTMLImageElement) => void,
	onCanvas: (canvas: HTMLCanvasElement) => void,
) {
	if (node instanceof HTMLImageElement) {
		const width = node.naturalWidth || node.width || 0;
		const height = node.naturalHeight || node.height || 0;
		if (width >= 30 && height >= 30) {
			const style = getComputedStyle(node);
			if (
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				style.opacity !== "0"
			) {
				onImage(node);
			}
		}
	} else if (node instanceof HTMLCanvasElement) {
		const width = node.width || 0;
		const height = node.height || 0;
		if (width >= 30 && height >= 30) {
			onCanvas(node);
		}
	} else if (node instanceof Element) {
		for (const img of Array.from(node.querySelectorAll("img"))) {
			const width = img.naturalWidth || img.width || 0;
			const height = img.naturalHeight || img.height || 0;
			if (width >= 30 && height >= 30) {
				const style = getComputedStyle(img);
				if (
					style.display !== "none" &&
					style.visibility !== "hidden" &&
					style.opacity !== "0"
				) {
					onImage(img);
				}
			}
		}
		for (const canvas of Array.from(node.querySelectorAll("canvas"))) {
			const cWidth = canvas.width || 0;
			const cHeight = canvas.height || 0;
			if (cWidth >= 30 && cHeight >= 30) {
				onCanvas(canvas);
			}
		}
	}
}

export function startUrlPolling(callback: () => void, intervalMs = 500) {
	let lastHref = window.location.href;
	let pollIntervalId: number | null = null;

	function poll() {
		if (pollIntervalId !== null) return;
		pollIntervalId = window.setInterval(() => {
			try {
				const current = window.location.href;
				if (current !== lastHref) {
					lastHref = current;
					setTimeout(callback, 50);
				}
			} catch (_e) {
				// ignore
			}
		}, intervalMs);
	}

	function stop() {
		if (pollIntervalId !== null) {
			clearInterval(pollIntervalId);
			pollIntervalId = null;
		}
	}

	return { start: poll, stop };
}
