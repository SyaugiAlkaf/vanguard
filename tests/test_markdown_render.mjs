// SPDX-License-Identifier: Apache-2.0
//
// Tests for the client-side markdown renderer in
// apps/hearth/public/app.js. The renderer runs over MedGemma's reply
// text before innerHTML-substitution, so escapeHtml + restricted
// markdown subset must be XSS-safe — a prompt injection that coaxes
// MedGemma to emit <script>...</script> or onerror handlers must not
// execute. We extract the helper block via eval (no module surface in
// app.js by design — vanilla browser script).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const APP_JS = resolve(ROOT, "apps/hearth/public/app.js");

const code = readFileSync(APP_JS, "utf8");
const start = code.indexOf("function escapeHtml");
const end = code.indexOf("function pushUserMsg");
if (start < 0 || end < 0) {
  console.error("could not locate markdown renderer block in app.js");
  process.exit(1);
}
const block = code.slice(start, end);

// app.js is a vanilla browser script with no module surface. We extract
// the three helpers into a Function() factory and return them. Function
// constructor body runs in its own scope, so declarations don't leak
// but the returned tuple binds to our test-scope identifiers.
// eslint-disable-next-line no-new-func
const factory = new Function(block + "\nreturn { escapeHtml, mdInline, renderMarkdown };");
const { escapeHtml, renderMarkdown } = factory();

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ===== escapeHtml =====
t("escapeHtml escapes <, >, &, \", '", () => {
  const e = escapeHtml(`<script>alert("x")</script> & 'y'`);
  assert(!e.includes("<"), `still has <: ${e}`);
  assert(!e.includes(">"), `still has >: ${e}`);
  assert(e.includes("&lt;"), `missing &lt;: ${e}`);
  assert(e.includes("&gt;"), `missing &gt;: ${e}`);
  assert(e.includes("&quot;"), `missing &quot;: ${e}`);
  assert(e.includes("&amp;"), `missing &amp;: ${e}`);
});

// ===== XSS resistance =====
t("renderMarkdown neutralizes <script> tag", () => {
  const html = renderMarkdown(`Reply: <script>alert(1)</script> done`);
  assert(!/<script/i.test(html), `script tag survived: ${html}`);
  assert(html.includes("&lt;script&gt;"), `script not escaped: ${html}`);
});

t("renderMarkdown neutralizes onerror handler in IMG", () => {
  const html = renderMarkdown(`<img src=x onerror="alert(1)">`);
  assert(!/<img\b/i.test(html), `img tag survived: ${html}`);
  assert(html.includes("&lt;img"), `img not escaped: ${html}`);
});

t("renderMarkdown does not auto-render data: or javascript: URLs in links", () => {
  // Our link rule is /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/ — only http/https.
  const html = renderMarkdown(`[click](javascript:alert(1))`);
  assert(!/<a /i.test(html), `javascript: URL became <a>: ${html}`);
  // Should appear as escaped literal text instead.
  assert(html.includes("[click]"), `link source text lost: ${html}`);
});

t("renderMarkdown allows http(s) URLs only and they get rel=noopener", () => {
  const html = renderMarkdown(`Read [docs](https://example.com/foo)`);
  assert(/<a href="https:\/\/example\.com\/foo"/.test(html), `https link missing: ${html}`);
  assert(/rel="noopener noreferrer"/.test(html), `rel attrs missing: ${html}`);
  assert(/target="_blank"/.test(html), `target missing: ${html}`);
});

t("renderMarkdown escapes content inside list items", () => {
  const html = renderMarkdown(`* <script>x</script>\n* normal`);
  assert(!/<script/i.test(html), `script in li survived: ${html}`);
  assert(/<li>&lt;script&gt;/.test(html), `li content not escaped: ${html}`);
});

t("renderMarkdown escapes content inside strong/em", () => {
  const html = renderMarkdown(`**<script>**`);
  assert(!/<script/i.test(html), `script in strong survived: ${html}`);
});

