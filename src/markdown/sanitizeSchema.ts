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
      "className",
    ],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    a: [...(defaultSchema.attributes?.a ?? []), "href", "title"],
  },
  clobberPrefix: "user-content-",
};
