import type { OCRBox, OCRRegion, Point } from "@/types";

const SAME_LINE_VERTICAL_OVERLAP_RATIO = 0.3;
const SAME_LINE_HORIZONTAL_GAP_RATIO = 1.2;
const STACKED_VERTICAL_GAP_RATIO = 1.5;
const STACKED_HORIZONTAL_OVERLAP_RATIO = 0.3;
const SAME_LINE_Y_TOLERANCE_RATIO = 0.3;

function cross(o: Point, a: Point, b: Point): number {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Point[]): Point[] {
	if (points.length <= 1) return points.slice();

	const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
	const lower: Point[] = [];
	for (const p of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
			lower.pop();
		}
		lower.push(p);
	}
	const upper: Point[] = [];
	for (let i = sorted.length - 1; i >= 0; i--) {
		const p = sorted[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
			upper.pop();
		}
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

function getPolygon(box: OCRBox): Point[] {
	if (box.polygon.length === 4) return box.polygon;
	const { x, y, width, height } = box.box;
	return [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height },
	];
}

function computeBounds(points: Point[]): { top: number; left: number; width: number; height: number } {
	if (points.length === 0) return { top: 0, left: 0, width: 0, height: 0 };
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of points) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return { top: minY, left: minX, width: maxX - minX, height: maxY - minY };
}

function verticalOverlap(a: OCRBox, b: OCRBox): number {
	const aTop = a.box.y;
	const aBottom = a.box.y + a.box.height;
	const bTop = b.box.y;
	const bBottom = b.box.y + b.box.height;
	const overlap = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
	const minHeight = Math.min(a.box.height, b.box.height);
	return minHeight > 0 ? overlap / minHeight : 0;
}

function horizontalOverlap(a: OCRBox, b: OCRBox): number {
	const aLeft = a.box.x;
	const aRight = a.box.x + a.box.width;
	const bLeft = b.box.x;
	const bRight = b.box.x + b.box.width;
	const overlap = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
	const minWidth = Math.min(a.box.width, b.box.width);
	return minWidth > 0 ? overlap / minWidth : 0;
}

function isSameLine(a: OCRBox, b: OCRBox, avgHeight: number): boolean {
	return (
		verticalOverlap(a, b) > SAME_LINE_VERTICAL_OVERLAP_RATIO &&
		Math.abs(b.box.x - (a.box.x + a.box.width)) < avgHeight * SAME_LINE_HORIZONTAL_GAP_RATIO
	);
}

function isStacked(a: OCRBox, b: OCRBox, avgHeight: number): boolean {
	const verticalGap = Math.abs(b.box.y - (a.box.y + a.box.height));
	return (
		verticalGap < avgHeight * STACKED_VERTICAL_GAP_RATIO &&
		horizontalOverlap(a, b) > STACKED_HORIZONTAL_OVERLAP_RATIO
	);
}

function areAdjacent(a: OCRBox, b: OCRBox, avgHeight: number): boolean {
	return isSameLine(a, b, avgHeight) || isStacked(a, b, avgHeight);
}

function buildAdjacency(boxes: OCRBox[], avgHeight: number): boolean[][] {
	const n = boxes.length;
	const adj: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			if (areAdjacent(boxes[i], boxes[j], avgHeight)) {
				adj[i][j] = true;
				adj[j][i] = true;
			}
		}
	}
	return adj;
}

function findComponents(adj: boolean[][]): number[][] {
	const n = adj.length;
	const visited = new Array(n).fill(false);
	const components: number[][] = [];

	for (let i = 0; i < n; i++) {
		if (visited[i]) continue;
		const stack = [i];
		visited[i] = true;
		const component: number[] = [];
		while (stack.length > 0) {
			const node = stack.pop()!;
			component.push(node);
			for (let j = 0; j < n; j++) {
				if (adj[node][j] && !visited[j]) {
					visited[j] = true;
					stack.push(j);
				}
			}
		}
		components.push(component);
	}
	return components;
}

function sortByReadingOrder(boxes: OCRBox[], avgHeight: number): OCRBox[] {
	return boxes.slice().sort((a, b) => {
		const yDiff = a.box.y - b.box.y;
		if (Math.abs(yDiff) < avgHeight * SAME_LINE_Y_TOLERANCE_RATIO) {
			return a.box.x - b.box.x;
		}
		return yDiff;
	});
}

export function groupOcrBoxesIntoRegions(rawBoxes: OCRBox[]): OCRRegion[] {
	if (rawBoxes.length === 0) return [];

	const avgHeight =
		rawBoxes.reduce((sum, b) => sum + b.box.height, 0) / rawBoxes.length;

	const adj = buildAdjacency(rawBoxes, avgHeight);
	const components = findComponents(adj);

	return components.map((indices) => {
		const boxes = indices.map((i) => rawBoxes[i]);
		const sorted = sortByReadingOrder(boxes, avgHeight);
		const text = sorted.map((b) => b.text).join(" ");

		const allPoints: Point[] = [];
		for (const b of sorted) {
			allPoints.push(...getPolygon(b));
		}

		const hull = convexHull(allPoints);
		const bounds = computeBounds(hull);

		return {
			text,
			boxes: sorted,
			bounds,
		};
	});
}
