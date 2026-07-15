import { describe, expect, it } from 'vitest'
import { JsonParseError, parseJson, scanNumbers } from './parse'

describe('strict JSON parsing (RFC 8259)', () => {
  it('parses every value type', () => {
    const { value } = parseJson('{"s":"x","n":-1.5e2,"b":true,"f":false,"z":null,"a":[1,2],"o":{"k":0}}')
    expect(value).toEqual({ s: 'x', n: -150, b: true, f: false, z: null, a: [1, 2], o: { k: 0 } })
  })

  it('accepts scalars at the top level and insignificant whitespace', () => {
    expect(parseJson(' \t\r\n 42 ').value).toBe(42)
    expect(parseJson('"hi"').value).toBe('hi')
    expect(parseJson('null').value).toBe(null)
  })

  it('decodes all escape forms, including surrogate pairs', () => {
    const { value } = parseJson('"\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\ud834\\udd1e"')
    expect(value).toBe('"\\/\b\f\n\r\té\u{1D11E}')
  })

  it.each([
    ['trailing characters', '{"a":1} x'],
    ['single quotes', "{'a':1}"],
    ['trailing comma', '[1,2,]'],
    ['leading zero', '01'],
    ['bare decimal point', '1.'],
    ['empty exponent', '1e'],
    ['unquoted key', '{a:1}'],
    ['unterminated string', '"abc'],
    ['unescaped control character', '"a\nb"'],
    ['invalid escape', '"\\x41"'],
    ['truncated document', '{"a":'],
    ['NaN literal', 'NaN'],
  ])('rejects malformed input: %s', (_name, text) => {
    expect(() => parseJson(text)).toThrow(JsonParseError)
  })
})

describe('duplicate-key policy (RFC 8259 §4 leaves this implementation-defined)', () => {
  const doc = '{"role":"user","role":"admin"}'

  it("'first' keeps the first occurrence (some validators)", () => {
    expect(parseJson(doc, 'first').value).toEqual({ role: 'user' })
  })

  it("'last' keeps the last occurrence (JSON.parse, Python json)", () => {
    expect(parseJson(doc, 'last').value).toEqual({ role: 'admin' })
    expect(parseJson(doc, 'last').value).toEqual(JSON.parse(doc))
  })

  it("'reject' fails closed (I-JSON, RFC 7493)", () => {
    expect(() => parseJson(doc, 'reject')).toThrow(/duplicate key "role"/)
  })

  it('reports each duplicate with its path', () => {
    const { duplicates } = parseJson('{"a":{"k":1,"k":2},"k":3,"k":4}', 'first')
    expect(duplicates).toEqual([
      { path: '$.a.k', key: 'k' },
      { path: '$.k', key: 'k' },
    ])
  })

  it('does not flag distinct keys that merely repeat across levels', () => {
    expect(parseJson('{"k":{"k":1}}', 'reject').duplicates).toEqual([])
  })
})

describe('scanNumbers — raw spellings a float64 parser throws away', () => {
  it('captures the literal exactly as written', () => {
    const tokens = scanNumbers('{"a":1.0,"b":1e0,"c":1.0000000000000001}')
    expect(tokens.map((t) => t.raw)).toEqual(['1.0', '1e0', '1.0000000000000001'])
    expect(tokens.map((t) => t.parsed)).toEqual([1, 1, 1])
  })

  it('ignores digits inside strings', () => {
    expect(scanNumbers('{"a1":"2e5","n":-3.5}').map((t) => t.raw)).toEqual(['-3.5'])
  })
})
