import { describe, expect, it } from 'vitest'
import { canonicalize, canonicalizeText, compareKeys, serializeNumber, serializeString } from './canonicalize'

// NOTE: this file is deliberately ASCII-only; every non-ASCII or control
// character appears as a TypeScript \u escape so the test data is auditable
// byte-for-byte against the RFC text.

function doubleFromHex(hex: string): number {
  const dv = new DataView(new ArrayBuffer(8))
  dv.setBigUint64(0, BigInt('0x' + hex))
  return dv.getFloat64(0)
}

/** RFC 8785 Appendix B — number serialization samples (IEEE-754 bits → JCS text). */
const NUMBER_KATS: Array<[string, string]> = [
  ['0000000000000000', '0'],
  ['8000000000000000', '0'], // minus zero serializes as 0
  ['0000000000000001', '5e-324'],
  ['8000000000000001', '-5e-324'],
  ['7fefffffffffffff', '1.7976931348623157e+308'],
  ['ffefffffffffffff', '-1.7976931348623157e+308'],
  ['4340000000000000', '9007199254740992'],
  ['c340000000000000', '-9007199254740992'],
  ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'],
  ['44b52d02c7e14af6', '1e+23'],
  ['44b52d02c7e14af7', '1.0000000000000001e+23'],
  ['444b1ae4d6e2ef4e', '999999999999999700000'],
  ['444b1ae4d6e2ef4f', '999999999999999900000'],
  ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
  ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'],
  ['41b3de4355555554', '333333333.33333325'],
  ['41b3de4355555555', '333333333.3333333'],
  ['41b3de4355555556', '333333333.3333334'],
  ['41b3de4355555557', '333333333.33333343'],
  ['becbf647612f3696', '-0.0000033333333333333333'],
  ['43143ff3c1cb0959', '1424953923781206.2'],
]

describe('JCS numbers — RFC 8785 Appendix B known-answer tests', () => {
  it.each(NUMBER_KATS)('bits %s -> "%s"', (bits, expected) => {
    expect(serializeNumber(doubleFromHex(bits))).toBe(expected)
  })

  it('rejects NaN (7fffffffffffffff) — I-JSON has no spelling for it', () => {
    expect(() => serializeNumber(doubleFromHex('7fffffffffffffff'))).toThrow(RangeError)
  })

  it('rejects Infinity (7ff0000000000000)', () => {
    expect(() => serializeNumber(doubleFromHex('7ff0000000000000'))).toThrow(RangeError)
  })
})

describe('JCS end-to-end — RFC 8785 §3.2.2/§3.2.3 sample document', () => {
  // Verbatim §3.2.2 input, with each JSON escape written as literal
  // backslash-u so the JSON text is exactly the RFC's.
  const input = [
    '{',
    '  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],',
    '  "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",',
    '  "literals": [null, true, false]',
    '}',
  ].join('\n')

  // Verbatim §3.2.3 expected output: the euro sign is a literal code point,
  // the remaining escapes (, \n, \", \\) are JSON escapes.
  const expected =
    '{"literals":[null,true,false],' +
    '"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
    '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}'

  it('canonicalizes the spec sample byte-for-byte', () => {
    expect(canonicalizeText(input)).toBe(expected)
  })

  it('is a fixed point: canonicalizing canonical output changes nothing', () => {
    expect(canonicalizeText(expected)).toBe(expected)
  })
})

describe('JCS property sorting — RFC 8785 §3.2.3 UTF-16 code-unit order', () => {
  const input =
    '{' +
    '"\\u20ac": "Euro Sign",' +
    '"\\r": "Carriage Return",' +
    '"\\ufb33": "Hebrew Letter Dalet With Dagesh",' +
    '"1": "One",' +
    '"\\ud83d\\ude00": "Emoji: Grinning Face",' +
    '"\\u0080": "Control",' +
    '"\\u00f6": "Latin Small Letter O With Diaeresis"' +
    '}'

  it('orders members exactly as the spec example', () => {
    // Assert the exact canonical text. (Object.values(JSON.parse(...)) would
    // lie here: JS objects hoist the integer-like key "1" to the front.)
    expect(canonicalizeText(input)).toBe(
      '{"\\r":"Carriage Return",' +
        '"1":"One",' +
        '"":"Control",' +
        '"ö":"Latin Small Letter O With Diaeresis",' +
        '"€":"Euro Sign",' +
        '"😀":"Emoji: Grinning Face",' +
        '"דּ":"Hebrew Letter Dalet With Dagesh"}',
    )
  })

  it('sorts a surrogate pair (emoji, U+1F600) BEFORE U+FB33 — UTF-16 units, not code points', () => {
    expect(compareKeys('😀', 'דּ')).toBeLessThan(0)
  })
})

describe('JCS strings — §3.2.2.2 escaping rules', () => {
  it('uses the short escapes for the seven special characters', () => {
    expect(serializeString('\b\t\n\f\r"\\')).toBe('"\\b\\t\\n\\f\\r\\"\\\\"')
  })

  it('escapes remaining C0 controls as lowercase \\u00xx', () => {
    expect(serializeString('')).toBe('"\\u000b"')
    expect(serializeString('')).toBe('"\\u001f"')
  })

  it('leaves DEL (U+007F) and forward slash unescaped', () => {
    expect(serializeString('/')).toBe('"/"')
  })

  it('emits non-ASCII literally (no \\u escaping of the euro sign or emoji)', () => {
    expect(serializeString('€😀')).toBe('"€😀"')
  })
})

describe('JCS input discipline (I-JSON, RFC 7493)', () => {
  it('rejects documents with duplicate member names at parse time', () => {
    expect(() => canonicalizeText('{"role":"user","role":"admin"}')).toThrow(/duplicate/)
  })

  it('serializes -0 inside a document as 0', () => {
    expect(canonicalize({ x: -0 })).toBe('{"x":0}')
  })

  it('erases inter-token whitespace and reorders keys', () => {
    expect(canonicalizeText('{ "b" : 2 ,\n "a" : 1 }')).toBe('{"a":1,"b":2}')
  })

  it('does NOT Unicode-normalize string content (NFD stays NFD)', () => {
    const nfd = 'café'
    const nfc = 'café'
    expect(canonicalize(nfd)).toBe('"' + nfd + '"')
    expect(canonicalize(nfd)).not.toBe(canonicalize(nfc))
  })
})
