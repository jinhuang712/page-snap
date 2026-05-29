import { createZip } from "./zip-store.js";

const ARCHIVE_VERSION = "0.1.0";
const MAX_SCROLL_STEPS = 80;
const SCROLL_SETTLE_MS = 180;
const RESOURCE_TIMEOUT_MS = 15000;
const MAX_RESOURCE_COUNT = 1500;
const OBJECT_URL_REVOKE_MS = 120000;

const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tabId"));
const tabUrl = params.get("tabUrl") || "";
const tabTitle = params.get("tabTitle") || "";
const format = params.get("format") || "mhtml";
const options = {
  scrollPage: params.get("scrollPage") !== "0",
  includeReadableText: params.get("includeReadableText") !== "0"
};

const stageElement = document.querySelector("#stage");
const progressElement = document.querySelector("#progress");
const pillElement = document.querySelector("#status-pill");
const logElement = document.querySelector("#log");
const closeButton = document.querySelector("#close");
const formatElement = document.querySelector("#format");
const filenameElement = document.querySelector("#filename");
const resourcesElement = document.querySelector("#resources");

formatElement.textContent = format.toUpperCase();
closeButton.addEventListener("click", () => window.close());

run().catch((error) => {
  setStage(`Failed: ${error.message}`, 100);
  setPill("error", "Error");
  appendLog(error.stack || error.message);
  closeButton.disabled = false;
});

async function run() {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Missing active tab id.");
  }

  const result = await saveArchive(tabId, format, options);
  filenameElement.textContent = result.filename;
  if (typeof result.resourceCount === "number") {
    resourcesElement.textContent = `${result.resourceCount} captured, ${result.failedCount} failed`;
  }
  setStage("Download started. Keep this window open until the browser download prompt is finished.", 100);
  setPill("done", "Done");
  closeButton.disabled = false;
}

async function saveArchive(targetTabId, archiveFormat, archiveOptions) {
  const tab = { id: targetTabId, url: tabUrl, title: tabTitle };
  if (!tab.url || !isArchiveableUrl(tab.url)) {
    throw new Error("This page type cannot be archived by a Chrome extension.");
  }

  await injectSnapshotCollector(targetTabId);

  if (archiveOptions.scrollPage) {
    setStage("Scrolling through the full page to trigger lazy-loaded content.", 10);
    await runInTab(targetTabId, (maxSteps, settleMs) => window.__webScanner.scrollFullPage(maxSteps, settleMs), [
      MAX_SCROLL_STEPS,
      SCROLL_SETTLE_MS
    ]);
  }

  if (archiveFormat === "mhtml") {
    return saveMhtml(targetTabId, tab);
  }

  setStage("Collecting DOM, readable text, and resource references.", 22);
  const snapshot = await runInTab(
    targetTabId,
    (snapshotOptions) => window.__webScanner.collectPageSnapshot(snapshotOptions),
    [
      {
        includeReadableText: Boolean(archiveOptions.includeReadableText),
        archiveVersion: ARCHIVE_VERSION
      }
    ]
  );
  const normalizedSnapshot = normalizeSnapshot(snapshot, tab.url);

  if (archiveFormat === "html") {
    return saveSingleHtml(normalizedSnapshot);
  }
  if (archiveFormat === "zip") {
    return saveZipArchive(normalizedSnapshot);
  }

  throw new Error(`Unsupported archive type: ${archiveFormat}`);
}

function isArchiveableUrl(url) {
  return /^(https?|file):/i.test(url);
}

async function injectSnapshotCollector(targetTabId) {
  await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    files: ["content-snapshot.js"]
  });
}

async function runInTab(targetTabId, func, args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func,
    args
  });

  if (result?.result?.error) {
    throw new Error(result.result.error);
  }

  return result?.result;
}

async function saveMhtml(targetTabId, tab) {
  setStage("Asking Chrome to generate native MHTML.", 35);
  const mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId: targetTabId });
  if (!mhtmlBlob) {
    throw new Error("Chrome did not return an MHTML blob.");
  }

  const filename = `${archiveBaseName(tab)}.mhtml`;
  await downloadBlob(mhtmlBlob, filename, "Save MHTML archive");
  return { filename };
}

