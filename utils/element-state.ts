import { updateElementOverlayPosition } from "./overlay";

export function createElementState<T extends Element>() {
	const processed = new Map<T, string>();
	const overlayMap = new Map<T, HTMLElement>();
	const mutationMap = new Map<T, MutationObserver>();
	const processingSet = new Set<T>();

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
		resizeObserver.unobserve(element);
		const mo = mutationMap.get(element);
		if (mo) {
			mo.disconnect();
			mutationMap.delete(element);
		}
		processingSet.delete(element);
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
		processingSet.clear();
	}

	return {
		processed,
		overlayMap,
		mutationMap,
		processingSet,
		resizeObserver,
		schedulePositionUpdate,
		resetElementState,
		observeElementAttributes,
		cleanup,
	};
}
