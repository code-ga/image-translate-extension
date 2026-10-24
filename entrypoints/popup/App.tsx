import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DomainPattern, GetOcrQueueResponse, OcrJob } from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { SUPPORTED_LANGUAGES } from "@/utils/languages";

const STORAGE_KEY = "extensionSettings";

type Tab = "images" | "canvases" | "settings";
type ImageInfo = {
	src: string;
	currentSrc: string;
	width: number;
	height: number;
	status: "pending" | "processing" | "done" | "error";
};
type CanvasInfo = {
	index: number;
	width: number;
	height: number;
	status: "pending" | "processing" | "done" | "error";
};

function App() {
	const [tab, setTab] = useState<Tab>("images");
	const [images, setImages] = useState<ImageInfo[]>([]);
	const [canvases, setCanvases] = useState<CanvasInfo[]>([]);
	const [error, setError] = useState<string>("");
	const [enabledDomains, setEnabledDomains] = useState<DomainPattern[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [domainInput, setDomainInput] = useState("");
	const [matchType, setMatchType] = useState<"domain" | "include" | "regex">(
		"domain",
	);
	const [currentDomain, setCurrentDomain] = useState<string>("");
	const [targetLang, setTargetLang] = useState("vie_Latn");
	const [imageCount, setImageCount] = useState(0);
	const [canvasCount, setCanvasCount] = useState(0);
	const [imageProcessingCount, setImageProcessingCount] = useState(0);
	const [canvasProcessingCount, setCanvasProcessingCount] = useState(0);
	const [imageErrorCount, setImageErrorCount] = useState(0);
	const [canvasErrorCount, setCanvasErrorCount] = useState(0);
	const [queueJobs, setQueueJobs] = useState<OcrJob[]>([]);

	const loadSettings = useCallback(async () => {
		const result = (await browser.storage.sync.get(STORAGE_KEY)) as Record<
			string,
			any
		>;
		const settings = result[STORAGE_KEY] || {
			enabledDomains: [],
			enabled: true,
			targetLang: "vie_Latn",
		};
		setEnabledDomains(settings.enabledDomains || []);
		setGlobalEnabled(settings.enabled ?? true);
		setTargetLang(settings.targetLang || "vie_Latn");
	}, []);

	const saveSettings = useCallback(
		async (updates: {
			enabledDomains?: DomainPattern[];
			enabled?: boolean;
			targetLang?: string;
		}) => {
			const current = (await browser.storage.sync.get(STORAGE_KEY)) as Record<
				string,
				any
			>;
			const settings = {
				...(current[STORAGE_KEY] || {
					enabledDomains: [],
					enabled: true,
					targetLang: "vie_Latn",
				}),
				...updates,
			};
			await browser.storage.sync.set({ [STORAGE_KEY]: settings });
			setEnabledDomains(settings.enabledDomains || []);
			setGlobalEnabled(settings.enabled ?? true);
			setTargetLang(settings.targetLang || "vie_Latn");

			browser.runtime
				.sendMessage({
					type: "settings/notify-changed",
					settings: {
						enabled: settings.enabled ?? true,
						enabledDomains: settings.enabledDomains || [],
						targetLang: settings.targetLang || "vie_Latn",
					},
				})
				.catch(() => {});
		},
		[],
	);

	const pollPageData = useCallback(async () => {
		try {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (!tab.id || !tab.url) return;

			setCurrentDomain(tab.url || "");

			try {
				const [imagesResult, canvasesResult] = await Promise.allSettled([
					browser.tabs.sendMessage(tab.id, { type: "ui/get-image-status" }),
					browser.tabs.sendMessage(tab.id, { type: "ui/get-canvas-status" }),
				]);
				if (
					imagesResult.status === "fulfilled" &&
					(imagesResult.value as any)?.type === "ui/image-status-list"
				) {
					const imagesData = (imagesResult.value as any).images;
					setImages(imagesData);
					setImageCount(imagesData.length);
					setImageProcessingCount(
						imagesData.filter((i: ImageInfo) => i.status === "processing")
							.length,
					);
					setImageErrorCount(
						imagesData.filter((i: ImageInfo) => i.status === "error").length,
					);
				}
				if (
					canvasesResult.status === "fulfilled" &&
					(canvasesResult.value as any)?.type === "ui/canvas-status-list"
				) {
					const canvasesData = (canvasesResult.value as any).canvases;
					setCanvases(canvasesData);
					setCanvasCount(canvasesData.length);
					setCanvasProcessingCount(
						canvasesData.filter((c: CanvasInfo) => c.status === "processing")
							.length,
					);
					setCanvasErrorCount(
						canvasesData.filter((c: CanvasInfo) => c.status === "error").length,
					);
				}
				if (
					imagesResult.status === "rejected" &&
					canvasesResult.status === "rejected"
				) {
					console.error(
						"Failed to get image/canvas status:",
						imagesResult.reason,
					);
					setImages([]);
					setCanvases([]);
					setImageCount(0);
					setCanvasCount(0);
					setImageProcessingCount(0);
					setCanvasProcessingCount(0);
					setImageErrorCount(0);
					setCanvasErrorCount(0);
				}
			} catch (_err) {
				console.error("Poll page data inner error:", _err);
			}
		} catch (_err) {
			console.error("Poll page data outer error:", _err);
			// ignore polling errors when tab is not active
		}
	}, []);

	const pollQueue = useCallback(async () => {
		try {
			const response = (await browser.runtime.sendMessage({
				from: "popup",
				to: "background",
				type: "ocr/get-queue",
			})) as GetOcrQueueResponse | undefined;
			if (response?.jobs) {
				setQueueJobs(response.jobs);
			}
		} catch (err) {
			console.error("Poll OCR queue error:", err);
		}
	}, []);

	const queueGroups = useMemo(() => {
		const groups = new Map<string, OcrJob[]>();
		for (const job of queueJobs) {
			const key = job.tabUrl || "unknown-tab";
			const group = groups.get(key);
			if (group) {
				group.push(job);
			} else {
				groups.set(key, [job]);
			}
		}
		return Array.from(groups.entries());
	}, [queueJobs]);

	const activeQueueCount = useMemo(
		() =>
			queueJobs.filter(
				(job) => job.status === "queued" || job.status === "processing",
			).length,
		[queueJobs],
	);

	useEffect(() => {
		loadSettings();
		pollPageData();
		pollQueue();

		const interval = setInterval(() => {
			if (tab !== "settings") {
				pollPageData();
				pollQueue();
			}
		}, 1500);

		const progressListener = (msg: any) => {
			if (
				msg.type === "translate/progress" ||
				msg.type === "translate/complete"
			) {
				if (msg.error) {
					setError(msg.error);
				}
				pollPageData();
			}

			if (msg.type === "extension/error") {
				setError(msg.error);
			}
		};

		browser.runtime.onMessage.addListener(progressListener);
		return () => {
			clearInterval(interval);
			browser.runtime.onMessage.removeListener(progressListener);
		};
	}, [loadSettings, pollPageData, pollQueue, tab]);

	useEffect(() => {
		if (!error) return;
		const timer = setTimeout(() => setError(""), 6000);
		return () => clearTimeout(timer);
	}, [error]);

	const isDomainAllowed = (href: string): boolean => {
		if (!globalEnabled) return false;
		if (enabledDomains.length === 0) return false;
		return isUrlAllowed(href || "", enabledDomains);
	};

	const addDomain = async () => {
		const raw = domainInput.trim();
		if (!raw) return;
		let entry: DomainPattern;
		if (matchType === "domain") {
			const hostname = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
			entry = hostname;
		} else {
			entry = { pattern: raw, matchType };
		}
		const exists = enabledDomains.some((d) =>
			typeof d === "string"
				? d === entry
				: typeof entry === "string"
					? false
					: d.pattern === entry.pattern && d.matchType === entry.matchType,
		);
		if (exists) {
			setDomainInput("");
			return;
		}
		await saveSettings({ enabledDomains: [...enabledDomains, entry] });
		setDomainInput("");
	};

	const removeDomain = async (index: number) => {
		const next = enabledDomains.slice();
		next.splice(index, 1);
		await saveSettings({ enabledDomains: next });
	};

	const toggleGlobal = async () => {
		await saveSettings({ enabled: !globalEnabled });
	};

	const changeTargetLang = async (e: React.ChangeEvent<HTMLSelectElement>) => {
		const lang = e.target.value;
		setTargetLang(lang);
		await saveSettings({ targetLang: lang });
	};

	const getStatusLabel = (status: string) => {
		switch (status) {
			case "queued":
				return "Queued";
			case "processing":
				return "Translating...";
			case "done":
				return "Done";
			case "error":
				return "Error";
			default:
				return "";
		}
	};

	const getStatusClass = (status: string) => {
		switch (status) {
			case "queued":
				return "status-queued";
			case "processing":
				return "status-processing";
			case "done":
				return "status-done";
			case "error":
				return "status-error";
			default:
				return "status-pending";
		}
	};

	const formatTabLabel = (tabUrl: string) => {
		if (!tabUrl || tabUrl === "unknown-tab") return "Unknown tab";
		try {
			const url = new URL(tabUrl);
			return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
		} catch {
			return tabUrl;
		}
	};

	const formatJobTarget = (job: OcrJob) => {
		if (job.type === "canvas") {
			const match = /^canvas:(\d+)$/.exec(job.target);
			return match ? `Canvas #${Number(match[1]) + 1}` : job.target || "Canvas";
		}
		return job.target || "Image";
	};

	return (
		<div className="popup">
			<div className="header">
				<h2>Image Translate</h2>
			</div>

			{error && <div className="error">{error}</div>}

			<div className="tabs">
				<button
					className={`tab ${tab === "images" ? "active" : ""}`}
					onClick={() => setTab("images")}
				>
					Images
					{imageProcessingCount > 0 && (
						<span className="tab-badge processing">{imageProcessingCount}</span>
					)}
					{imageErrorCount > 0 && (
						<span className="tab-badge error">{imageErrorCount}</span>
					)}
				</button>
				<button
					className={`tab ${tab === "canvases" ? "active" : ""}`}
					onClick={() => setTab("canvases")}
				>
					Canvases
					{canvasProcessingCount > 0 && (
						<span className="tab-badge processing">
							{canvasProcessingCount}
						</span>
					)}
					{canvasErrorCount > 0 && (
						<span className="tab-badge error">{canvasErrorCount}</span>
					)}
				</button>
				<button
					className={`tab ${tab === "settings" ? "active" : ""}`}
					onClick={() => setTab("settings")}
				>
					Settings
				</button>
			</div>

			{tab === "images" && (
				<div className="list-panel">
					{images.length === 0 ? (
						<div className="empty">No images found on this page</div>
					) : (
						images.map((img) => (
							<div key={img.currentSrc} className="list-item">
								<div className="item-info">
									<div className="item-url" title={img.currentSrc}>
										{img.currentSrc}
									</div>
									<div className="item-meta">
										{img.width}x{img.height}
									</div>
								</div>
								{img.status !== "pending" && (
									<span
										className={`status-badge ${getStatusClass(img.status)}`}
									>
										{getStatusLabel(img.status)}
									</span>
								)}
							</div>
						))
					)}

					<div className="queue-section">
						<div className="queue-header">
							<span className="queue-title">Processing queue</span>
							{activeQueueCount > 0 && (
								<span className="tab-badge processing">{activeQueueCount}</span>
							)}
						</div>
						{queueGroups.length === 0 ? (
							<div className="queue-empty">No OCR jobs in the queue</div>
						) : (
							queueGroups.map(([tabUrl, jobs]) => (
								<div key={tabUrl} className="queue-group">
									<div className="queue-tab" title={tabUrl}>
										{formatTabLabel(tabUrl)}
									</div>
									{jobs.map((job) => (
										<div key={job.id} className="queue-item">
											<div className="item-info">
												<div
													className="item-url"
													title={job.target || job.type}
												>
													{formatJobTarget(job)}
												</div>
												<div className="item-meta">{job.type}</div>
											</div>
											<span
												className={`status-badge ${getStatusClass(job.status)}`}
											>
												{getStatusLabel(job.status)}
											</span>
										</div>
									))}
								</div>
							))
						)}
					</div>
				</div>
			)}

			{tab === "canvases" && (
				<div className="list-panel">
					{canvases.length === 0 ? (
						<div className="empty">No canvases found on this page</div>
					) : (
						canvases.map((canvas) => (
							<div key={canvas.index} className="list-item">
								<div className="item-info">
									<div className="item-url">Canvas #{canvas.index + 1}</div>
									<div className="item-meta">
										{canvas.width}x{canvas.height}
									</div>
								</div>
								{canvas.status !== "pending" && (
									<span
										className={`status-badge ${getStatusClass(canvas.status)}`}
									>
										{getStatusLabel(canvas.status)}
									</span>
								)}
							</div>
						))
					)}
				</div>
			)}

			{tab === "settings" && (
				<div className="settings">
					<div className="domain-status">
						<div className="current-domain">
							<span className="domain-label">Current URL</span>
							<span className="domain-value">{currentDomain || "Unknown"}</span>
						</div>
						<div className="status-badge">
							{isDomainAllowed(currentDomain) ? (
								<span className="badge active">Auto-translating</span>
							) : (
								<span className="badge inactive">Not translating</span>
							)}
						</div>
					</div>

					<div className="divider" />

					<div className="setting-item">
						<div className="setting-label">
							<span className="setting-title">Global Enable</span>
							<span className="setting-desc">
								Turn on/off translation for all pages
							</span>
						</div>
						<button
							className={`toggle ${globalEnabled ? "on" : "off"}`}
							onClick={toggleGlobal}
						>
							{globalEnabled ? "ON" : "OFF"}
						</button>
					</div>

					<div className="divider" />

					<div className="setting-item">
						<div className="setting-label">
							<span className="setting-title">Default Target Language</span>
							<span className="setting-desc">
								Used for auto-translation and as the default in the hover popup
							</span>
						</div>
						<select
							className="lang-select"
							value={targetLang}
							onChange={changeTargetLang}
						>
							{SUPPORTED_LANGUAGES.map((lang) => (
								<option key={lang.code} value={lang.code}>
									{lang.label}
								</option>
							))}
						</select>
					</div>

					<div className="divider" />

					<div className="setting-item">
						<div className="setting-label">
							<span className="setting-title">Allowed Domains</span>
							<span className="setting-desc">
								{enabledDomains.length === 0
									? "No domains configured"
									: `Translation active for ${enabledDomains.length} domain(s)`}
							</span>
						</div>
					</div>

					<div className="quick-add">
						<button
							className="quick-add-btn"
							onClick={async () => {
								if (!currentDomain) return;
								// detect path presence to suggest include
								try {
									const u = new URL(currentDomain);
									const suggestInclude = u.pathname && u.pathname !== "/";
									const entry: DomainPattern = suggestInclude
										? { pattern: u.origin + u.pathname, matchType: "include" }
										: u.hostname;
									const exists = enabledDomains.some((d) =>
										typeof d === "string"
											? d === entry
											: typeof entry === "string"
												? false
												: d.pattern === entry.pattern &&
													d.matchType === entry.matchType,
									);
									if (exists) {
										return;
									}
									await saveSettings({
										enabledDomains: [...enabledDomains, entry],
									});
								} catch (e) {
									// fallback: treat as plain string
								}
							}}
							disabled={!currentDomain}
						>
							Add current URL
						</button>
					</div>

					<div className="domain-list">
						{enabledDomains.map((d, idx) => (
							<div
								key={typeof d === "string" ? d : `${d.matchType}: ${d.pattern}`}
								className="domain-item"
							>
								<span className="domain-name">
									{typeof d === "string" ? d : `${d.matchType}: ${d.pattern}`}
								</span>
								<button
									className="domain-remove"
									onClick={() => removeDomain(idx)}
									title="Remove"
								>
									Remove
								</button>
							</div>
						))}
					</div>

					<div className="add-domain">
						<input
							type="text"
							value={domainInput}
							onChange={(e) => setDomainInput(e.target.value)}
							placeholder="e.g. example.com or /viewer/123"
							onKeyDown={(e) => e.key === "Enter" && addDomain()}
						/>
						<div className="match-type">
							<label>
								<input
									type="radio"
									name="match"
									value="domain"
									checked={matchType === "domain"}
									onChange={() => setMatchType("domain")}
								/>{" "}
								Domain
							</label>
							<label>
								<input
									type="radio"
									name="match"
									value="include"
									checked={matchType === "include"}
									onChange={() => setMatchType("include")}
								/>{" "}
								Include
							</label>
							<label>
								<input
									type="radio"
									name="match"
									value="regex"
									checked={matchType === "regex"}
									onChange={() => setMatchType("regex")}
								/>{" "}
								Regex
							</label>
						</div>
						<button onClick={addDomain} className="primary">
							Add
						</button>
					</div>

					{enabledDomains.length > 0 && (
						<button
							className="clear-all"
							onClick={() => saveSettings({ enabledDomains: [] })}
						>
							Clear All Domains
						</button>
					)}

					<div className="divider" />

					<div className="stats">
						<div className="stat-item">
							<span className="stat-icon">📷</span>
							<span className="stat-label">Images detected</span>
							<span className="stat-value">{imageCount}</span>
						</div>
						<div className="stat-item">
							<span className="stat-icon">🎨</span>
							<span className="stat-label">Canvases detected</span>
							<span className="stat-value">{canvasCount}</span>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
