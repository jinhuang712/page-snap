# Agent-Readable Extraction

Last updated: 2026-07-09

## Overview

This specification governs the **derived agent-readable layer** of Lossless Web Scanner: the plain-text and structured-message outputs that accompany the HTML snapshot in Single HTML and Web Archive ZIP exports. The HTML snapshot (cloned DOM) is already lossless and AI-readable; this layer provides coding agents a lean, structured, non-garbled view of the same content.

The three export formats - MHTML, Single HTML, and Web Archive ZIP - are all retained. MHTML uses Chrome's native capture and carries no derived layer.

## Goals

1. **AI-readable, non-garbled output.** A coding agent opening the archive reads content clearly: code blocks with original newlines and indentation, block structure preserved, conversation turns clearly separated by role.
2. **General conversation detection.** Detect turns from DOM structure, not text markers. Cover ChatGPT, Claude, and Gemini; non-conversation pages yield an empty message list rather than a garbled blend.
3. **Non-destructive text extraction.** Walk the DOM element tree (not just text nodes); preserve `<pre>` verbatim; respect block boundaries; skip non-rendering subtrees. One extraction function serves both page-level text and per-message text.
4. **Retain all three export formats.** MHTML, Single HTML, and ZIP all stay.

## Non-goals

1. **No HTML-to-Markdown conversion.** No ` ``` ` fences, no `**`, no `#` headings. The HTML snapshot is the rich representation; the derived text is lean plain text. Markdown is an unnecessary middle layer between the two.
2. **No markdown syntax in plain-text output.** List items are not prefixed with `- `, headings are not prefixed with `#`, code blocks are not fenced. The text is plain but structured - line breaks, blank lines between blocks, verbatim code.
3. **No derived layer in MHTML.** MHTML stays as Chrome's native `pageCapture.saveAsMHTML` blob. No text or messages are injected.
4. **No removal of export formats.** All three formats (MHTML / Single HTML / ZIP) are retained.
5. **No richer per-message metadata this round.** Messages remain `{role, text}`. Timestamps, model identifiers, and token counts are out of scope and may be revisited later.

## Design

### Non-destructive text extraction

The extraction walks the readable-root subtree - selected via `main article` -> `article` -> `main` -> `[role='main']` -> `body` -> `documentElement` - and emits plain text with structure preserved:

| Node type | Behavior |
|-----------|----------|
| `<pre>` (and `<code>` within `<pre>`) | Emit `textContent` verbatim - newlines, indentation, and consecutive spaces are preserved. Do not descend into children individually. |
| Block elements (`p`, `div`, `section`, `article`, `li`, `h1`-`h6`, `blockquote`, `tr`, `td`, `ul`, `ol`, etc.) | Recurse into children, then emit a line break. A blank line separates top-level blocks. |
| `<br>` | Emit a line break. |
| Inline elements (`span`, `a`, `strong`, `em`, `code` not within `<pre>`, etc.) | Recurse into children; emit no break. |
| Text nodes (not within `<pre>`) | Collapse runs of spaces and tabs to a single space; do not alter newlines; trim at line boundaries. |
| `script`, `style`, `noscript`, `template`, `svg` | Skip the subtree. |
| Nodes within `nav`, `header`, `footer`, `aside`, `menu`, `[role='navigation']`, `[aria-hidden='true']` | Skip the subtree (noise filtering). |

The same extraction function produces both the page-level `text-content.txt` and each conversation message's `text`.

### Conversation detection

Detection runs on the live DOM (before cloning):

1. **Site-specific detection.** A configuration table maps each supported site (ChatGPT, Claude, Gemini) to a turn-container selector and a role-extraction rule (`user` / `assistant`). Detection logic reads only from this table, so adding or updating a site is a configuration change, not a code change. Selectors are verified against live pages during implementation (see Implementation Notes).
2. **No match.** `messages` is an empty array. The page is treated as a non-conversation page; `text-content.txt` is still produced from the whole readable root, so the content remains AI-readable - just not split into turns.

Each detected turn yields `{ role, text }`, where `text` is the non-destructive extraction (above) run on the turn's container.

A generic heuristic for unrecognized conversation sites is intentionally excluded: a fuzzy detector risks producing garbled or mis-attributed turns, which violates goal 1. Unknown sites degrade safely to an empty message list while their text remains fully readable via `text-content.txt` and the HTML snapshot.

### Output changes

| Output | Change |
|--------|--------|
| `text-content.md` | **Removed.** |
| `#web-scanner-readable-markdown` script embed (Single HTML) | **Removed.** |
| `text-content.txt` | **Regenerated** via non-destructive extraction. |
| `messages.json` | **Regenerated** via DOM-based detection. |
| `#web-scanner-readable-text`, `#web-scanner-readable-messages` script embeds (Single HTML) | **Retained**, regenerated. |
| `metadata.json` `readableText` | Updated to drop the markdown character count. |
| MHTML | **Unchanged.** |

## Implementation notes

- **Selector verification.** Site-specific conversation selectors are captured from live ChatGPT, Claude, and Gemini pages (or saved HTML) during implementation and maintained in the configuration table as sites evolve.
- **Code location.** The readable-extraction and conversation-detection logic lives in `content-snapshot.js`, replacing the existing readable-text functions, keeping a single injected file (no build step).
- **Testing.** Extend `tests/` with unit tests for the extraction walker (HTML-string inputs verifying `<pre>` preservation, block boundaries, and noise filtering) and conversation detection (synthetic fixtures per supported site). Follow the existing `node --test` convention and `npm run check`.
