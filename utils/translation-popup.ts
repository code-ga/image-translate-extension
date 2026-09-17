import type { AppMessage, TranslateTextResponse } from "@/types";
import { DEFAULT_TARGET_LANG, SUPPORTED_LANGUAGES } from "./languages";
import {
	POPUP_BORDER_RADIUS,
	POPUP_BOX_SHADOW,
	POPUP_COLORS,
	POPUP_FONT,
	POPUP_Z_INDEX,
	injectPopupStyles,
} from "./popup-base";

const POPUP_DEBOUNCE_MS = 300;
const POPUP_CLOSE_DELAY_MS = 1000;
const POPUP_GAP = 6;

type PopupStatus = "info" | "success" | "error";

let currentPopup: HTMLDivElement | null = null;
let currentSentenceResultEl: HTMLElement | null = null;
let currentWordResultEl: HTMLElement | null = null;
let currentWordText: string = "";
let currentSelect: HTMLSelectElement | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let cachedTargetLang: string = DEFAULT_TARGET_LANG;

export function setDefaultTargetLang(lang: string): void {
	cachedTargetLang = lang;
}

function createTranslationRow(label: string, originalText: string): { container: HTMLElement; resultEl: HTMLElement } {
	const container = document.createElement("div");
	container.style.cssText = `
		padding: 8px 12px;
	`;

	const labelEl = document.createElement("div");
	labelEl.textContent = label;
	labelEl.style.cssText = `
		font-size: 10px;
		color: #808090;
		margin-bottom: 3px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	`;

	const originalEl = document.createElement("div");
	originalEl.textContent = originalText;
	originalEl.style.cssText = `
		font-size: 11px;
		color: #a0a0b0;
		margin-bottom: 4px;
		word-break: break-all;
	`;
	originalEl.title = originalText;

	const resultEl = document.createElement("div");
	resultEl.style.cssText = `
		font-size: 12px;
		color: ${POPUP_COLORS.info.text};
		word-break: break-word;
	`;
	resultEl.textContent = "Translating...";

	container.append(labelEl, originalEl, resultEl);

	return { container, resultEl };
}

export function showTranslationPopup(
	anchor: HTMLElement,
	text: string,
	word: string,
	onReady?: (popup: HTMLDivElement) => void,
): HTMLDivElement | null {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	dismissTranslationPopup();
	cancelCloseDelay();

	debounceTimer = setTimeout(() => {
		debounceTimer = null;

		const popup = document.createElement("div");
		popup.style.cssText = `
			position: fixed;
			z-index: ${POPUP_Z_INDEX};
			background: ${POPUP_COLORS.info.bg};
			color: ${POPUP_COLORS.info.text};
			border: 1px solid ${POPUP_COLORS.info.border};
			border-radius: ${POPUP_BORDER_RADIUS};
			font-family: ${POPUP_FONT};
			font-size: 13px;
			line-height: 1.4;
			padding: 0;
			max-width: 320px;
			box-shadow: ${POPUP_BOX_SHADOW};
			pointer-events: auto;
			white-space: pre-wrap;
			overflow: hidden;
		`;

		injectPopupStyles(popup);

		const header = document.createElement("div");
		header.style.cssText = `
			padding: 8px 12px;
			font-size: 11px;
			color: #a0a0b0;
			border-bottom: 1px solid ${POPUP_COLORS.info.border};
		`;
		const headerLabel = document.createElement("span");
		headerLabel.textContent = "Original";
		const headerText = document.createElement("span");
		headerText.textContent = text;
		headerText.style.cssText = `
			display: block;
			margin-top: 2px;
			font-size: 12px;
			color: #e4e6eb;
			word-break: break-all;
		`;
		headerText.title = text;
		header.append(headerLabel, headerText);
		popup.appendChild(header);

		const langRow = document.createElement("div");
		langRow.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 8px 12px;
			border-bottom: 1px solid ${POPUP_COLORS.info.border};
		`;
		const langLabel = document.createElement("span");
		langLabel.textContent = "Translate to:";
		langLabel.style.cssText = `font-size: 11px; color: #a0a0b0;`;
		const select = document.createElement("select");
		select.style.cssText = `
			flex: 1;
			font-size: 12px;
			padding: 2px 6px;
			border-radius: 4px;
			border: 1px solid #3a3a4a;
			background: #252536;
			color: #e4e6eb;
			outline: none;
			cursor: pointer;
		`;
		for (const lang of SUPPORTED_LANGUAGES) {
			const option = document.createElement("option");
			option.value = lang.code;
			option.textContent = lang.label;
			select.appendChild(option);
		}
		select.value = cachedTargetLang;
		langRow.append(langLabel, select);
		popup.appendChild(langRow);

		const sentenceSection = createTranslationRow("Sentence", text);
		popup.appendChild(sentenceSection.container);
		const sentenceResultEl = sentenceSection.resultEl;

		let wordResultEl: HTMLElement | null = null;
		if (word && word !== text) {
			const wordSection = createTranslationRow(`Word: "${word}"`, word);
			wordSection.container.style.borderTop = `1px solid ${POPUP_COLORS.info.border}`;
			popup.appendChild(wordSection.container);
			wordResultEl = wordSection.resultEl;
		}

		positionPopup(popup, anchor);

		document.body.appendChild(popup);
		currentPopup = popup;
		currentSentenceResultEl = sentenceResultEl;
		currentWordResultEl = wordResultEl;
		currentWordText = word;
		currentSelect = select;

		select.addEventListener("change", () => {
			const targetLang = select.value;
			requestTranslateText(text, targetLang, sentenceResultEl, popup);
			if (wordResultEl) {
				requestTranslateText(word, targetLang, wordResultEl, popup);
			}
		});

		requestTranslateText(text, select.value, sentenceResultEl, popup);
		if (wordResultEl) {
			requestTranslateText(word, select.value, wordResultEl, popup);
		}

		onReady?.(popup);
	}, POPUP_DEBOUNCE_MS);

	return null;
}

