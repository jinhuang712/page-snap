import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createZip } from "../zip-store.js";

const zip = createZip([
  { path: "index.html", data: new TextEncoder().encode("<h1>ok</h1>") },
  { path: "text-content.txt", data: new TextEncoder().encode("readable") }
]);
const bytes = Buffer.from(zip);

assert.equal(bytes.readUInt32LE(0), 0x04034b50);
assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
assert.ok(bytes.includes(Buffer.from("index.html")));
assert.ok(bytes.includes(Buffer.from("text-content.txt")));
