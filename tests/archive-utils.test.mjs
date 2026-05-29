import assert from "node:assert/strict";
import { sanitizeFileName } from "../archive-utils.js";

assert.equal(sanitizeFileName("两国战争推演"), "两国战争推演");
assert.equal(sanitizeFileName("A/B:C*D?E"), "A-B-C-D-E");
assert.equal(sanitizeFileName("   spaced   title   "), "spaced title");
assert.equal(sanitizeFileName("////"), "web-archive");
