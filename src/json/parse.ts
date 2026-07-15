/**
 * Hand-rolled strict JSON parser (RFC 8259) with a configurable duplicate-key
 * policy. This is a teaching part of the lab, deliberately not JSON.parse:
 * RFC 8259 §4 says object member names SHOULD be unique and explicitly leaves
 * the behavior on duplicates implementation-defined ("Many implementations
 * report the last name/value pair only. Other implementations report an
 * error…"). That latitude — two conforming parsers recovering two different
 * meanings from the same signed bytes — is the centerpiece of Stage 3.
 *
 * Policies:
 *   'first'  — keep the first occurrence (e.g. historical Go behavior of some
 *              validators, several C parsers)
 *   'last'   — keep the last occurrence (ECMAScript JSON.parse, Python json)
 *   'reject' — fail closed (I-JSON, RFC 7493 §2.3)
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}

// [extension] point: further real-world parser policies (e.g. comment
// tolerance, lone-surrogate rejection, bigint numbers) extend this union and
// the corresponding branches in parseJson — Stage 3's two-view comparison
// works for any pair of policies.
export type DuplicatePolicy = 'first' | 'last' | 'reject'

export interface DuplicateReport {
  /** JSONPath-ish location of the object member, e.g. `$.role` */
  path: string
  key: string
}

export interface ParseResult {
  value: JsonValue
  /** Every duplicate member name encountered (empty when the document is clean). */
  duplicates: DuplicateReport[]
}

export class JsonParseError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} (at offset ${position})`)
    this.name = 'JsonParseError'
  }
}

const WS = new Set([' ', '\t', '\n', '\r'])

export function parseJson(text: string, policy: DuplicatePolicy = 'reject'): ParseResult {
  let i = 0
  const duplicates: DuplicateReport[] = []

  function fail(msg: string): never {
    throw new JsonParseError(msg, i)
  }

  function skipWs(): void {
    while (i < text.length && WS.has(text[i])) i++
  }

  function expect(ch: string): void {
    if (text[i] !== ch) fail(`expected '${ch}'`)
    i++
  }

  function parseValue(path: string): JsonValue {
    skipWs()
    const ch = text[i]
    if (ch === undefined) fail('unexpected end of input')
    if (ch === '{') return parseObject(path)
    if (ch === '[') return parseArray(path)
    if (ch === '"') return parseString()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber()
    if (text.startsWith('true', i)) return ((i += 4), true)
    if (text.startsWith('false', i)) return ((i += 5), false)
    if (text.startsWith('null', i)) return ((i += 4), null)
    fail(`unexpected character '${ch}'`)
  }

  function parseObject(path: string): JsonObject {
    expect('{')
    const obj: JsonObject = {}
    skipWs()
    if (text[i] === '}') {
      i++
      return obj
    }
    for (;;) {
      skipWs()
      if (text[i] !== '"') fail('expected string key')
      const key = parseString()
      skipWs()
      expect(':')
      const value = parseValue(`${path}.${key}`)
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        duplicates.push({ path: `${path}.${key}`, key })
        if (policy === 'reject') fail(`duplicate key "${key}"`)
        if (policy === 'last') obj[key] = value
        // 'first': discard the later value
      } else {
        obj[key] = value
      }
      skipWs()
      if (text[i] === ',') {
        i++
        continue
      }
      expect('}')
      return obj
    }
  }

  function parseArray(path: string): JsonValue[] {
    expect('[')
    const arr: JsonValue[] = []
    skipWs()
    if (text[i] === ']') {
      i++
      return arr
    }
    for (;;) {
      arr.push(parseValue(`${path}[${arr.length}]`))
      skipWs()
      if (text[i] === ',') {
        i++
        continue
      }
      expect(']')
      return arr
    }
  }

  function parseString(): string {
    expect('"')
    let out = ''
    for (;;) {
      const ch = text[i]
      if (ch === undefined) fail('unterminated string')
      if (ch === '"') {
        i++
        return out
      }
      if (ch === '\\') {
        i++
        const esc = text[i]
        i++
        switch (esc) {
          case '"':
            out += '"'
            break
          case '\\':
            out += '\\'
            break
          case '/':
            out += '/'
            break
          case 'b':
            out += '\b'
            break
          case 'f':
            out += '\f'
            break
          case 'n':
            out += '\n'
            break
          case 'r':
            out += '\r'
            break
          case 't':
            out += '\t'
            break
          case 'u': {
            const hex = text.slice(i, i + 4)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid \\u escape')
            out += String.fromCharCode(parseInt(hex, 16))
            i += 4
            break
          }
          default:
            fail(`invalid escape '\\${esc ?? ''}'`)
        }
        continue
      }
      const code = ch.charCodeAt(0)
      if (code < 0x20) fail('unescaped control character in string')
      out += ch
      i++
    }
  }

  function parseNumber(): number {
    const start = i
    if (text[i] === '-') i++
    if (text[i] === '0') {
      i++
    } else if (text[i] >= '1' && text[i] <= '9') {
      while (text[i] >= '0' && text[i] <= '9') i++
    } else {
      fail('invalid number')
    }
    if (text[i] === '.') {
      i++
      if (!(text[i] >= '0' && text[i] <= '9')) fail('invalid number: digit required after decimal point')
      while (text[i] >= '0' && text[i] <= '9') i++
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++
      if (text[i] === '+' || text[i] === '-') i++
      if (!(text[i] >= '0' && text[i] <= '9')) fail('invalid number: digit required in exponent')
      while (text[i] >= '0' && text[i] <= '9') i++
    }
    return Number(text.slice(start, i))
  }

  const value = parseValue('$')
  skipWs()
  if (i !== text.length) fail('trailing characters after JSON value')
  return { value, duplicates }
}

export interface NumberToken {
  /** The literal as written in the document, e.g. "1.0000000000000001" */
  raw: string
  /** What a float64 parser actually recovers from it. */
  parsed: number
  offset: number
}

/** Scan every number literal in a JSON text, preserving the raw spelling that
 *  JSON.parse throws away. Stage 4 renders raw vs. recovered side by side. */
export function scanNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = []
  let i = 0
  let inString = false
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      i++
      continue
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i
      if (text[i] === '-') i++
      while (text[i] >= '0' && text[i] <= '9') i++
      if (text[i] === '.') {
        i++
        while (text[i] >= '0' && text[i] <= '9') i++
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++
        if (text[i] === '+' || text[i] === '-') i++
        while (text[i] >= '0' && text[i] <= '9') i++
      }
      const raw = text.slice(start, i)
      tokens.push({ raw, parsed: Number(raw), offset: start })
      continue
    }
    i++
  }
  return tokens
}