t("renderMarkdown escapes inside inline code", () => {
  const html = renderMarkdown("`<script>alert(1)</script>`");
  assert(!/<script\b/i.test(html), `script in code survived: ${html}`);
  assert(html.includes("&lt;script&gt;"), `code content not escaped: ${html}`);
});

// ===== Structural rendering =====
t("renderMarkdown produces <p> for plain paragraph", () => {
  const html = renderMarkdown(`Hello there.`);
  assert(html === "<p>Hello there.</p>", `unexpected: ${html}`);
});

t("renderMarkdown handles double newline -> separate <p>", () => {
  const html = renderMarkdown(`A.\n\nB.`);
  assert(html === "<p>A.</p><p>B.</p>", `unexpected: ${html}`);
});

t("renderMarkdown handles single newline as line continuation in paragraph", () => {
  const html = renderMarkdown(`A\nB`);
  assert(html === "<p>A B</p>", `unexpected: ${html}`);
});

t("renderMarkdown produces <ul><li>...</li></ul> for bullet list", () => {
  const html = renderMarkdown(`* one\n* two`);
  assert(html === "<ul><li>one</li><li>two</li></ul>", `unexpected: ${html}`);
});

t("renderMarkdown handles indented bullets (4-space)", () => {
  const html = renderMarkdown(`* outer\n    * inner`);
  // Renderer flattens nested bullets into one ul — acceptable for MVP
  assert(html.includes("<ul>") && html.includes("<li>outer</li>") && html.includes("<li>inner</li>"),
    `flattened list wrong: ${html}`);
});

t("renderMarkdown produces <ol><li>...</li></ol> for numbered list", () => {
  const html = renderMarkdown(`1. one\n2. two`);
  assert(html === "<ol><li>one</li><li>two</li></ol>", `unexpected: ${html}`);
});

t("renderMarkdown bold marker", () => {
  const html = renderMarkdown(`**bold**`);
  assert(html === "<p><strong>bold</strong></p>", `unexpected: ${html}`);
});

t("renderMarkdown italic marker (not bold)", () => {
  const html = renderMarkdown(`Hello *italic* world`);
  assert(html.includes("<em>italic</em>"), `italic missing: ${html}`);
  assert(!html.includes("<strong>"), `false bold: ${html}`);
});

t("renderMarkdown headings #..######", () => {
  for (let n = 1; n <= 6; n++) {
    const hashes = "#".repeat(n);
    const html = renderMarkdown(`${hashes} title`);
    assert(html === `<h${n}>title</h${n}>`, `h${n} wrong: ${html}`);
  }
});

t("renderMarkdown inline code", () => {
  const html = renderMarkdown(`use \`foo()\` here`);
  assert(html.includes("<code>foo()</code>"), `code missing: ${html}`);
});

t("renderMarkdown empty string yields empty output", () => {
  assert(renderMarkdown("") === "", "empty input should produce empty output");
});

t("renderMarkdown only-whitespace yields empty output", () => {
  assert(renderMarkdown("\n\n\n") === "", "whitespace-only input should produce empty output");
});

t("renderMarkdown null/undefined safe", () => {
  assert(renderMarkdown(null) === "", "null should produce empty");
  assert(renderMarkdown(undefined) === "", "undefined should produce empty");
});

t("renderMarkdown does not crash on partial markers", () => {
  // Some real MedGemma streams emit half-formatted text mid-stream.
  for (const partial of ["**", "*incomplete", "[link](", "1. ", "# "]) {
    const html = renderMarkdown(partial);
    assert(typeof html === "string", `crashed on partial: ${partial}`);
  }
});

// ===== run =====
let pass = 0, fail = 0;
for (const test of tests) {
  try {
    await test.fn();
    console.log("pass: " + test.name);
    pass++;
  } catch (e) {
    console.error("FAIL: " + test.name + " :: " + e.message);
    fail++;
  }
}
console.log("");
console.log(`${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
