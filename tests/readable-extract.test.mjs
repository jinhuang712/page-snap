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

test("extractReadable preserves <pre> newlines and indentation", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><pre>def f():
  return 1</pre></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "def f():\n  return 1");
});

test("extractReadable collapses non-pre whitespace to single spaces", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><p>Hello   world
    across lines</p></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Hello world across lines");
});

test("extractReadable puts block elements on separate lines", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><h1>Title</h1><p>One</p><p>Two</p></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Title\n\nOne\n\nTwo");
});

test("extractReadable skips nav and script subtrees", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main><nav>Menu</nav><p>Body</p><script>x()</script></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Body");
});

test("extractReadable keeps list items on separate lines without markdown markers", () => {
  const win = loadExtractor(`<!doctype html><body>
    <main><ul><li>Apple</li><li>Banana</li></ul></main>
  </body></html>`);
  const text = win.__webScanner.extractReadable(win.document.querySelector("main"));
  assert.equal(text, "Apple\nBanana");
});

test("detectConversation splits turns by role using a config", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main>
      <div data-turn data-role="user">What is 1+1?</div>
      <div data-turn data-role="assistant">It is 2.</div>
    </main></body></html>`);
  const config = { name: "s", urlMatch: /.*/, turnSelector: "[data-turn]", roleFrom: (el) => el.getAttribute("data-role") };
  const messages = win.__webScanner.detectConversation(win.document.querySelector("main"), [config]);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { role: "user", text: "What is 1+1?" },
    { role: "assistant", text: "It is 2." }
  ]);
});

test("detectConversation returns empty array when no config matches", () => {
  const win = loadExtractor(`<!doctype html><html><body><main><p>not a chat</p></main></body></html>`);
  assert.deepEqual(JSON.parse(JSON.stringify(win.__webScanner.detectConversation(win.document.querySelector("main"), []))), []);
});

test("detectConversation preserves code inside an assistant turn", () => {
  const win = loadExtractor(`<!doctype html><html><body>
    <main>
      <div data-turn data-role="user">show code</div>
      <div data-turn data-role="assistant"><pre>const x = 1;
const y = 2;</pre></div>
    </main></body></html>`);
  const config = { name: "s", urlMatch: /.*/, turnSelector: "[data-turn]", roleFrom: (el) => el.getAttribute("data-role") };
  const messages = win.__webScanner.detectConversation(win.document.querySelector("main"), [config]);
  assert.equal(messages[1].text, "const x = 1;\nconst y = 2;");
});
