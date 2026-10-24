import type { OCRRegion } from "@/types";

const DEFAULT_MAX_ENTRIES = 100;

export type OcrCacheFetchingType = "url" | "base64";

/**
 * In-memory LRU cache for OCR results.
 *
 * Lives in the background service worker so every tab shares the same
 * instance — the same image opened in two tabs only runs OCR once.
 * The cache is intentionally memory-only: a service worker restart clears it.
 */
export class OcrCache {
	private readonly store = new Map<string, OCRRegion[]>();
	private readonly maxEntries: number;

	constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
		this.maxEntries = Math.max(1, maxEntries);
	}

	get(key: string): OCRRegion[] | undefined {
		const value = this.store.get(key);
		if (value === undefined) return undefined;
		// Refresh recency so the entry becomes the most recently used one.
		this.store.delete(key);
		this.store.set(key, value);
		return value;
	}

	set(key: string, value: OCRRegion[]): void {
		if (this.store.has(key)) {
			this.store.delete(key);
		}
		this.store.set(key, value);
		while (this.store.size > this.maxEntries) {
			const oldest = this.store.keys().next();
			if (oldest.done) break;
			this.store.delete(oldest.value);
		}
	}

	has(key: string): boolean {
		return this.store.has(key);
	}

	delete(key: string): boolean {
		return this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}

	size(): number {
		return this.store.size;
	}
}

function base64PayloadToBytes(payload: string): Uint8Array<ArrayBuffer> | null {
	try {
		const binary = atob(payload);
		const buffer = new ArrayBuffer(binary.length);
		const bytes = new Uint8Array(buffer);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		return null;
	}
}

function imageDataToBytes(imageData: string): Uint8Array<ArrayBuffer> {
	const commaIndex = imageData.indexOf(",");
	if (imageData.startsWith("data:") && commaIndex !== -1) {
		const meta = imageData.slice(5, commaIndex);
		const payload = imageData.slice(commaIndex + 1);
		if (meta.includes(";base64")) {
			const bytes = base64PayloadToBytes(payload);
			if (bytes) return bytes;
		}
	}
	const encoded = new TextEncoder().encode(imageData);
	return new Uint8Array(encoded);
}

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Builds the cache key for an OCR request.
 *
 * URL items are keyed by their URL so a repeated URL never re-fetches the
 * asset; base64/canvas items are keyed by the decoded content so identical
 * pixels share one entry regardless of the transport that produced them.
 */
export async function hashImageData(
	imageData: string,
	fetchingType: OcrCacheFetchingType = "base64",
): Promise<string> {
	if (fetchingType === "url") {
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(imageData),
		);
		return `url:${toHex(digest)}`;
	}

	const digest = await crypto.subtle.digest(
		"SHA-256",
		imageDataToBytes(imageData),
	);
	return `b64:${toHex(digest)}`;
}
