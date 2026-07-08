# Agent-Readable Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the garbled derived text layer with non-destructive extraction and DOM-based conversation detection, dropping the fake markdown output.

**Architecture:** All logic stays in `lib/content-snapshot.js` (single injected file, no build step). New pure functions (`extractReadable`, `detectConversation`) are exposed on `window.__webScanner` so they can be unit-tested in jsdom by eval'ing the file. `runner/runner.js` drops the markdown file/embed and regenerates `.txt`/`messages.json` via the new functions.

**Tech Stack:** Manifest V3 Chrome extension, vanilla JS (no runtime deps), `node --test` for tests, `jsdom` as a devDependency (test-only; extension runtime stays zero-dependency).

**Spec:** `spec/agent-readable-extraction.md`

## Global Constraints

- No runtime dependencies; no build step. `jsdom` is a devDependency only (not shipped with the extension).
- Single injected content script: `lib/content-snapshot.js`. Do not split into multiple injected files.
- No markdown syntax anywhere in derived output (no ` ``` `, `**`, `#`, `- ` prefixes).
- `<pre>` content is always verbatim (newlines, indentation, consecutive spaces preserved).
- All three export formats (MHTML / Single HTML / ZIP) retained; MHTML unchanged.
- `npm run check` must stay green after every task.

---

## File Structure

- **Modify** `lib/content-snapshot.js` — replace `collectReadableLines`, `parseConversationMessages`, `buildReadableMarkdown`, `markerRole`, `finalizeMessage`, `collectReadableContent`, `emptyReadableContent`, `collapseRepeatedLines`, `isNoisyTextNode`, `readableRoot` with `extractReadable`, `detectConversation`, `SITE_CONFIGS`, and helpers. Expose `extractReadable` and `detectConversation` on `window.__webScanner`.
- **Modify** `runner/runner.js` — drop `text-content.md` from ZIP; drop `#web-scanner-readable-markdown` embed; update `metadata.json` `readableText` (remove `markdownChars`); drop `readableMarkdown` usage.
- **Modify** `package.json` — add `jsdom` devDependency; add new test file to `check`.
- **Create** `tests/readable-extract.test.mjs` — jsdom-backed tests for extraction + detection.
- **Modify** `README.md`, `CHANGELOG.md` — reflect dropped `.md` output and new extraction.

---

### Task 1: Test infrastructure

**Files:**
- Modify: `package.json`
- Create: `tests/readable-extract.test.mjs`

**Interfaces:**
- Produces: a `loadExtractor(html)` helper in the test file that returns a jsdom `window` with `lib/content-snapshot.js` evaluated, so `window.__webScanner` is available.

- [ ] **Step 1: Add jsdom devDependency and wire the new test into `check`**

Replace `package.json` with:

```json
{
  "name": "lossless-web-scanner",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "python3 -m json.tool manifest.json >/dev/null && node --check popup/popup.js && node --check runner/runner.js && node --check lib/content-snapshot.js && node --check lib/zip-store.js && node --check lib/archive-utils.js && node --test tests/zip-smoke.test.mjs tests/archive-utils.test.mjs tests/readable-extract.test.mjs && git diff --check"
  },
  "devDependencies": {
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 2: Install jsdom**

Run: `npm install`
Expected: `node_modules/jsdom` exists; `package-lock.json` created.

- [ ] **Step 3: Create the test harness with one passing smoke test**

Create `tests/readable-extract.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const sourcePath = fileURLToPath(new URL("../lib/content-snapshot.js", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

function loadExtractor(html) {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  dom.window.eval(source);
  return dom.window;
}

import { test } from "node:test";

test("harness loads webScanner onto the jsdom window", () => {
  const win = loadExtractor("<!doctype html><html><body><p>hi</p></body></html>");
  assert.equal(typeof win.__webScanner.extractReadable, "function");
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run check`
Expected: all tests pass, including the new harness test. (Note: `extractReadable` does not exist yet on `window.__webScanner` — see Task 2. If this test fails because `extractReadable` is undefined, that is expected until Task 2 Step 2; proceed to Task 2 and return.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/readable-extract.test.mjs
git commit -m "test: add jsdom harness for readable extraction"
```

---

### Task 2: Non-destructive text extraction

**Files:**
- Modify: `lib/content-snapshot.js` (add `extractReadable` + helpers; expose on `window.__webScanner`)
- Test: `tests/readable-extract.test.mjs`

**Interfaces:**
- Produces: `window.__webScanner.extractReadable(rootNode: Node): string` — plain text with `<pre>` verbatim, blocks on separate lines, noise subtrees skipped.

- [ ] **Step 1: Write failing tests for extraction**

Append to `tests/readable-extract.test.mjs` (before any later appends; keep the `test` import and `loadExtractor` already present):

```js
test("extractReadable preserves <pre> newlines and indentation", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><pre>def f():
  return 1</pre></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "def f():\n  return 1");
});

test("extractReadable collapses non-pre whitespace to single spaces", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><p>Hello   world
    across lines</p></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Hello world across lines");
});

test("extractReadable puts block elements on separate lines", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><h1>Title</h1><p>One</p><p>Two</p></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Title\n\nOne\n\nTwo");
});

test("extractReadable skips nav and script subtrees", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><nav>Menu</nav><p>Body</p><script>x()</script></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Body");
});

test("extractReadable keeps list items on separate lines without markdown markers", () => {
  const win = loadExtractor(`<!doctype html><body>
    <main><ul><li>Apple</li><li>Banana</li></ul></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Apple\n\nBanana");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/readable-extract.test.mjs`
Expected: FAIL — `win.__webScanner.extractReadable` is `undefined`.

- [ ] **Step 3: Implement `extractReadable` and expose it**

In `lib/content-snapshot.js`, add these functions inside the IIFE (before the closing `})()`), and add `extractReadable` to the `window.__webScanner` object:

```js
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
    let parent = node.parentElement;
    while (parent) {
      const tag = parent.tagName.toLowerCase();
      if (tag === "nav" || tag === "header" || tag === "footer" || tag === "aside" || tag === "menu") {
        return true;
      }
      if (parent.getAttribute && (parent.getAttribute("aria-hidden") === "true" || parent.getAttribute("role") === "navigation")) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }
```

Update the `window.__webScanner` assignment at the top of the IIFE to:

```js
  window.__webScanner = {
    scrollFullPage,
    collectPageSnapshot,
    extractReadable
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/readable-extract.test.mjs`
Expected: all extraction tests PASS.

- [ ] **Step 5: Run full check**

Run: `npm run check`
Expected: PASS (all existing + new tests, syntax checks, git diff clean).

- [ ] **Step 6: Commit**

```bash
git add lib/content-snapshot.js tests/readable-extract.test.mjs
git commit -m "feat: non-destructive readable text extraction"
```

---

### Task 3: Conversation detection

**Files:**
- Modify: `lib/content-snapshot.js` (add `SITE_CONFIGS`, `detectConversation`; expose on `window.__webScanner`)
- Test: `tests/readable-extract.test.mjs`

**Interfaces:**
- Produces: `window.__webScanner.detectConversation(rootNode: Node, configs?: Array): Array<{role, text}>`. `configs` defaults to the module-level `SITE_CONFIGS` table; passing a synthetic config is how tests exercise the mechanism deterministically.
- Consumes: `extractReadable` from Task 2 (used per turn).

- [ ] **Step 1: Write failing tests for the detection mechanism**

Append to `tests/readable-extract.test.mjs`:

```js
test("detectConversation splits turns by role using a config", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main>
      <div data-turn data-role="user">What is 1+1?</div>
      <div data-turn data-role="assistant">It is 2.</div>
    </main></body></html>`);
  const config = { name: "s", urlMatch: /.*/, turnSelector: "[data-turn]", roleFrom: (el) => el.getAttribute("data-role") };
  const messages = win.__webScanner.detectConversation(win.document.querySelector("main"), [config]);
  assert.deepEqual(messages, [
    { role: "user", text: "What is 1+1?" },
    { role: "assistant", text: "It is 2." }
  ]);
});

test("detectConversation returns empty array when no config matches", () => {
  const win = loadExtractor(`<!doctype html><html><body><main><p>not a chat</p></main></body></html>`);
  assert.deepEqual(win.__webScanner.detectConversation(win.document.querySelector("main"), []), []);
});

test("detectConversation preserves code inside an assistant turn", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main>
      <div data-turn data-role="user">show code</div>
      <div data-turn data-role="assistant"><pre>const x = 1;
const y = 2;</pre></div>
    </main></body></html>`);
  const config = { name: "s", urlMatch: /.*/, turnSelector: "[data-turn]", roleFrom: (el) => el.getAttribute("data-role") };
  const messages = win.__webScanner.detectConversation(win.document.querySelector("main"), [config]);
  assert.equal(messages[1].text, "const x = 1;\nconst y = 2;");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/readable-extract.test.mjs`
Expected: FAIL - `win.__webScanner.detectConversation` is `undefined`.

- [ ] **Step 3: Implement `SITE_CONFIGS` and `detectConversation`; expose it**

Add inside the `lib/content-snapshot.js` IIFE (after `extractReadable`/`isInNoise` from Task 2):

```js
  const SITE_CONFIGS = [
    {
      name: "chatgpt",
      urlMatch: /chatgpt\.com|chat\.openai\.com/,
      turnSelector: "article[data-testid^='conversation-turn-']",
      roleFrom: (el) => {
        const node = el.querySelector("[data-message-author-role]") || el;
        const role = node.getAttribute("data-message-author-role");
        return role === "user" ? "user" : role === "assistant" ? "assistant" : null;
      }
    },
    {
      name: "claude",
      urlMatch: /claude\.ai/,
      turnSelector: "[data-testid='user-message'], [data-testid='assistant-message']",
      roleFrom: (el) => {
        const id = el.getAttribute("data-testid");
        return id === "user-message" ? "user" : id === "assistant-message" ? "assistant" : null;
      }
    }
  ];

  function detectConversation(rootNode, configs = SITE_CONFIGS) {
    const doc = rootNode.ownerDocument || document;
    const url = doc.location ? doc.location.href : (typeof location !== "undefined" ? location.href : "");
    for (const config of configs) {
      if (!config.urlMatch.test(url)) continue;
      const turns = rootNode.querySelectorAll(config.turnSelector);
      if (!turns.length) continue;
      const messages = [];
      for (const turn of turns) {
        const role = config.roleFrom(turn);
        if (!role) continue;
        messages.push({ role, text: extractReadable(turn) });
      }
      if (messages.length) return messages;
    }
    return [];
  }
```

Update the `window.__webScanner` assignment to:

```js
  window.__webScanner = {
    scrollFullPage,
    collectPageSnapshot,
    extractReadable,
    detectConversation
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/readable-extract.test.mjs`
Expected: all detection tests PASS.

- [ ] **Step 5: Run full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/content-snapshot.js tests/readable-extract.test.mjs
git commit -m "feat: DOM-based conversation detection"
```

- [ ] **Step 7: Verify site selectors against live pages (manual)**

The `SITE_CONFIGS` selectors above are best-known starting points and must be confirmed against real DOM. For each site (ChatGPT at `chatgpt.com`, Claude at `claude.ai`): open a conversation, save a Web Archive ZIP, open `messages.json`, and confirm turns are split with correct roles. If empty or mis-attributed, inspect the page DOM (DevTools Elements panel), update the matching `turnSelector` / `roleFrom` in `SITE_CONFIGS`, and re-test. Add a Gemini entry (`urlMatch: /gemini\.google\.com/`) once its turn-container selector and role signal are captured the same way. No commit needed if selectors were already correct; commit any fixes as `fix: update conversation selectors for <site>`.

---

### Task 4: Wire extraction into `collectPageSnapshot`; remove dead readable-text code

**Files:**
- Modify: `lib/content-snapshot.js`

**Interfaces:**
- Produces: `collectPageSnapshot` return object no longer has `readableMarkdown`; `readableText` and `readableMessages` come from the new functions. Downstream (`runner/runner.js`) must stop reading `readableMarkdown` (Task 5).

- [ ] **Step 1: Rewrite `collectPageSnapshot` to use the new functions**

Replace the existing `collectPageSnapshot` function body with:

```js
  function collectPageSnapshot(options) {
    try {
      const baseUrl = document.baseURI || location.href;
      const clone = document.documentElement.cloneNode(true);
      syncDynamicState(document, clone);
      replaceCanvasPixels(document, clone);
      const resourceUrls = collectResourceUrls(document, baseUrl);
      normalizeCloneUrls(clone, baseUrl);
      const root = readableRoot(document);
      const includeReadable = Boolean(options.includeReadableText);
      return {
        archiveVersion: options.archiveVersion,
        url: location.href,
        title: document.title,
        baseUrl,
        html: clone.outerHTML,
        readableText: includeReadable ? extractReadable(root) : "",
        readableMessages: includeReadable ? detectConversation(root) : [],
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
```

- [ ] **Step 2: Delete the now-dead readable-text functions**

Remove these functions entirely from `lib/content-snapshot.js`: `collectReadableContent`, `emptyReadableContent`, `collectReadableLines`, `parseConversationMessages`, `markerRole`, `finalizeMessage`, `buildReadableMarkdown`, `collapseRepeatedLines`, `isNoisyTextNode`. Keep `readableRoot` (still used above) and `pageScrollHeight`.

- [ ] **Step 3: Verify syntax and tests**

Run: `npm run check`
Expected: PASS (note: `runner/runner.js` still references `snapshot.readableMarkdown`, but `node --check` only checks syntax, not references, so this passes; Task 5 removes those references).

- [ ] **Step 4: Commit**

```bash
git add lib/content-snapshot.js
git commit -m "refactor: wire non-destructive extraction into collectPageSnapshot"
```

---

### Task 5: Drop markdown output from `runner/runner.js`

**Files:**
- Modify: `runner/runner.js`

- [ ] **Step 1: Remove the `text-content.md` entry from the ZIP files list**

In `saveZipArchive` (`runner/runner.js:147`), delete this object from the `files` array:

```js
    {
      path: "text-content.md",
      data: new TextEncoder().encode(snapshot.readableMarkdown || snapshot.readableText || "")
    },
```

- [ ] **Step 2: Remove the markdown script embed from `injectArchiveMetadata`**

In `injectArchiveMetadata` (`runner/runner.js:385`), delete this entire block:

```js
  if (snapshot.readableMarkdown) {
    const readableMarkdown = archiveDocument.createElement("script");
    readableMarkdown.type = "text/markdown";
    readableMarkdown.id = "web-scanner-readable-markdown";
    readableMarkdown.textContent = snapshot.readableMarkdown;
    head.prepend(readableMarkdown);
  }

```

- [ ] **Step 3: Drop `markdownChars` from `buildMetadata`**

In `buildMetadata` (`runner/runner.js:428`), replace the `readableText` block:

```js
    readableText: {
      textChars: snapshot.readableText?.length || 0,
      markdownChars: snapshot.readableMarkdown?.length || 0,
      messages: snapshot.readableMessages?.length || 0
    },
```

with:

```js
    readableText: {
      textChars: snapshot.readableText?.length || 0,
      messages: snapshot.readableMessages?.length || 0
    },
```

- [ ] **Step 4: Verify no remaining `readableMarkdown` references**

Run: `grep -n "readableMarkdown\|text-content.md\|web-scanner-readable-markdown" runner/runner.js`
Expected: no output.

- [ ] **Step 5: Run full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add runner/runner.js
git commit -m "feat: drop markdown output from archives"
```

---

### Task 6: Update docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update README**

In `README.md`:
- Line 7 (ZIP description): change `index.html, downloaded resources, metadata.json, text-content.txt, text-content.md, and messages.json` to `index.html, downloaded resources, metadata.json, text-content.txt, and messages.json`.
- Single HTML section (lines 36-41): delete the bullet `- #web-scanner-readable-markdown as text/markdown`.
- Web Archive ZIP section (lines 44-52): delete the line `- text-content.md`.

- [ ] **Step 2: Add CHANGELOG entry**

Prepend to `CHANGELOG.md`:

```markdown
## 0.3.0 - 2026-07-09

- Replaced lossy readable-text extraction with non-destructive extraction that preserves code-block newlines and indentation and block structure.
- Replaced hardcoded ChatGPT text-marker conversation detection with DOM-based detection covering ChatGPT and Claude (config-driven; extensible to other sites).
- Removed `text-content.md` and the Single HTML markdown embed; the HTML snapshot is the rich representation and `text-content.txt` is the lean plain-text view.
```

Also bump `"version"` in `manifest.json` and `package.json` from `0.2.0` to `0.3.0`.

- [ ] **Step 3: Run full check and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add README.md CHANGELOG.md manifest.json package.json
git commit -m "docs: update for non-destructive extraction and markdown removal"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (AI-readable, non-garbled): Task 2 (extraction preserves `<pre>`, blocks, noise filtering).
- Goal 2 (general conversation detection): Task 3 (DOM-based, config-driven, ChatGPT + Claude + Gemini-via-capture).
- Goal 3 (non-destructive extraction, one function): Task 2 + Task 4 (shared by page text and per-message text).
- Goal 4 (retain formats): no format removed; MHTML untouched.
- Non-goal 1/2 (no markdown): Task 5 removes markdown output; extraction emits plain text only.
- Non-goal 3 (no derived layer in MHTML): MHTML path (`saveMhtml`) untouched.
- Non-goal 5 (messages stay `{role, text}`): Task 3 produces exactly that shape.
- Output changes table: Task 4 (snapshot fields), Task 5 (runner outputs + metadata), Task 6 (docs).
- Implementation notes (selector verification, code location in `lib/content-snapshot.js`, `node --test`): Tasks 1, 3 Step 7, throughout.

**Placeholder scan:** Site selectors in `SITE_CONFIGS` are concrete starting values with a mandatory live-verification step (Task 3 Step 7), not placeholders. Gemini is explicitly added during that verification step (its DOM is opaque and must be captured live). No TBD/TODO elsewhere.

**Type consistency:** `extractReadable(rootNode): string` and `detectConversation(rootNode, configs?): Array<{role, text}>` signatures are consistent across Tasks 2, 3, 4. `window.__webScanner` exports updated once in Task 2 and again in Task 3 (additive). `collectPageSnapshot` drops `readableMarkdown` in Task 4; Task 5 removes all `readableMarkdown` readers in `runner/runner.js`.
