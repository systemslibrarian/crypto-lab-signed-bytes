/**
 * JSON Canonicalization Scheme (JCS), RFC 8785 — hand-rolled so every rule is
 * inspectable, because canonicalization IS a teaching subject of this lab.
 *
 * The three rules, each implemented below where you can read it:
 *   1. Strings (§3.2.2.2): minimal escaping — the two mandatory escapes
 *      (`\"`, `\\`), the short forms (\b \t \n \f \r), and \u00xx (lowercase
 *      hex) for remaining control characters. Everything else is emitted
 *      literally. NOTE: JCS never applies Unicode normalization — an NFD
 *      "é" stays NFD. That is why Stage 2's post-signing normalization
 *      failure is NOT fixed by JCS.
 *   2. Numbers (§3.2.2.3): ECMAScript Number::toString — the shortest decimal
 *      string that round-trips to the same IEEE-754 double. -0 becomes "0";
 *      NaN and Infinity are rejected (I-JSON has no spelling for them).
 *   3. Object members (§3.2.3): sorted by the key's UTF-16 code units,
 *      ascending. (UTF-16, not code points: an emoji's surrogate pair
 *      0xD83D… sorts BEFORE 0xFB33 — RFC 8785's own example.)
 *
 * JCS presupposes I-JSON (RFC 7493) input, which forbids duplicate member
 * names — so `canonicalizeText` parses with the fail-closed 'reject' policy.
 * Canonicalization cannot repair a duplicate key: the ambiguity happens in
 * the parser, upstream of any serializer.
 */
import { parseJson, type JsonValue } from '../json/parse'

export function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError('JCS cannot represent NaN or Infinity (I-JSON, RFC 7493)')
  }
  if (Object.is(n, -0)) return '0'
  return String(n) // ECMAScript Number::toString — shortest round-trip form
}

const SHORT_ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
}

export function serializeString(s: string): string {
  let out = '"'
  for (const unit of s) {
    // `for..of` iterates code points; surrogate pairs pass through intact.
    const short = SHORT_ESCAPES[unit]
    if (short !== undefined) {
      out += short
    } else if (unit < ' ') {
      out += '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0')
    } else {
      out += unit
    }
  }
  return out + '"'
}

/** RFC 8785 §3.2.3: compare keys as sequences of UTF-16 code units. */
export function compareKeys(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i)
    if (d !== 0) return d
  }
  return a.length - b.length
}

export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return serializeNumber(value)
  if (typeof value === 'string') return serializeString(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  const keys = Object.keys(value).sort(compareKeys)
  return '{' + keys.map((k) => serializeString(k) + ':' + canonicalize(value[k])).join(',') + '}'
}

/** Parse (fail-closed on duplicate keys, per I-JSON) then canonicalize. */
export function canonicalizeText(text: string): string {
  return canonicalize(parseJson(text, 'reject').value)
}
