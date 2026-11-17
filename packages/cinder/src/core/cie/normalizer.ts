import type { CinderNormalizedInput } from "../../types.js";

const WAKE_WORD_PATTERN = /^\s*(hey\s+)?cinder[\s,.:;-]*/i;
const PUNCTUATION_PATTERN = /[^a-z0-9\s]/gi;

export function normalizeInput(input: string): CinderNormalizedInput {
  const raw = input;
  const normalized = input
    .replace(WAKE_WORD_PATTERN, "")
    .replace(PUNCTUATION_PATTERN, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return {
    raw,
    normalized,
    tokens: normalized ? normalized.split(" ") : [],
  };
}
