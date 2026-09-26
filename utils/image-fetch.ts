function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * Resolves a remote image to a base64 payload. Runs in the offscreen document,
 * which inherits the extension's host permissions.
 */
export async function fetchImageAsBase64(
	url: string,
	headers?: Record<string, string>,
): Promise<string> {
	const headersInit = headers ? new Headers() : undefined;
	if (headers) {
		for (const [key, value] of Object.entries(headers)) {
			headersInit?.append(key, value);
		}
	}

	const response = await fetch(url, { headers: headersInit });
	const arrayBuffer = await response.arrayBuffer();
	return arrayBufferToBase64(arrayBuffer);
}
