# Agent-Readable Extraction — Goals & Non-Goals

Date: 2026-07-09
Status: Draft (design in progress)

## Context

Lossless Web Scanner captures the active page as MHTML, Single HTML, or Web Archive ZIP. The **HTML snapshot** (cloned DOM, `content-snapshot.js:63`) is already lossless and AI-readable — an agent can parse it directly.

The **derived agent-readable layer** is where the current implementation is lossy and garbled:

- `text-content.txt` — page-level plain text
- `text-content.md` — page-level "markdown" (Single HTML + ZIP)
- `messages.json` — structured conversation turns (ZIP; also embedded in Single HTML)

This spec covers the redesign of that derived layer. The three export formats (MHTML, Single HTML, ZIP) are all retained.

## Problems with the current derived layer

1. **Code blocks are mangled.** `collectReadableLines` (`content-snapshot.js:359`) applies `replace(/\s+/g, " ")` to every text node, collapsing newlines and indentation inside `<pre><code>` into single spaces. Code is often the most valuable content on an AI-conversation page.
2. **Conversation detection is hardcoded to ChatGPT.** `markerRole` (`content-snapshot.js:434`) only recognizes the literal text `You said:` / `ChatGPT said:`. Claude, Gemini, and non-English ChatGPT are not detected; user and assistant turns blend together.
3. **No real "is this a conversation" detection.** `buildReadableMarkdown` (`content-snapshot.js:456`) uses `messages.length >= 2` as a proxy, which in practice means "is this a ChatGPT page."
4. **Markdown output is fake.** `text-content.md` is flattened text with `## User` / `## Assistant` headers, not real markdown — the assistant's formatting (code, lists, links) is already destroyed before it is rendered.
5. **`collapseRepeatedLines` crosses message boundaries** (`content-snapshot.js:394`), dropping legitimate repeated content.
6. **"Thought for X seconds" filtering is also ChatGPT-specific** (`content-snapshot.js:421`).

**Root cause:** the pipeline flattens the DOM to a one-dimensional text array first, then tries to recover conversation structure from that text — discarding the very DOM structure that would make robust detection possible. Hardcoded markers are a symptom of this architectural choice.

## Goals

1. **AI-readable, non-garbled output.** A coding agent opening the archive must be able to read the content clearly: code blocks with original newlines and indentation, block structure preserved, conversation turns clearly separated by role.
2. **General conversation detection.** Detect conversation turns from DOM structure, not hardcoded text markers. Cover major AI-chat sites (ChatGPT, Claude, Gemini) with a generic fallback; non-conversation pages produce an empty message list rather than a garbled blend.
3. **Non-destructive text extraction.** Walk the DOM element tree (not just text nodes); preserve `<pre>` content verbatim; respect block-element boundaries; skip non-rendering subtrees. One extraction function serves both page-level text and per-message text.
4. **Retain all three export formats.** MHTML, Single HTML, and ZIP all stay. MHTML continues to use Chrome's native capture without a derived layer.

## Non-goals

1. **No HTML-to-Markdown conversion.** We do not convert `<pre>` to ` ``` ` fences, `<strong>` to `**`, `<h1>` to `#`, etc. The HTML snapshot is the rich representation; the derived text is lean plain text. Markdown is an unnecessary middle layer between the two.
2. **No markdown syntax in the plain-text output.** List items are not prefixed with `- `, headings are not prefixed with `#`, code blocks are not fenced. The text is plain but structured — line breaks, blank lines between blocks, verbatim code. (Follows directly from non-goal 1.)
3. **No derived layer in MHTML.** MHTML stays as Chrome's native `pageCapture.saveAsMHTML` blob. No text/messages injection.
4. **No removal of export formats.** All three formats (MHTML / Single HTML / ZIP) are retained.
5. **No richer per-message metadata this round.** Messages remain `{role, text}`. Timestamps, model identifiers, and token counts are out of scope for now (may be revisited later).

## Agreed direction (high level)

- **Drop** `text-content.md` and the Single HTML `#web-scanner-readable-markdown` script embed.
- **Keep** `text-content.txt` — now produced by non-destructive extraction.
- **Keep** `messages.json` — now produced by DOM-based conversation detection with non-destructive per-message text.
- **MHTML** unchanged (native capture, no derived layer).
- **metadata.json** `readableText` stats updated to reflect the new outputs.

## Open design questions (in progress)

1. **Non-destructive extraction algorithm.** Exact DOM-walk: `<pre>` verbatim, block elements emit children + line break, `<br>` emits line break, inline elements recurse, text nodes collapse only inline whitespace. *Presented, pending confirmation.*
2. **Conversation detection.** Which sites to cover, which DOM signals to use, how the generic fallback works, and behavior when a page is not recognized. *Not yet presented.*

## Out of scope

- Changes to MHTML capture, resource fetching, ZIP packaging, or URL rewriting — those paths are sound and unaffected.
- Reverse-rendering HTML back to original markdown source (some UIs expose raw markdown in data attributes); not pursued given non-goal 1.
