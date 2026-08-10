import type { Schema } from "hast-util-sanitize";
import { defaultSchema } from "rehype-sanitize";

/** Strict whitelist for Markdown preview; no raw scripts/styles. */
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "dataSourceLine",
      "dataSourceEnd",
      "dataAnchorId",
      // Preview selection → source offset mapping (numeric / enum only).
      "dataTmFrom",
      "dataTmTo",
      "dataTmBodyFrom",
      "dataTmBodyTo",
      "dataTmFormat",
      "dataTmHref",
      "dataTmSourceBlock",
      "dataTmReadonly",
      "className",
    ],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
    a: [...(defaultSchema.attributes?.a ?? []), "href", "title"],
    // Keep alt/src/title; protocol allow-list below decides which src values survive.
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title"],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Export (and preview) must keep inline data URLs; http(s) remain allowed.
    src: [...new Set([...(defaultSchema.protocols?.src ?? []), "http", "https", "data"])],
  },
  // remark-rehype already prefixes generated footnote IDs. Prefixing again
  // here would make hrefs and their targets differ.
  clobberPrefix: "",
};
