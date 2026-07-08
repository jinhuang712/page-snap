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
  assert.ok(win.__webScanner, "window.__webScanner should be defined");
  assert.equal(typeof win.__webScanner.collectPageSnapshot, "function");
});
