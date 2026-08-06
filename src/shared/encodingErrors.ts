import type { TextEncodingId } from "@/shared/types";

export class UnmappableCharacterError extends Error {
  readonly kind = "unmappableCharacter" as const;
  readonly encoding?: TextEncodingId;
  readonly codepoint?: number;
  readonly index?: number;

  constructor(
    message: string,
    details?: {
      encoding?: TextEncodingId;
      codepoint?: number;
      index?: number;
    },
  ) {
    super(message);
    this.name = "UnmappableCharacterError";
    this.encoding = details?.encoding;
    this.codepoint = details?.codepoint;
    this.index = details?.index;
  }
}

export function isUnmappableCharacterError(
  error: unknown,
): error is UnmappableCharacterError {
  return error instanceof UnmappableCharacterError;
}
