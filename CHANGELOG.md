# Changelog

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
