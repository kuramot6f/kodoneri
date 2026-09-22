import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "../src/content/markdown.ts";

const render = (source: string) => markdown.parse(source, { async: false });

test("markdown shows raw HTML as text", () => {
  assert.equal(render("<img src=x onerror=alert(1)>"), "&#60;img src=x onerror=alert(1)&#62;");
  assert.equal(render("a <b onclick=x>b</b>"), "<p>a &#60;b onclick=x&#62;b&#60;/b&#62;</p>\n");
  assert.doesNotMatch(render("```text\n<img src=x onerror=1>\n```"), /<img/);
});

test("markdown links keep only safe protocols", () => {
  assert.equal(render("[x](https://example.com/?a=1&b=2)"), '<p><a href="https://example.com/?a=1&#38;b=2">x</a></p>\n');
  assert.equal(render("[x](/path)"), '<p><a href="/path">x</a></p>\n');
  assert.equal(render("[x](JaVaScRiPt:alert(1))"), "<p>x</p>\n");
  assert.equal(render("<javascript:alert(1)>"), "<p>javascript:alert(1)</p>\n");
  // Entities stay literal in the output, so this is a harmless relative link.
  assert.equal(render("[x](javascript&#58;alert(1))"), '<p><a href="javascript&#38;#58;alert(1)">x</a></p>\n');
});
