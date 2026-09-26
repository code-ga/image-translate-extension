import type { Job, JobInput, JobType } from "./types";

export const TRANSLATE_PRIORITY = 0;
export const OCR_PRIORITY = 1;

/**
 * Weighted-fair scheduler: translation always wins, but after this many
 * consecutive translation dispatches the next OCR dispatch is forced so a
 * translation flood can never starve OCR.
 */
export const MAX_TRANSLATION_BEFORE_OCR = 2;

let jobCounter = 0;

function nextJobId(): string {
	jobCounter += 1;
	return `job_${jobCounter}_${Date.now()}`;
}

/**
 * Priority queue used by the offscreen document to arbitrate between OCR and
 * translation work. Both kinds are kept in separate FIFO buckets so the
 * weighted policy can decide the *kind* of the next dispatch without losing
 * the arrival order inside a bucket.
 */
export class PriorityQueue {
	private readonly translateJobs: Job[] = [];
	private readonly ocrJobs: Job[] = [];
	private sequenceCounter = 0;
	private consecutiveTranslations = 0;

	enqueue(input: JobInput): Job {
		const type: JobType = input.payload.kind === "ocr" ? "ocr" : "translate";
		const job: Job = {
			id: input.id ?? nextJobId(),
			type,
			payload: input.payload,
			priority: type === "translate" ? TRANSLATE_PRIORITY : OCR_PRIORITY,
			sequence: this.sequenceCounter++,
			resolve: input.resolve,
			reject: input.reject,
		};

		if (type === "translate") {
			this.translateJobs.push(job);
		} else {
			this.ocrJobs.push(job);
		}

		return job;
	}

	dequeue(): Job | null {
		return this.dequeueMany(1)[0] ?? null;
	}

	/**
	 * Removes up to `max` jobs of a single kind. The kind is chosen once by the
	 * weighted policy, so a batch never mixes OCR and translation work.
	 */
	dequeueMany(max: number): Job[] {
		if (max <= 0) return [];

		const type = this.pickType();
		if (!type) return [];

		const source = type === "translate" ? this.translateJobs : this.ocrJobs;
		const jobs = source.splice(0, Math.min(max, source.length));

		if (type === "translate") {
			this.consecutiveTranslations += jobs.length;
		} else {
			this.consecutiveTranslations = 0;
		}

		return jobs;
	}

	peekType(): JobType | null {
		return this.pickType();
	}

	size(): number {
		return this.translateJobs.length + this.ocrJobs.length;
	}

	isEmpty(): boolean {
		return this.size() === 0;
	}

	/** Rejects every pending job, e.g. when the document is shutting down. */
	clear(reason: string): void {
		const pending = [...this.translateJobs, ...this.ocrJobs];
		this.translateJobs.length = 0;
		this.ocrJobs.length = 0;
		this.consecutiveTranslations = 0;

		for (const job of pending) {
			job.reject(new Error(reason));
		}
	}

	private pickType(): JobType | null {
		const hasTranslate = this.translateJobs.length > 0;
		const hasOcr = this.ocrJobs.length > 0;

		if (!hasTranslate) return hasOcr ? "ocr" : null;
		if (!hasOcr) return "translate";
		if (this.consecutiveTranslations >= MAX_TRANSLATION_BEFORE_OCR) {
			return "ocr";
		}
		return "translate";
	}
}
