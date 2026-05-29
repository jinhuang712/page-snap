# Lossless Web Scanner

Lossless Web Scanner is a small unpacked Chrome extension for saving the current page as:

- `MHTML` through Chrome's native page capture API.
- `Single HTML` with resources inlined as data URLs when they can be fetched.
- `Web Archive ZIP` with `index.html`, downloaded resources, `metadata.json`, `text-content.txt`, `text-content.md`, and `messages.json`.

The extension is built to avoid Chrome print/save information loss by scrolling long pages before capture and preserving readable page text for coding agents.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Choose this folder: `/Users/huangjin/dev/tools/web-scanner`.

The `.git` directory does not affect loading the extension. Chrome loads the unpacked extension from `manifest.json` and the listed extension files.

## Usage

1. Open the page you want to archive.
2. Click the **Web Scanner** extension icon.
3. Choose `MHTML`, `Single HTML`, or `Web Archive ZIP`.
4. Keep **Scroll full page first** enabled for long or lazy-loaded pages.
5. Click **Save current page**.

## Format Notes

### MHTML

MHTML uses Chrome's native `chrome.pageCapture.saveAsMHTML` API. This is the most faithful option for page state and browser-resolved resources, and should be the default when the goal is maximum visual fidelity.

### Single HTML

Single HTML snapshots the current DOM, collects images, stylesheets, scripts, fonts, media URLs, CSS `url(...)` references, and CSS `@import` references, then inlines fetched resources as data URLs. It also embeds agent-readable content in:

- `#web-scanner-readable-markdown` as `text/markdown`
- `#web-scanner-readable-text` as plain text
- `#web-scanner-readable-messages` as structured JSON role blocks

### Web Archive ZIP

Web Archive ZIP writes a portable archive with:

- `index.html`
- `metadata.json`
- `text-content.txt`
- `text-content.md`
- `messages.json`
- `resources/*`

The HTML points to files under `resources/`, making it easier for tools and coding agents to inspect both rendered HTML and extracted text.

## Limitations

- Browser extensions cannot archive internal Chrome pages such as `chrome://extensions`.
- Sites may block resource fetching through authentication, request policies, expiring URLs, or CORS behavior. Failed resources are listed in `metadata.json`.
- Canvas pixels, closed shadow DOM, DRM media, cross-origin iframes, and extension-restricted pages may not be fully reconstructable from script-visible DOM.
- MHTML generally gives the most faithful visual result, while ZIP and Single HTML are more inspectable for agents.
- ZIP uses store-only entries to keep the extension small and dependency-free. Archive size is close to the total captured resource size.
- Resource capture is capped at 1500 URLs per page to avoid runaway infinite-scroll or ad-heavy pages.

## Troubleshooting

If an MHTML download appears as `.txt`, inspect the first lines. A valid MHTML file starts with `From: <Saved by Blink>` and `Content-Type: multipart/related`. Version `0.1.1` wraps Chrome's native MHTML blob with `application/x-mimearchive` and a forced `.mhtml` filename to prevent Chrome/macOS from treating it as plain text.

For very large apps, Single HTML can be slow because every render resource must be fetched and inlined. Use MHTML for highest visual fidelity, and use Web Archive ZIP when a coding agent needs `text-content.txt`.

## Smoke Fixture

`test-fixtures/sample-page.html` is a local page for manual testing. Open it in Chrome, run each archive format, and confirm:

- MHTML downloads successfully.
- Single HTML opens without network access for the inline image and visible text.
- Web Archive ZIP contains `index.html`, `metadata.json`, `text-content.txt`, and `resources/*` when resources are present.

## Development

This project has no build step and no external runtime dependencies. Edit files directly and reload the unpacked extension in `chrome://extensions`.

Downloads default to the active tab title, preserving non-ASCII titles such as Chinese page names while filtering only filesystem-invalid characters.

Useful validation commands:

```sh
npm run check
```
