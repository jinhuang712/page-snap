(() => {
  if (window.__webScanner) {
    return;
  }

  window.__webScanner = {
    scrollFullPage,
    collectPageSnapshot,
    extractReadable
  };

  async function scrollFullPage(maxSteps, settleMs) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const originalX = window.scrollX;
    const originalY = window.scrollY;
    let previousHeight = 0;
    let stableSteps = 0;

    window.scrollTo(0, 0);
    await sleep(settleMs);

    for (let step = 0; step < maxSteps; step += 1) {
      const pageHeight = pageScrollHeight();
      const nextY = Math.min(window.scrollY + window.innerHeight * 0.85, pageHeight);
      window.scrollTo(0, nextY);
      await sleep(settleMs);

      const newHeight = pageScrollHeight();
      const reachedBottom = window.scrollY + window.innerHeight >= newHeight - 2;

      if (newHeight === previousHeight && reachedBottom) {
        stableSteps += 1;
      } else {
        stableSteps = 0;
      }

      previousHeight = newHeight;
      if (stableSteps >= 2) {
        break;
      }
    }

    window.scrollTo(originalX, originalY);
    await sleep(settleMs);
    return { ok: true };
  }

  function collectPageSnapshot(options) {
    try {
      const baseUrl = document.baseURI || location.href;
      const clone = document.documentElement.cloneNode(true);
      syncDynamicState(document, clone);
      replaceCanvasPixels(document, clone);
      const resourceUrls = collectResourceUrls(document, baseUrl);
      normalizeCloneUrls(clone, baseUrl);

      const readable = options.includeReadableText ? collectReadableContent(document) : emptyReadableContent();

      return {
        archiveVersion: options.archiveVersion,
        url: location.href,
        title: document.title,
        baseUrl,
        html: clone.outerHTML,
        readableText: readable.text,
        readableMarkdown: readable.markdown,
        readableMessages: readable.messages,
        dimensions: {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
          scrollHeight: pageScrollHeight()
        },
        resources: resourceUrls
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  function pageScrollHeight() {
    return Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
  }

  function collectResourceUrls(sourceDocument, baseUrl) {
    const resources = [];
    const add = (url, kind, mimeHint = "") => {
      const absoluteUrl = absoluteResourceUrl(url, baseUrl);
      if (!absoluteUrl) {
        return;
      }
      resources.push({ url: absoluteUrl, kind, mimeHint });
    };

    for (const element of sourceDocument.images) {
      add(element.currentSrc || element.src, "image");
      for (const candidate of parseSrcset(element.getAttribute("srcset"))) {
        add(candidate, "image");
      }
    }

    for (const source of sourceDocument.querySelectorAll("source[src], source[srcset]")) {
      add(source.getAttribute("src"), mediaKind(source));
      for (const candidate of parseSrcset(source.getAttribute("srcset"))) {
        add(candidate, mediaKind(source));
      }
    }

    for (const element of sourceDocument.querySelectorAll("link[href]")) {
      const rel = (element.getAttribute("rel") || "").toLowerCase();
      const preloadAs = (element.getAttribute("as") || "").toLowerCase();
      if (rel.includes("stylesheet")) {
        add(element.href, "stylesheet", "text/css");
      } else if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
        add(element.href, "image");
      } else if (rel.includes("preload") && ["font", "image", "style", "script"].includes(preloadAs)) {
        add(element.href, preloadAs === "style" ? "stylesheet" : preloadAs);
      }
    }

    for (const element of sourceDocument.scripts) {
      add(element.src, "script");
    }

    for (const element of sourceDocument.querySelectorAll("video[src], video[poster], audio[src], track[src], embed[src], object[data], iframe[src]")) {
      add(element.getAttribute("src"), mediaKind(element));
      add(element.getAttribute("poster"), "image");
      add(element.getAttribute("data"), "resource");
    }

    for (const element of sourceDocument.querySelectorAll("[style]")) {
      for (const url of extractCssUrls(element.getAttribute("style"))) {
        add(url, "style-resource");
      }
    }

    for (const style of sourceDocument.querySelectorAll("style")) {
      for (const url of extractCssUrls(style.textContent)) {
        add(url, "style-resource");
      }
    }

    for (const style of sourceDocument.styleSheets) {
      try {
        for (const rule of style.cssRules) {
          collectCssRuleResources(rule, add);
        }
      } catch {
        if (style.href) {
          add(style.href, "stylesheet", "text/css");
        }
      }
    }

    return resources;
  }

  function collectCssRuleResources(rule, add) {
    if (rule.href) {
      add(rule.href, "stylesheet", "text/css");
    }
    if (rule.style?.cssText) {
      for (const url of extractCssUrls(rule.style.cssText)) {
        add(url, "style-resource");
      }
    }
    if (rule.cssText) {
      for (const url of extractCssUrls(rule.cssText)) {
        add(url, rule.cssText.includes("@font-face") ? "font" : "style-resource");
      }
    }
    if (rule.cssRules) {
      for (const nestedRule of rule.cssRules) {
        collectCssRuleResources(nestedRule, add);
      }
    }
  }

  function syncDynamicState(sourceDocument, cloneRoot) {
    const sourceElements = sourceDocument.querySelectorAll("input, textarea, select, option, details");
    const cloneElements = cloneRoot.querySelectorAll("input, textarea, select, option, details");
    const count = Math.min(sourceElements.length, cloneElements.length);

    for (let index = 0; index < count; index += 1) {
      const source = sourceElements[index];
      const clone = cloneElements[index];
      const tagName = source.tagName.toLowerCase();

      if (tagName === "input") {
        if (source.type === "checkbox" || source.type === "radio") {
          clone.toggleAttribute("checked", source.checked);
        } else {
          clone.setAttribute("value", source.value);
        }
      } else if (tagName === "textarea") {
        clone.textContent = source.value;
      } else if (tagName === "option") {
        clone.toggleAttribute("selected", source.selected);
      } else if (tagName === "details") {
        clone.toggleAttribute("open", source.open);
      }
    }
  }

  function replaceCanvasPixels(sourceDocument, cloneRoot) {
    const sourceCanvases = sourceDocument.querySelectorAll("canvas");
    const cloneCanvases = cloneRoot.querySelectorAll("canvas");
    const count = Math.min(sourceCanvases.length, cloneCanvases.length);

    for (let index = 0; index < count; index += 1) {
      const source = sourceCanvases[index];
      const clone = cloneCanvases[index];
      try {
        const image = sourceDocument.createElement("img");
        image.src = source.toDataURL("image/png");
        image.width = source.width;
        image.height = source.height;
        image.setAttribute("data-web-scanner-canvas", "true");
        image.setAttribute("style", clone.getAttribute("style") || "");
        image.setAttribute("class", clone.getAttribute("class") || "");
        clone.replaceWith(image);
      } catch {
        clone.setAttribute("data-web-scanner-canvas", "unreadable");
      }
    }
  }

  function normalizeCloneUrls(root, baseUrl) {
    const attributeNames = ["src", "href", "poster", "data"];
    for (const attributeName of attributeNames) {
      for (const element of root.querySelectorAll(`[${attributeName}]`)) {
        const value = element.getAttribute(attributeName);
        const absolute = absoluteResourceUrl(value, baseUrl);
        if (absolute) {
          element.setAttribute(attributeName, absolute);
        }
      }
    }

    for (const element of root.querySelectorAll("[srcset]")) {
      element.setAttribute("srcset", normalizeSrcset(element.getAttribute("srcset"), baseUrl));
    }

    for (const element of root.querySelectorAll("[style]")) {
      element.setAttribute("style", normalizeCssUrls(element.getAttribute("style"), baseUrl));
    }

    for (const element of root.querySelectorAll("style")) {
      element.textContent = normalizeCssUrls(element.textContent, baseUrl);
    }
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

  function parseSrcset(srcset) {
    if (!srcset) {
      return [];
    }
    return srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function normalizeSrcset(srcset, baseUrl) {
    if (!srcset) {
      return "";
    }
    return srcset
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        const [url, ...descriptor] = trimmed.split(/\s+/);
        const absolute = absoluteResourceUrl(url, baseUrl) || url;
        return [absolute, ...descriptor].join(" ");
      })
      .join(", ");
  }

  function extractCssUrls(cssText) {
    const urls = [];
    if (!cssText) {
      return urls;
    }
    cssText.replace(/url\((['"]?)(.*?)\1\)/g, (_match, _quote, url) => {
      if (url && !url.startsWith("data:")) {
        urls.push(url);
      }
      return "";
    });
    return urls;
  }

  function normalizeCssUrls(cssText, baseUrl) {
    if (!cssText) {
      return cssText;
    }
    return cssText.replace(/url\((['"]?)(.*?)\1\)/g, (match, quote, url) => {
      const absolute = absoluteResourceUrl(url, baseUrl);
      if (!absolute) {
        return match;
      }
      return `url(${quote}${absolute}${quote})`;
    });
  }

  function mediaKind(element) {
    const tagName = element.tagName?.toLowerCase();
    if (tagName === "video") return "video";
    if (tagName === "audio") return "audio";
    if (tagName === "source") return element.closest("video") ? "video" : element.closest("audio") ? "audio" : "resource";
    return "resource";
  }

  function collectReadableContent(sourceDocument) {
    const lines = collectReadableLines(sourceDocument);
    const messages = parseConversationMessages(lines);
    return {
      text: lines.join("\n"),
      markdown: buildReadableMarkdown(sourceDocument, lines, messages),
      messages
    };
  }

  function emptyReadableContent() {
    return {
      text: "",
      markdown: "",
      messages: []
    };
  }

  function collectReadableLines(sourceDocument) {
    const root = readableRoot(sourceDocument);
    const walker = sourceDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        if (isNoisyTextNode(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const lines = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.replace(/\s+/g, " ").trim();
      if (text) {
        lines.push(text);
      }
    }

    return collapseRepeatedLines(lines);
  }

  function readableRoot(sourceDocument) {
    return (
      sourceDocument.querySelector("main article") ||
      sourceDocument.querySelector("article") ||
      sourceDocument.querySelector("main") ||
      sourceDocument.querySelector("[role='main']") ||
      sourceDocument.body ||
      sourceDocument.documentElement
    );
  }

  function isNoisyTextNode(element) {
    const tagName = element.tagName.toLowerCase();
    if (["script", "style", "noscript", "template", "nav", "header", "footer", "svg"].includes(tagName)) {
      return true;
    }
    if (element.closest("nav, header, footer, aside, menu, [role='navigation'], [aria-hidden='true']")) {
      return true;
    }
    const text = element.textContent.trim();
    if (text.length <= 2 && element.closest("button, [role='button'], a")) {
      return true;
    }
    return false;
  }

  function collapseRepeatedLines(lines) {
    const output = [];
    for (const line of lines) {
      if (output[output.length - 1] !== line) {
        output.push(line);
      }
    }
    return output;
  }

  function parseConversationMessages(lines) {
    const messages = [];
    let current = null;

    for (const line of lines) {
      const role = markerRole(line);
      if (role) {
        if (current && current.lines.length) {
          messages.push(finalizeMessage(current));
        }
        current = { role, lines: [] };
        continue;
      }

      if (!current) {
        current = { role: "content", lines: [] };
      }
      if (line === "Thought for a few seconds" || /^Thought for \d+s$/.test(line) || line === "Stopped thinking") {
        continue;
      }
      current.lines.push(line);
    }

    if (current && current.lines.length) {
      messages.push(finalizeMessage(current));
    }

    return messages;
  }

  function markerRole(line) {
    if (line === "You said:") {
      return "user";
    }
    if (line === "ChatGPT said:") {
      return "assistant";
    }
    return "";
  }

  function finalizeMessage(message) {
    return {
      role: message.role,
      text: message.lines.join("\n")
    };
  }

  function buildReadableMarkdown(sourceDocument, lines, messages) {
    const title = sourceDocument.title || "Untitled page";
    const url = location.href;
    const parts = [`# ${title}`, "", `Source: ${url}`, ""];

    if (messages.length >= 2) {
      for (const message of messages) {
        parts.push(`## ${message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Content"}`);
        parts.push("");
        parts.push(message.text);
        parts.push("");
      }
    } else {
      parts.push(lines.join("\n"));
      parts.push("");
    }

    return parts.join("\n").trim();
  }

  const SKIPPABLE_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);
  const BLOCK_TAGS = new Set([
    "p", "div", "section", "article", "aside", "li", "ul", "ol", "h1", "h2",
    "h3", "h4", "h5", "h6", "blockquote", "figure", "figcaption", "table",
    "tr", "td", "th", "thead", "tbody", "tfoot", "caption", "pre", "hr"
  ]);

  function extractReadable(rootNode) {
    const lines = [];
    let current = "";
    const flush = () => {
      const trimmed = current.trim();
      if (trimmed) lines.push(trimmed);
      current = "";
    };
    const walk = (node, isTopLevel) => {
      const type = node.nodeType;
      if (type === 3) {
        current += node.nodeValue.replace(/\s+/g, " ");
        return;
      }
      if (type !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (SKIPPABLE_TAGS.has(tag) || isInNoise(node)) return;
      if (tag === "pre") {
        flush();
        for (const line of node.textContent.split("\n")) lines.push(line);
        if (isTopLevel) lines.push("");
        return;
      }
      if (tag === "br") { flush(); return; }
      if (tag === "hr") { flush(); if (isTopLevel) lines.push(""); return; }
      const isBlock = BLOCK_TAGS.has(tag);
      if (isBlock) flush();
      for (const child of node.childNodes) walk(child, false);
      if (isBlock) {
        flush();
        if (isTopLevel) lines.push("");
      }
    };
    for (const child of rootNode.childNodes) walk(child, true);
    flush();
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function isInNoise(node) {
    let current = node;
    while (current && current.tagName) {
      const tag = current.tagName.toLowerCase();
      if (tag === "nav" || tag === "header" || tag === "footer" || tag === "aside" || tag === "menu") {
        return true;
      }
      if (current.getAttribute && (current.getAttribute("aria-hidden") === "true" || current.getAttribute("role") === "navigation")) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }
})();
