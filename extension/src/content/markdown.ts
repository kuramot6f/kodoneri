import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

const plainTextLanguages = new Set(["nohighlight", "plaintext", "text", "txt"]);
const safeProtocols = new Set(["http:", "https:", "mailto:"]);

/**
 * Model output can carry text injected by pages it read, and inline handlers in the panel run in the
 * page's world. Raw HTML is shown as text, and links keep only safe protocols.
 */
export const markdown = new Marked(markedHighlight({
  emptyLangClass: "hljs",
  langPrefix: "hljs language-",
  highlight(code, language) {
    const normalizedLanguage = language.toLowerCase();
    if (plainTextLanguages.has(normalizedLanguage)) return code;
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return hljs.highlight(code, { language: normalizedLanguage }).value;
    }
    return hljs.highlightAuto(code).value;
  }
}), {
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      // href is written fully escaped, so the browser reads exactly the string checked here; entities cannot smuggle a scheme.
      if (!safeProtocols.has(URL.parse(href, "https://base.invalid/")?.protocol ?? "")) return text;
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</a>`;
    }
  }
});

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
