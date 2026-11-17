/**
 * Zero-dependency number-word parser: "five" -> 5, "twenty one" -> 21,
 * "one hundred and five" -> 105, "two thousand" -> 2000.
 *
 * Strict on purpose: the WHOLE phrase must be a well-formed number, otherwise this returns
 * undefined and the caller keeps the original text. "five apples", "five five" and
 * "twenty eleven" are all rejected rather than half-converted.
 *
 * Out of scope: decimals ("point five"), ordinals ("third"), year-style forms
 * ("nineteen hundred"), and anything date-like.
 */
const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Array<[string, number]> = [
  ["million", 1_000_000],
  ["thousand", 1_000],
];

interface GroupResult {
  value: number;
  next: number;
  consumed: boolean;
}

function isSmallUnit(word: string | undefined): boolean {
  return word !== undefined && word in UNITS && UNITS[word]! >= 1 && UNITS[word]! <= 9;
}

function isNumberWord(word: string | undefined): boolean {
  return word !== undefined && (word in TENS || (word in UNITS && word !== "zero"));
}

function parseBelowThousand(tokens: string[], start: number): GroupResult {
  let index = start;
  let value = 0;
  let consumed = false;

  const first = tokens[index];

  if ((isSmallUnit(first) || first === "a") && tokens[index + 1] === "hundred") {
    value = (first === "a" ? 1 : UNITS[first!]!) * 100;
    index += 2;
    consumed = true;

    if (tokens[index] === "and" && isNumberWord(tokens[index + 1])) {
      index += 1;
    }
  }

  const word = tokens[index];

  if (word !== undefined && word in TENS) {
    value += TENS[word]!;
    index += 1;
    consumed = true;

    if (isSmallUnit(tokens[index])) {
      value += UNITS[tokens[index]!]!;
      index += 1;
    }
  } else if (word !== undefined && word in UNITS && word !== "zero") {
    value += UNITS[word]!;
    index += 1;
    consumed = true;
  }

  return { value, next: index, consumed };
}

export function parseNumberWords(text: string): number | undefined {
  const tokens = text
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return undefined;
  }

  if (tokens.length === 1 && tokens[0] === "zero") {
    return 0;
  }

  let index = 0;
  let total = 0;
  let parsedAnything = false;

  for (const [scaleName, scaleValue] of SCALES) {
    const group: GroupResult =
      tokens[index] === "a" && tokens[index + 1] === scaleName
        ? { value: 1, next: index + 1, consumed: true }
        : parseBelowThousand(tokens, index);

    if (group.consumed && tokens[group.next] === scaleName) {
      total += group.value * scaleValue;
      index = group.next + 1;
      parsedAnything = true;

      if (tokens[index] === "and" && isNumberWord(tokens[index + 1])) {
        index += 1;
      }
    }
  }

  const remainder = parseBelowThousand(tokens, index);

  if (remainder.consumed) {
    total += remainder.value;
    index = remainder.next;
    parsedAnything = true;
  }

  return parsedAnything && index === tokens.length ? total : undefined;
}
