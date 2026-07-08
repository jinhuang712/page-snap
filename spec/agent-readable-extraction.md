# Agent-Readable Extraction

Last updated: 2026-07-09

## Overview

Governs the derived agent-readable layer (`text-content.txt`, `messages.json`) in Single HTML and ZIP exports. The HTML snapshot is already lossless; this layer is the lean view for coding agents. All three formats retained; MHTML has no derived layer.

## Goals

1. **AI-readable, non-garbled.** Code blocks keep newlines and indentation; block structure preserved; conversation turns separated by role.
2. **General conversation detection from DOM.** Cover ChatGPT, Claude, Gemini; non-conversation pages yield empty `messages`.
3. **Non-destructive extraction.** Walk the DOM element tree, preserve `<pre>` verbatim. One function serves page-level text and per-message text.
4. **Retain MHTML, Single HTML, ZIP.**

## Non-goals

1. **No HTML-to-Markdown conversion.**
2. **No markdown syntax in plain text** - no list markers, heading hashes, or code fences. Plain but structured (line breaks, blank lines, verbatim code).
3. **No derived layer in MHTML.**
4. **No format removal.**
5. **No per-message metadata this round** - messages stay `{role, text}`.

## Design

### Text extraction

Walk the readable root (`main article` -> `article` -> `main` -> `[role='main']` -> `body` -> `documentElement`):

| Node | Behavior |
|------|----------|
| `<pre>` (and `<code>` within) | `textContent` verbatim; do not descend. |
| Block (`p`, `div`, `li`, `h1`-`h6`, `blockquote`, `tr`, `ul`, etc.) | Recurse, then line break. Blank line between top-level blocks. |
| `<br>` | Line break. |
| Inline (`span`, `a`, `strong`, `em`, `code` outside `<pre>`) | Recurse, no break. |
| Text node (outside `<pre>`) | Collapse spaces/tabs to one; trim line edges. |
| `script`, `style`, `noscript`, `template`, `svg` | Skip. |
| Inside `nav`, `header`, `footer`, `aside`, `menu`, `[role='navigation']`, `[aria-hidden='true']` | Skip (noise filter). |

### Conversation detection

On the live DOM, before cloning:

1. **Site-specific.** A config table maps ChatGPT/Claude/Gemini to a turn-container selector and role rule (`user`/`assistant`). Adding a site is a config change.
2. **No match.** `messages` = `[]`; `text-content.txt` still produced from the whole root.

Each turn: `{ role, text }` where `text` is the extraction above run on the turn container.

Generic heuristic for unknown sites is excluded - risks garbled turns. Unknown sites degrade to empty `messages` with text still fully readable.

### Output changes

| Output | Change |
|--------|--------|
| `text-content.md` + `#web-scanner-readable-markdown` embed | Removed |
| `text-content.txt` | Regenerated (non-destructive) |
| `messages.json` + `#web-scanner-readable-text` / `#web-scanner-readable-messages` embeds | Regenerated (DOM-based) |
| `metadata.json` `readableText` | Drop markdown char count |
| MHTML | Unchanged |

## Implementation notes

- Site selectors captured from live ChatGPT/Claude/Gemini pages during implementation; maintained in the config table.
- Logic lives in `content-snapshot.js`, replacing existing readable-text functions; single injected file, no build step.
- Tests via `node --test` / `npm run check`: extraction walker (HTML fixtures for `<pre>`, blocks, noise) and conversation detection (synthetic per-site fixtures).
