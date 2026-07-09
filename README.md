<p align="center"><img src="icons/icon-128.png" width="128" alt="PageSnap"></p>
<h1 align="center">PageSnap</h1>
<p align="center"><strong>Save any web page as a faithful, AI-readable archive.</strong></p>
<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Chrome Extension" src="https://img.shields.io/badge/Chrome-Extension-20232a?logo=googlechrome&logoColor=white">
  <img alt="No build step" src="https://img.shields.io/badge/no_build_step-yes-success.svg">
</p>

PageSnap is a small, dependency-free Chrome extension that captures the current page and packages it for coding agents and AI. It avoids the information loss of Chrome's built-in save/print by scrolling lazy-loaded content first and preserving the page's readable text alongside the snapshot.

## What you get

Three formats, all retained:

| Format | Contents |
|--------|----------|
| **MHTML** | Chrome's native, most visually faithful capture (single `.mhtml`). |
| **Single HTML** | One self-contained `.html` with resources inlined as data URLs, plus embedded readable text and messages. |
| **Web Archive ZIP** | A portable `.zip` with `index.html`, `metadata.json`, `text-content.txt`, `messages.json`, and a `resources/` folder. |

## Built for AI / coding agents

The ZIP and Single HTML exports carry an agent-readable layer a model can consume directly:

- **`text-content.txt`** — non-destructive plain text. Code blocks keep their original newlines and indentation; block structure and paragraph breaks are preserved. No markdown syntax, no mangled whitespace.
- **`messages.json`** — for AI-chat pages (ChatGPT, Claude), turns are split into `{role, text}` from the page's DOM structure, not fragile text markers. Other pages yield an empty list.
- The full rendered DOM lives in `index.html` — the rich, lossless view.

## Install

```sh
git clone https://github.com/jinhuang712/page-snap.git
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose the cloned `page-snap` folder.

## Usage

1. Open the page you want to archive.
2. Click the **PageSnap** toolbar icon.
3. Pick a format — MHTML, Single HTML, or Web Archive ZIP.
4. Keep **Scroll full page first** on for long or lazy-loaded pages.
5. Click **Save current page**.

## Limitations

- Extensions can't archive internal Chrome pages (e.g. `chrome://extensions`).
- Some resources can't be fetched (auth, CORS, expiring URLs, DRM media, cross-origin iframes, closed shadow DOM). Failed fetches are listed in `metadata.json`.
- MHTML gives the most faithful visual result; Single HTML / ZIP are more inspectable for agents.
- ZIP uses store-only entries to stay dependency-free, so archive size ≈ total captured resource size.
- Resource capture is capped at 1500 URLs per page.

## Development

No build step, no runtime dependencies (`jsdom` is a dev-only test dependency).

```sh
npm install     # installs jsdom for tests
npm run check   # syntax + node:test
```

Layout: `popup/` and `runner/` are the two extension UIs; `lib/` holds the content snapshot, readable extraction, and conversation detection; `tests/` covers the pure logic.

## License

MIT — see [LICENSE](LICENSE).
