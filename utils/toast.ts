const TOAST_CONTAINER_ID = "ocr-toast-container";
const TOAST_CLASSES = {
	error: "ocr-toast-error",
	warning: "ocr-toast-warning",
	info: "ocr-toast-info",
};

const DEDUP_WINDOW_MS = 10000;
const DEFAULT_DURATION_MS = 4000;

const shownErrors: Record<string, number> = {};

function getOrCreateToastContainer(): HTMLElement {
	let container = document.getElementById(TOAST_CONTAINER_ID);
	if (!container) {
		container = document.createElement("div");
		container.id = TOAST_CONTAINER_ID;
		container.style.cssText =
			"position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:360px;";
		document.body.appendChild(container);
	}
	return container;
}

function dedupKey(message: string, type: string): string {
	return `${type}:${message}`;
}

export function showToast(
	message: string,
	type: "error" | "warning" | "info" = "error",
	duration: number = DEFAULT_DURATION_MS,
) {
	const key = dedupKey(message, type);
	const now = Date.now();
	if (shownErrors[key] && now - shownErrors[key] < DEDUP_WINDOW_MS) {
		return;
	}
	shownErrors[key] = now;

	const container = getOrCreateToastContainer();

	const toast = document.createElement("div");
	toast.className = TOAST_CLASSES[type] || TOAST_CLASSES.error;
	toast.textContent = message;

	const colors: Record<string, { bg: string; border: string; color: string }> = {
		error: { bg: "#2a1f1f", border: "#3a2a2a", color: "#ff6b6b" },
		warning: { bg: "#2a2418", border: "#3a3525", color: "#ffaa33" },
		info: { bg: "#1a2433", border: "#253040", color: "#6bb5ff" },
	};
	const c = colors[type] || colors.error;

	toast.style.cssText = `
		background:${c.bg};
		color:${c.color};
		border:1px solid ${c.border};
		padding:10px 14px;
		border-radius:6px;
		font-size:13px;
		font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
		pointer-events:auto;
		box-shadow:0 4px 12px rgba(0,0,0,0.4);
		animation:ocr-toast-in 0.2s ease-out;
		line-height:1.4;
	`;

	const style = document.createElement("style");
	style.textContent = `
		@keyframes ocr-toast-in {
			from { opacity:0; transform:translateX(20px); }
			to { opacity:1; transform:translateX(0); }
		}
	`;
	toast.appendChild(style);

	container.appendChild(toast);

	setTimeout(() => {
		if (toast.parentNode) {
			toast.remove();
		}
	}, duration);
}

export function removeToast(element: HTMLElement) {
	if (element.parentNode) {
		element.remove();
	}
}
