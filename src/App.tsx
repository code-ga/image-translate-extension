import "./App.css";
import { useState, useEffect, useCallback } from "react";
import { DomainPattern } from "./types";
import { isUrlAllowed } from "./domain-matcher";

const STORAGE_KEY = "extensionSettings";

type Tab = "images" | "canvases" | "settings";
type ImageInfo = {
	src: string;
	currentSrc: string;
	width: number;
	height: number;
	status: string;
};
type CanvasInfo = {
	index: number;
	width: number;
	height: number;
	status: string;
};

function App() {
	const [tab, setTab] = useState<Tab>("images");
	const [images, setImages] = useState<ImageInfo[]>([]);
	const [canvases, setCanvases] = useState<CanvasInfo[]>([]);
	const [error, _setError] = useState<string>("");
	const [enabledDomains, setEnabledDomains] = useState<DomainPattern[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [domainInput, setDomainInput] = useState("");
	const [matchType, setMatchType] = useState<"domain" | "include" | "regex">(
		"domain",
	);
	const [currentDomain, setCurrentDomain] = useState<string>("");
	const [imageCount, setImageCount] = useState(0);
	const [canvasCount, setCanvasCount] = useState(0);
	const [imageProcessingCount, setImageProcessingCount] = useState(0);
	const [canvasProcessingCount, setCanvasProcessingCount] = useState(0);

	const injectContentScript = useCallback(async (tabId: number) => {
		await chrome.scripting.executeScript({
			target: { tabId },
			files: ["content.js"],
		});
		await new Promise((r) => setTimeout(r, 800));
	}, []);

	const loadSettings = useCallback(async () => {
		const result = (await chrome.storage.sync.get(STORAGE_KEY)) as Record<
			string,
			any
		>;
		const settings = result[STORAGE_KEY] || {
			enabledDomains: [],
			enabled: true,
		};
		setEnabledDomains(settings.enabledDomains || []);
		setGlobalEnabled(settings.enabled ?? true);
	}, []);

	const saveSettings = useCallback(
		async (updates: {
			enabledDomains?: DomainPattern[];
			enabled?: boolean;
		}) => {
			const current = (await chrome.storage.sync.get(STORAGE_KEY)) as Record<
				string,
				any
			>;
			const settings = {
				...(current[STORAGE_KEY] || { enabledDomains: [], enabled: true }),
				...updates,
			};
			await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
			setEnabledDomains(settings.enabledDomains || []);
			setGlobalEnabled(settings.enabled ?? true);

			chrome.runtime
				.sendMessage({
					type: "notify-settings-changed",
					settings: {
						enabled: settings.enabled ?? true,
						enabledDomains: settings.enabledDomains || [],
					},
				})
				.catch(() => {});
		},
		[],
	);

	const pollPageData = useCallback(async () => {
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (!tab.id || !tab.url) return;

			setCurrentDomain(tab.url || "");

			try {
				const [imagesResponse, canvasesResponse] = await Promise.all([
					chrome.tabs.sendMessage(tab.id, { type: "get-image-status" }),
					chrome.tabs.sendMessage(tab.id, { type: "get-canvas-status" }),
				]);
				if (
					imagesResponse &&
					(imagesResponse as any).type === "image-status-list"
				) {
					setImages((imagesResponse as any).images);
					setImageCount((imagesResponse as any).images.length);
					setImageProcessingCount(
						(imagesResponse as any).images.filter(
							(i: ImageInfo) => i.status === "processing",
						).length,
					);
				}
				if (
					canvasesResponse &&
					(canvasesResponse as any).type === "canvas-status-list"
				) {
					setCanvases((canvasesResponse as any).canvases);
					setCanvasCount((canvasesResponse as any).canvases.length);
					setCanvasProcessingCount(
						(canvasesResponse as any).canvases.filter(
							(c: CanvasInfo) => c.status === "processing",
						).length,
					);
				}
			} catch (err) {
				await injectContentScript(tab.id);
				const [imagesResponse, canvasesResponse] = await Promise.all([
					chrome.tabs.sendMessage(tab.id, { type: "get-image-status" }),
					chrome.tabs.sendMessage(tab.id, { type: "get-canvas-status" }),
				]);
				if (
					imagesResponse &&
					(imagesResponse as any).type === "image-status-list"
				) {
					setImages((imagesResponse as any).images);
					setImageCount((imagesResponse as any).images.length);
					setImageProcessingCount(
						(imagesResponse as any).images.filter(
							(i: ImageInfo) => i.status === "processing",
						).length,
					);
				}
				if (
					canvasesResponse &&
					(canvasesResponse as any).type === "canvas-status-list"
				) {
					setCanvases((canvasesResponse as any).canvases);
					setCanvasCount((canvasesResponse as any).canvases.length);
					setCanvasProcessingCount(
						(canvasesResponse as any).canvases.filter(
							(c: CanvasInfo) => c.status === "processing",
						).length,
					);
				}
			}
		} catch (err) {
			// ignore polling errors when tab is not active
		}
	}, [injectContentScript]);

	useEffect(() => {
		loadSettings();
		pollPageData();

		const interval = setInterval(() => {
			if (tab !== "settings") {
				pollPageData();
			}
		}, 1500);

		const progressListener = (msg: any) => {
			if (
				msg.type === "translate-images-complete" ||
				msg.type === "translate-images-progress"
			) {
				pollPageData();
			}
		};

		chrome.runtime.onMessage.addListener(progressListener);
		return () => {
			clearInterval(interval);
			chrome.runtime.onMessage.removeListener(progressListener);
		};
	}, [loadSettings, pollPageData, tab]);

	const isDomainAllowed = (href: string): boolean => {
		if (!globalEnabled) return false;
		if (enabledDomains.length === 0) return true;
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

	const getStatusLabel = (status: string) => {
		switch (status) {
			case "processing":
				return "Translating...";
			case "done":
				return "Done";
			default:
				return "";
		}
	};

	const getStatusClass = (status: string) => {
		switch (status) {
			case "processing":
				return "status-processing";
			case "done":
				return "status-done";
			default:
				return "status-pending";
		}
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
							<span className="setting-title">Allowed Domains</span>
							<span className="setting-desc">
								{enabledDomains.length === 0
									? "All domains translate when enabled"
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
							<div key={idx} className="domain-item">
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
