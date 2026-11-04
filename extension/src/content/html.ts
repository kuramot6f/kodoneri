import { createGenerator } from "@unocss/core";
import presetWind4 from "@unocss/preset-wind4";
import hljs from "highlight.js/lib/common";

/** Class on the element holding model HTML; generated utilities only apply inside it. */
export const HTML_CLASS = "html";

const plainTextLanguages = new Set(["nohighlight", "plaintext", "text", "txt"]);

// The model invents class names at answer time, so utilities are generated in the browser.
// The reset is left out because it would restyle the panel around the answer.
const uno = createGenerator({
  presets: [presetWind4({ dark: "media", preflights: { reset: false } })]
});

/** rem follows the host page's root font size, so sizes are pinned to px. */
export async function generateCss(html: string): Promise<string> {
  const { css } = await (await uno).generate(html, { scope: `.${HTML_CLASS}` });
  return css.replace(/(\d*\.?\d+)rem\b/g, (_, value: string) => `${Number(value) * 16}px`);
}

export function highlightCode(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const code of template.content.querySelectorAll("pre > code")) {
    const language = /\blang(?:uage)?-(\S+)/.exec(code.className)?.[1].toLowerCase() ?? "";
    if (plainTextLanguages.has(language)) continue;
    const source = code.textContent;
    code.innerHTML = language && hljs.getLanguage(language)
      ? hljs.highlight(source, { language }).value
      : hljs.highlightAuto(source).value;
    code.classList.add("hljs");
  }
  return template.innerHTML;
}

export function htmlToPlainText(html: string): string {
  const template = document.createElement("template");
  // A space before every tag keeps words in adjacent blocks apart.
  template.innerHTML = html.replaceAll("<", " <");
  for (const element of template.content.querySelectorAll("style, script")) element.remove();
  return template.content.textContent.replace(/\s+/g, " ").trim();
}
