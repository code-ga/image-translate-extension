import {
	CONTENT_PORT_NAME,
	type ExtensionPort,
	type JobPayload,
	type JobResponse,
	type QueueRequest,
	type QueueResult,
} from "@/src/queue/types";

/**
 * Ports keep the service worker alive (Chrome 114+) and avoid the
 * "A listener indicated an asynchronous response … channel closed" race that
 * `runtime.sendMessage` hits when the worker is torn down mid-response.
 */
const JOB_TIMEOUT_MS = 180_000;

type PendingJob = {
	resolve: (response: JobResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

let activePort: ExtensionPort | null = null;
let jobCounter = 0;
const pendingJobs = new Map<string, PendingJob>();

function getPort(): ExtensionPort {
	if (activePort) return activePort;

	const port = browser.runtime.connect({ name: CONTENT_PORT_NAME });
	activePort = port;

	port.onMessage.addListener((message: QueueResult) => {
		if (message?.type !== "queue/result") return;
		const pending = pendingJobs.get(message.jobId);
		if (!pending) return;
		pendingJobs.delete(message.jobId);
		clearTimeout(pending.timer);
		pending.resolve(message.response);
	});

	port.onDisconnect.addListener(() => {
		if (activePort === port) activePort = null;
		for (const [jobId, pending] of pendingJobs) {
			pendingJobs.delete(jobId);
			clearTimeout(pending.timer);
			pending.reject(
				new Error("The extension connection closed before the job finished"),
			);
		}
	});

	return port;
}

/** Enqueues a job on the offscreen priority queue and awaits its result. */
export function requestJob(payload: JobPayload): Promise<JobResponse> {
	jobCounter += 1;
	const jobId = `job_${jobCounter}_${Date.now()}`;

	return new Promise<JobResponse>((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingJobs.delete(jobId);
			reject(new Error("Timed out waiting for the translation queue"));
		}, JOB_TIMEOUT_MS);

		pendingJobs.set(jobId, { resolve, reject, timer });

		try {
			const request: QueueRequest = { type: "queue/enqueue", jobId, payload };
			getPort().postMessage(request);
		} catch (error) {
			pendingJobs.delete(jobId);
			clearTimeout(timer);
			reject(
				error instanceof Error
					? error
					: new Error("Failed to reach the extension"),
			);
		}
	});
}
