import { updateElementOverlayPosition } from "./overlay";

export function createElementState<T extends Element>() {
	const processed = new Map<T, string>();
	const translated = new Map<T, string>();
	const overlayMap = new Map<T, HTMLElement>();
	const mutationMap = new Map<T, MutationObserver>();
	const processingSet = new Set<T>();
	const errorMap = new Map<T, string>();

	const resizeObserver = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const element = entry.target as T;
			const overlay = overlayMap.get(element);
			if (overlay) {
				updateElementOverlayPosition(element, overlay);
			}
		}
	});

	let positionUpdateScheduled = false;

	function schedulePositionUpdate() {
		if (positionUpdateScheduled) return;
		positionUpdateScheduled = true;
		requestAnimationFrame(() => {
			positionUpdateScheduled = false;
			const toRemove: T[] = [];
			for (const [element, overlay] of overlayMap.entries()) {
				if (!document.contains(element)) {
					toRemove.push(element);
				} else {
					updateElementOverlayPosition(element, overlay);
				}
			}
			toRemove.forEach((element) => {
				resetElementState(element);
			});
		});
	}

	function resetElementState(element: T) {
		const overlay = overlayMap.get(element);
		if (overlay) overlay.remove();
		overlayMap.delete(element);
		processed.delete(element);
		translated.delete(element);
		errorMap.delete(element);
		resizeObserver.unobserve(element);
		const mo = mutationMap.get(element);
		if (mo) {
			mo.disconnect();
			mutationMap.delete(element);
		}
		processingSet.delete(element);
	}

	function setError(element: T, message: string) {
		errorMap.set(element, message);
	}

	function getError(element: T): string | undefined {
		return errorMap.get(element);
	}

	function clearError(element: T) {
		errorMap.delete(element);
	}

	/**
	 * Marks the element as fully translated for the given content key.
	 * The key mirrors the value stored in `processed` (image src / canvas
	 * snapshot) so a source change invalidates the translated state.
	 */
	function setTranslated(element: T, key: string) {
		translated.set(element, key);
	}

	function getTranslated(element: T): string | undefined {
		return translated.get(element);
	}

	function hasTranslated(element: T, key?: string): boolean {
		const value = translated.get(element);
		if (value === undefined) return false;
		return key === undefined ? true : value === key;
	}

	function clearTranslated(element: T) {
		translated.delete(element);
	}

	function observeElementAttributes(
		element: T,
		attributeFilter: string[],
		onChange: () => void,
	) {
		if (mutationMap.has(element)) return;
		const observer = new MutationObserver(() => {
			resetElementState(element);
			onChange();
		});
		observer.observe(element, {
			attributes: true,
			attributeFilter,
		});
		mutationMap.set(element, observer);
	}

	function cleanup() {
		resizeObserver.disconnect();
		for (const mo of mutationMap.values()) {
			mo.disconnect();
		}
		mutationMap.clear();
		overlayMap.clear();
		processed.clear();
		translated.clear();
		processingSet.clear();
		errorMap.clear();
	}

	return {
		processed,
		translated,
		overlayMap,
		mutationMap,
		processingSet,
		errorMap,
		resizeObserver,
		schedulePositionUpdate,
		resetElementState,
		observeElementAttributes,
		setError,
		getError,
		clearError,
		setTranslated,
		getTranslated,
		hasTranslated,
		clearTranslated,
		cleanup,
	};
}