async function saveSingleHtml(snapshot) {
  setStage("Fetching page resources for the standalone HTML file.", 34);
  const resources = await fetchResources(snapshot.resources);
  prepareResourcesForExport(resources);
  const html = buildStandaloneHtml(snapshot, resources, "html");
  const filename = `${snapshot.baseName}.html`;
  await downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), filename, "Save HTML archive");
  return resourceResult(filename, resources);
}

async function saveZipArchive(snapshot) {
  setStage("Fetching page resources for the Web Archive ZIP.", 34);
  const resources = await fetchResources(snapshot.resources);
  prepareResourcesForExport(resources);
  const html = buildStandaloneHtml(snapshot, resources, "zip");
  const metadata = buildMetadata(snapshot, resources);
  const files = [
    {
      path: "index.html",
      data: new TextEncoder().encode(html)
    },
    {
      path: "metadata.json",
      data: new TextEncoder().encode(JSON.stringify(metadata, null, 2))
    },
    {
      path: "text-content.txt",
      data: new TextEncoder().encode(snapshot.readableText || "")
    }
  ];

  for (const resource of resources) {
    if (resource.ok && resource.bytes) {
      files.push({
        path: resource.archivePath,
        data: resource.zipBytes || resource.bytes
      });
    }
  }

  setStage("Writing ZIP central directory.", 82);
  const zipBlob = new Blob([createZip(files)], { type: "application/zip" });
  const filename = `${snapshot.baseName}.webarchive.zip`;
  await downloadBlob(zipBlob, filename, "Save Web Archive ZIP");
  return resourceResult(filename, resources);
}

function resourceResult(filename, resources) {
  return {
    filename,
    resourceCount: resources.filter((resource) => resource.ok).length,
    failedCount: resources.filter((resource) => !resource.ok).length
  };
}

async function downloadBlob(blob, filename, saveAsTitle) {
  setStage(`Starting download: ${filename}`, 92);
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
      conflictAction: "uniquify"
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(`${saveAsTitle} failed: ${error.message}`);
  }

  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_MS);
}

function normalizeSnapshot(snapshot, tabUrl) {
  if (!snapshot || snapshot.error) {
    throw new Error(snapshot?.error || "Unable to collect page snapshot.");
  }

  const pageUrl = snapshot.url || tabUrl;
  return {
    ...snapshot,
    url: pageUrl,
    baseName: sanitizeFileName(snapshot.title || new URL(pageUrl).hostname || "web-archive")
  };
}

async function fetchResources(initialResources) {
  const resources = [];
  const queue = dedupeResources(initialResources);
  const queued = new Set(queue.map((resource) => resource.url));

  for (let index = 0; index < queue.length && resources.length < MAX_RESOURCE_COUNT; index += 1) {
    const resource = queue[index];
    setStage(`Fetching resource ${resources.length + 1} of ${queue.length}.`, progressForFetch(index, queue.length));
    const fetched = await fetchResource(resource, resources.length);
    resources.push(fetched);

    if (isCssResource(fetched) && fetched.ok) {
      for (const cssReference of extractCssReferences(decodeText(fetched.bytes), fetched.url)) {
        if (!queued.has(cssReference.url)) {
          queued.add(cssReference.url);
          queue.push(cssReference);
        }
      }
    }
  }

  if (queue.length >= MAX_RESOURCE_COUNT) {
    appendLog(`Resource limit reached at ${MAX_RESOURCE_COUNT}; remaining resources were skipped.`);
  }

  return resources;
}

function progressForFetch(index, total) {
  if (total <= 0) {
    return 35;
  }
  return Math.min(78, 35 + Math.round((index / total) * 42));
}

function dedupeResources(resources) {
  const seen = new Set();
  const output = [];

  for (const resource of resources || []) {
    if (!resource?.url || seen.has(resource.url)) {
      continue;
    }
    seen.add(resource.url);
    output.push(resource);
  }

  return output;
}