function requestTranslateText(
	text: string,
	targetLang: string,
	resultEl: HTMLElement,
	popupEl: HTMLDivElement,
) {
	setResult(resultEl, "Translating...", "info");

	browser.runtime
		.sendMessage<AppMessage>({
			from: "content",
			to: "background",
			type: "translate/text",
			srcLang: "",
			targetLang,
			text,
		})
		.then((response: TranslateTextResponse) => {
			if (popupEl !== currentPopup) return;
			if (response.success) {
				setResult(resultEl, response.translatedText || "(no translation)", "success");
			} else {
				setResult(resultEl, response.error || "Translation failed", "error");
			}
		})
		.catch((err) => {
			if (popupEl !== currentPopup) return;
			setResult(
				resultEl,
				err instanceof Error ? err.message : "Translation failed",
				"error",
			);
		});
}

function setResult(el: HTMLElement, text: string, status: PopupStatus) {
	el.textContent = text;
	const color = POPUP_COLORS[status];
	el.style.background = color.bg;
	el.style.color = color.text;
}

function positionPopup(popup: HTMLElement, anchor: HTMLElement) {
	const anchorRect = anchor.getBoundingClientRect();
	const gap = POPUP_GAP;

	let top = anchorRect.bottom + gap;
	let left = anchorRect.left;

	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;

	const popupWidth = popup.offsetWidth;
	const popupHeight = popup.offsetHeight;

	if (left + popupWidth > viewportWidth - 8) {
		left = Math.max(8, viewportWidth - popupWidth - 8);
	}

	if (top + popupHeight > viewportHeight - 8) {
		top = anchorRect.top - popupHeight - gap;
	}

	top = Math.max(8, top);
	left = Math.max(8, left);

	popup.style.top = `${top}px`;
	popup.style.left = `${left}px`;
}

export function updateTranslationPopup(
	popup: HTMLDivElement | null,
	translation?: string,
	error?: string,
) {
	if (!popup || popup !== currentPopup) return;
	if (!currentSentenceResultEl) return;

	if (error) {
		setResult(currentSentenceResultEl, error, "error");
	} else if (translation) {
		setResult(currentSentenceResultEl, translation, "success");
	}
}

export function dismissTranslationPopup() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	cancelCloseDelay();
	if (currentPopup?.parentNode) {
		currentPopup.remove();
	}
	currentPopup = null;
	currentSentenceResultEl = null;
	currentWordResultEl = null;
	currentWordText = "";
	currentSelect = null;
}

export function cancelCloseDelay() {
	if (closeTimer) {
		clearTimeout(closeTimer);
		closeTimer = null;
	}
}

export function startCloseDelay(callback: () => void, ms = POPUP_CLOSE_DELAY_MS) {
	cancelCloseDelay();
	closeTimer = setTimeout(callback, ms);
}
