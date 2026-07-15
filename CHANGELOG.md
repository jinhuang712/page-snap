# Changelog

## 0.3.1 - 2026-07-15

- Fixed format segment buttons (MHTML/HTML/ZIP) not responding under MV3 Content Security Policy by moving the inline sync script into `popup.js`.
- Added Chinese/English language toggle in the popup.
- Added breathing room between option toggles.
- Added a downloadable `pagesnap.zip` linked from the landing pages; install steps rewritten with icons and a direct `chrome://extensions` link.

## 0.3.0 - 2026-07-09

- Replaced lossy readable-text extraction with non-destructive extraction that preserves code-block newlines and indentation and block structure.
- Replaced hardcoded ChatGPT text-marker conversation detection with DOM-based detection covering ChatGPT and Claude (config-driven; extensible to other sites).
- Removed `text-content.md` and the Single HTML markdown embed; the HTML snapshot is the rich representation and `text-content.txt` is the lean plain-text view.

## 0.2.0 - 2026-05-30

- Added agent-readable Markdown and structured message JSON to Single HTML exports.
- Added `text-content.md` and `messages.json` to Web Archive ZIP exports.
- Changed default download names to preserve the active tab title, including non-ASCII titles, while filtering only filesystem-invalid characters.

## 0.1.1 - 2026-05-30

- Fixed MHTML downloads being treated as plain text by wrapping native Chrome output as `application/x-mimearchive`.
- Improved Single HTML and ZIP speed with concurrent resource fetching.
- Skipped non-rendering link hints such as `preconnect`, `dns-prefetch`, and `alternate` during resource capture.
- Improved readable text extraction by preferring main article content and filtering navigation noise.

## 0.1.0 - 2026-05-29

- Added a Manifest V3 Chrome extension that can save the active page as MHTML, Single HTML, or Web Archive ZIP.
- Added full-page pre-scroll to trigger lazy-loaded content before capture.
- Added DOM snapshot export with resource collection, readable text metadata, CSS reference rewriting, and dependency-free ZIP packaging.
- Added direct Chrome unpacked install instructions.
- Added local smoke fixture and validation script.
