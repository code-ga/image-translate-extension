import { updateElementOverlayPosition } from "./overlay";

export function createElementState<T extends Element>() {
	const processed = new Map<T, string>();
	const overlayMap = new Map<T, HTMLElement>();
	const mutationMap = new Map<T, MutationObserver>();
	const resetPendingMap = new Map<T, boolean>();
	const eventCleanupMap = new Map<T, () => void>();
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
		const cleanupEvents = eventCleanupMap.get(element);
		if (cleanupEvents) {
			cleanupEvents();
			eventCleanupMap.delete(element);
		}
		processingSet.delete(element);
		resetPendingMap.delete(element);
	}

	function observeElementAttributes(
		element: T,
		attributeFilter: string[],
		onChange: () => void,
	) {
		if (mutationMap.has(element)) return;
		const observer = new MutationObserver(() => {
			if (resetPendingMap.has(element)) return;
			resetPendingMap.set(element, true);
			queueMicrotask(() => {
				resetPendingMap.delete(element);
				resetElementState(element);
				onChange();
			});
		});
		observer.observe(element, {
			attributes: true,
			attributeFilter,
		});
		mutationMap.set(element, observer);
	}

	function observeElementEvents(
		element: T,
		eventTypes: string[],
		onChange: (event: Event) => void,
	) {
		if (eventCleanupMap.has(element)) return;
		const handler = (event: Event) => onChange(event);
		for (const eventType of eventTypes) {
			element.addEventListener(eventType, handler);
		}
		eventCleanupMap.set(element, () => {
			for (const eventType of eventTypes) {
				element.removeEventListener(eventType, handler);
			}
		});
	}

	function resetAll() {
		for (const element of overlayMap.keys()) {
			resetElementState(element);
		}
	}

	function cleanup() {
		resizeObserver.disconnect();
		for (const mo of mutationMap.values()) {
			mo.disconnect();
		}
		mutationMap.clear();
		resetPendingMap.clear();
		for (const cleanupEvents of eventCleanupMap.values()) {
			cleanupEvents();
		}
		eventCleanupMap.clear();
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
		resetAll,
		observeElementAttributes,
		observeElementEvents,
		cleanup,
	};
}
