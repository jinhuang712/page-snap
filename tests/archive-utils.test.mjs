import assert from "node:assert/strict";
import { sanitizeFileName } from "../lib/archive-utils.js";

const utf8Bytes = (value) => new TextEncoder().encode(value).length;
// In /u mode a valid surrogate pair is one code point, so \p{Cs} only matches
// an unpaired (lone) surrogate — exactly what a bad truncation would leave.
const hasLoneSurrogate = (value) => /\p{Cs}/u.test(value);

assert.equal(sanitizeFileName("两国战争推演"), "两国战争推演");
assert.equal(sanitizeFileName("A/B:C*D?E"), "A-B-C-D-E");
assert.equal(sanitizeFileName("   spaced   title   "), "spaced title");
assert.equal(sanitizeFileName("////"), "web-archive");

// Trailing dots/spaces make Chrome reject the filename component.
assert.equal(sanitizeFileName("report. "), "report");
assert.equal(sanitizeFileName("draft..."), "draft");

// Long CJK title: 200 chars = 600 UTF-8 bytes, must fit Chrome's byte budget.
const longCjk = sanitizeFileName("档".repeat(200));
assert.ok(utf8Bytes(longCjk) <= 200, `CJK base name too long: ${utf8Bytes(longCjk)} bytes`);
assert.ok(!/[-\s.]$/.test(longCjk), "truncated CJK name must not end in dot/space/dash");
assert.ok(!hasLoneSurrogate(longCjk), "CJK truncation produced a lone surrogate");

// Emoji are surrogate pairs (4 UTF-8 bytes): truncation must not split one.
const longEmoji = sanitizeFileName("🚀".repeat(100));
assert.ok(utf8Bytes(longEmoji) <= 200, `emoji base name too long: ${utf8Bytes(longEmoji)} bytes`);
assert.ok(!hasLoneSurrogate(longEmoji), "emoji truncation produced a lone surrogate");

// 66×"档" = 198 bytes, then a space lands at byte 199 — the cut leaves a
// trailing space that the post-truncation strip must remove.
const cutAtSpace = sanitizeFileName("档".repeat(66) + " 尾");
assert.equal(cutAtSpace, "档".repeat(66));
assert.ok(!/[-\s.]$/.test(cutAtSpace), "post-truncation name must not end in dot/space/dash");

console.log("archive-utils tests passed");