async function fetchResource(resource, index) {
  if (resource.url.startsWith("data:")) {
    const parsed = parseDataUrl(resource.url);
    return {
      ...resource,
      ok: true,
      status: 200,
      mimeType: parsed.mimeType,
      bytes: parsed.bytes,
      dataUrl: resource.url,
      htmlDataUrl: resource.url,
      archivePath: resourceArchivePath(resource.url, index, resource.kind, parsed.mimeType)
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(resource.url, {
      cache: "force-cache",
      credentials: "include",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const mimeType = response.headers.get("content-type") || resource.mimeHint || guessMimeType(resource.url);
    return {
      ...resource,
      ok: true,
      status: response.status,
      mimeType,
      bytes,
      dataUrl: bytesToDataUrl(bytes, mimeType),
      archivePath: resourceArchivePath(resource.url, index, resource.kind, mimeType)
    };
  } catch (error) {
    appendLog(`Failed ${resource.kind || "resource"}: ${resource.url}\n  ${error.message}`);
    return {
      ...resource,
      ok: false,
      error: error.message,
      archivePath: resourceArchivePath(resource.url, index, resource.kind)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function prepareResourcesForExport(resources) {
  const resourceMap = new Map(resources.map((resource) => [resource.url, resource]));

  for (const resource of resources) {
    if (!resource.ok) {
      continue;
    }

    if (!isCssResource(resource)) {
      resource.htmlDataUrl = resource.dataUrl;
      resource.zipBytes = resource.bytes;
      continue;
    }

    const cssText = decodeText(resource.bytes);
    const htmlCss = rewriteCssReferences(cssText, resource.url, (absoluteUrl) => {
      const target = resourceMap.get(absoluteUrl);
      return target?.ok && target.dataUrl ? target.dataUrl : absoluteUrl;
    });
    const zipCss = rewriteCssReferences(cssText, resource.url, (absoluteUrl) => {
      const target = resourceMap.get(absoluteUrl);
      return target?.ok ? relativeArchivePath(resource.archivePath, target.archivePath) : absoluteUrl;
    });
    const cssMime = resource.mimeType || "text/css;charset=utf-8";
    resource.htmlDataUrl = bytesToDataUrl(new TextEncoder().encode(htmlCss), cssMime);
    resource.zipBytes = new TextEncoder().encode(zipCss);
  }
}

function buildStandaloneHtml(snapshot, resources, mode) {
  const resourceMap = new Map(resources.map((resource) => [resource.url, resource]));
  const parser = new DOMParser();
  const archiveDocument = parser.parseFromString(snapshot.html, "text/html");

  injectArchiveMetadata(archiveDocument, snapshot, resources);
  rewriteDocumentUrls(archiveDocument, resourceMap, mode, snapshot.baseUrl);
  removeExtensionScripts(archiveDocument);

  return `<!doctype html>\n${archiveDocument.documentElement.outerHTML}`;
}

function injectArchiveMetadata(archiveDocument, snapshot, resources) {
  const head = ensureHead(archiveDocument);
  const metadata = buildMetadata(snapshot, resources);
  const metadataScript = archiveDocument.createElement("script");
  metadataScript.type = "application/json";
  metadataScript.id = "web-scanner-metadata";
  metadataScript.textContent = JSON.stringify(metadata, null, 2);
  head.prepend(metadataScript);

  if (snapshot.readableText) {
    const readableText = archiveDocument.createElement("script");
    readableText.type = "text/plain";
    readableText.id = "web-scanner-readable-text";
    readableText.textContent = snapshot.readableText;
    head.prepend(readableText);
  }
}

function ensureHead(archiveDocument) {
  if (archiveDocument.head) {
    return archiveDocument.head;
  }
  const head = archiveDocument.createElement("head");
  archiveDocument.documentElement.prepend(head);
  return head;
}

function buildMetadata(snapshot, resources) {
  return {
    archivedBy: "Lossless Web Scanner",
    version: ARCHIVE_VERSION,
    archivedAt: new Date().toISOString(),
    url: snapshot.url,
    title: snapshot.title,
    baseUrl: snapshot.baseUrl,
    dimensions: snapshot.dimensions,
    resourceCount: resources.length,
    failedResources: resources
      .filter((resource) => !resource.ok)
      .map((resource) => ({
        url: resource.url,
        kind: resource.kind,
        error: resource.error
      }))
  };
}

function rewriteDocumentUrls(archiveDocument, resourceMap, mode, baseUrl) {
  rewriteUrlAttributes(archiveDocument, resourceMap, mode);
  rewriteStyleBlocks(archiveDocument, resourceMap, mode, baseUrl);
  rewriteInlineStyles(archiveDocument, resourceMap, mode, baseUrl);
}

function rewriteUrlAttributes(archiveDocument, resourceMap, mode) {
  const attributeNames = ["src", "href", "poster", "data"];

  for (const attributeName of attributeNames) {
    for (const element of archiveDocument.querySelectorAll(`[${attributeName}]`)) {
      const value = element.getAttribute(attributeName);
      const replacement = replacementForUrl(value, resourceMap, mode);
      if (replacement) {
        element.setAttribute(attributeName, replacement);
      }
    }
  }

  for (const element of archiveDocument.querySelectorAll("[srcset]")) {
    const rewritten = rewriteSrcset(element.getAttribute("srcset"), resourceMap, mode);
    if (rewritten) {
      element.setAttribute("srcset", rewritten);
    }
  }
}

function rewriteStyleBlocks(archiveDocument, resourceMap, mode, baseUrl) {
  for (const element of archiveDocument.querySelectorAll("style")) {
    element.textContent = rewriteCssReferences(element.textContent, baseUrl, (absoluteUrl) => {
      const resource = resourceMap.get(absoluteUrl);
      if (!resource?.ok) {
        return absoluteUrl;
      }
      return mode === "zip" ? resource.archivePath : resource.htmlDataUrl || absoluteUrl;
    });
  }
}

function rewriteInlineStyles(archiveDocument, resourceMap, mode, baseUrl) {
  for (const element of archiveDocument.querySelectorAll("[style]")) {
    element.setAttribute(
      "style",
      rewriteCssReferences(element.getAttribute("style"), baseUrl, (absoluteUrl) => {
        const resource = resourceMap.get(absoluteUrl);
        if (!resource?.ok) {
          return absoluteUrl;
        }
        return mode === "zip" ? resource.archivePath : resource.htmlDataUrl || absoluteUrl;
      })
    );
  }
}

function removeExtensionScripts(archiveDocument) {
  for (const script of archiveDocument.querySelectorAll("script")) {
    const src = script.getAttribute("src") || "";
    if (src.startsWith("chrome-extension://")) {
      script.remove();
    }
  }
}

function replacementForUrl(value, resourceMap, mode) {
  if (!value || value.startsWith("#") || /^(mailto|tel|javascript):/i.test(value)) {
    return null;
  }

  const resource = resourceMap.get(value.trim());
  if (!resource || !resource.ok) {
    return null;
  }

  if (mode === "zip") {
    return resource.archivePath;
  }

  return resource.htmlDataUrl || null;
}

function rewriteSrcset(srcset, resourceMap, mode) {
  if (!srcset) {
    return srcset;
  }

  return srcset
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const [url, ...descriptor] = trimmed.split(/\s+/);
      const replacement = replacementForUrl(url, resourceMap, mode);
      return [replacement || url, ...descriptor].join(" ");
    })
    .join(", ");
}

function rewriteCssReferences(cssText, baseUrl, replacer) {
  if (!cssText) {
    return cssText;
  }

  return cssText
    .replace(/url\((['"]?)(.*?)\1\)/g, (match, quote, rawUrl) => {
      const absoluteUrl = absoluteResourceUrl(rawUrl, baseUrl);
      if (!absoluteUrl) {
        return match;
      }
      const replacement = replacer(absoluteUrl, rawUrl);
      return `url(${quote}${replacement}${quote})`;
    })
    .replace(/@import\s+(url\()?(['"]?)([^"')\s]+)\2\)?/g, (match, urlPrefix, quote, rawUrl) => {
      const absoluteUrl = absoluteResourceUrl(rawUrl, baseUrl);
      if (!absoluteUrl) {
        return match;
      }
      const replacement = replacer(absoluteUrl, rawUrl);
      const wrapped = urlPrefix ? `url(${quote}${replacement}${quote})` : `${quote || "\""}${replacement}${quote || "\""}`;
      return `@import ${wrapped}`;
    });
}

function extractCssReferences(cssText, baseUrl) {
  const references = [];
  if (!cssText) {
    return references;
  }

  cssText.replace(/url\((['"]?)(.*?)\1\)/g, (_match, _quote, rawUrl) => {
    const url = absoluteResourceUrl(rawUrl, baseUrl);
    if (url) {
      references.push({ url, kind: cssText.includes("@font-face") ? "font" : "style-resource" });
    }
    return "";
  });

  cssText.replace(/@import\s+(?:url\()?["']?([^"')\s]+)["']?\)?/g, (_match, rawUrl) => {
    const url = absoluteResourceUrl(rawUrl, baseUrl);
    if (url) {
      references.push({ url, kind: "stylesheet", mimeHint: "text/css" });
    }
    return "";
  });

  return references;
}

function absoluteResourceUrl(value, baseUrl) {
  if (!value || value.startsWith("#") || /^(mailto|tel|javascript|blob):/i.test(value)) {
    return "";
  }
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function relativeArchivePath(fromPath, toPath) {
  const fromParts = fromPath.split("/");
  fromParts.pop();
  const toParts = toPath.split("/");

  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }

  return `${"../".repeat(fromParts.length)}${toParts.join("/")}`;
}

function isCssResource(resource) {
  return resource.kind === "stylesheet" || /(^|;)text\/css/i.test(resource.mimeType || "");
}

function decodeText(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function sanitizeFileName(input) {
  const cleaned = String(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  return cleaned || "web-archive";
}

function archiveBaseName(tab) {
  try {
    return sanitizeFileName(tab.title || new URL(tab.url).hostname);
  } catch {
    return "web-archive";
  }
}

function resourceArchivePath(url, index, kind, mimeType = "") {
  let extension = "";
  try {
    const parsed = new URL(url);
    extension = extensionFromPath(parsed.pathname);
  } catch {
    extension = "";
  }

  if (!extension) {
    extension = extensionForMime(mimeType) || extensionForKind(kind);
  }

  const safeIndex = String(index + 1).padStart(5, "0");
  return `resources/${safeIndex}${extension}`;
}

function extensionFromPath(pathname) {
  const match = pathname.match(/\.([a-z0-9]{1,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function extensionForKind(kind) {
  switch (kind) {
    case "stylesheet":
      return ".css";
    case "script":
      return ".js";
    case "font":
      return ".woff2";
    case "video":
      return ".mp4";
    case "audio":
      return ".mp3";
    case "image":
      return ".bin";
    default:
      return ".bin";
  }
}

function extensionForMime(mimeType) {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  switch (normalized) {
    case "text/css":
      return ".css";
    case "text/javascript":
    case "application/javascript":
      return ".js";
    case "text/html":
      return ".html";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    case "font/woff2":
      return ".woff2";
    case "font/woff":
      return ".woff";
    case "video/mp4":
      return ".mp4";
    case "audio/mpeg":
      return ".mp3";
    default:
      return "";
  }
}

function guessMimeType(url) {
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".js")) return "text/javascript";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

function parseDataUrl(url) {
  const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    return {
      mimeType: "application/octet-stream",
      bytes: new TextEncoder().encode(url)
    };
  }

  const mimeType = match[1] || "text/plain";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { mimeType, bytes };
}

function bytesToDataUrl(bytes, mimeType) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function setStage(message, progress) {
  stageElement.textContent = message;
  progressElement.value = progress;
}

function setPill(kind, label) {
  pillElement.className = `status-pill ${kind}`;
  pillElement.textContent = label;
}

function appendLog(message) {
  logElement.textContent = `${logElement.textContent}${logElement.textContent ? "\n" : ""}${message}`;
  logElement.scrollTop = logElement.scrollHeight;
}
