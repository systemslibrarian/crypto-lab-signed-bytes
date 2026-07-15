import { describe, expect, it } from 'vitest'
import { toHex, utf8Encode } from '../core/bytes'
import { generateKeypair } from '../crypto/ed25519'
import {
  E_ACUTE_NFC,
  E_ACUTE_NFD,
  runDuplicates,
  runNumberForm,
  runSignAcross,
  runUnicode,
} from './stages'

const kp = generateKeypair()

describe('Stage 1 — key order', () => {
  const docA = '{"a":1,"b":2}'
  const docB = '{"b":2,"a":1}'

  it('same meaning, different bytes: the real verifier says INVALID (fail-closed)', () => {
    const run = runSignAcross(docA, docB, kp, false)
    expect(run.sigValid).toBe(false)
    expect(run.verdict).toBe('fail-closed')
  })

  it('JCS repairs it: both ends canonicalize to the same bytes, signature verifies', () => {
    const run = runSignAcross(docA, docB, kp, true)
    expect(run.signedText).toBe('{"a":1,"b":2}')
    expect(run.verifiedText).toBe('{"a":1,"b":2}')
    expect(run.sigValid).toBe(true)
    expect(run.verdict).toBe('ok')
  })

  it('JCS does not paper over a real change: different values still fail closed', () => {
    const run = runSignAcross(docA, '{"b":3,"a":1}', kp, true)
    expect(run.sigValid).toBe(false)
    expect(run.verdict).toBe('fail-closed')
  })
})

describe('Stage 2 — Unicode normalization (NFC vs NFD)', () => {
  it('the two spellings render identically but are different bytes', () => {
    expect(E_ACUTE_NFC.normalize('NFC')).toBe(E_ACUTE_NFD.normalize('NFC'))
    expect(E_ACUTE_NFC).not.toBe(E_ACUTE_NFD)
    expect(toHex(utf8Encode(E_ACUTE_NFC))).toBe('636166c3a9') // …é = 0xc3 0xa9
    expect(toHex(utf8Encode(E_ACUTE_NFD))).toBe('63616665cc81') // …e + U+0301 = 0xcc 0x81
  })

  it('divergent forms: signature fails, system fails closed', () => {
    const run = runUnicode('divergent', kp, false)
    expect(run.sigValid).toBe(false)
    expect(run.verdict).toBe('fail-closed')
  })

  it('normalizing to NFC BEFORE signing/verifying repairs the mismatch', () => {
    const run = runUnicode('normalize-before', kp, false)
    expect(run.sigValid).toBe(true)
    expect(run.verdict).toBe('ok')
  })

  it('normalizing AFTER signing breaks a genuine signature (indistinguishable from tampering)', () => {
    const run = runUnicode('normalize-after', kp, false)
    expect(run.sigValid).toBe(false)
    expect(run.verdict).toBe('fail-closed')
  })

  it('JCS does NOT fix it: RFC 8785 never normalizes Unicode', () => {
    const run = runUnicode('divergent', kp, true)
    expect(run.sigValid).toBe(false)
    expect(run.verdict).toBe('fail-closed')
  })
})

describe('Stage 3 — duplicate keys (the centerpiece)', () => {
  const doc = '{"role":"user","role":"admin"}'

  it('signature over the exact bytes is VALID — and the verdict is still ALARM', () => {
    const run = runDuplicates(doc, kp, false)
    expect(run.sigValid).toBe(true) // the primitive holds
    expect(run.verdict).toBe('alarm') // the system does not
  })

  it('first-wins parser (verifier) and last-wins parser (application) recover different meanings', () => {
    const run = runDuplicates(doc, kp, false)
    expect(run.verifierView).toBe('{"role":"user"}')
    expect(run.applicationView).toBe('{"role":"admin"}')
    expect(run.duplicateKeys).toEqual(['$.role'])
  })

  it('a clean document is fine: valid signature, views agree, verdict ok', () => {
    const run = runDuplicates('{"role":"user"}', kp, false)
    expect(run.sigValid).toBe(true)
    expect(run.verdict).toBe('ok')
    expect(run.verifierView).toBe(run.applicationView)
  })

  it('JCS does not canonicalize the ambiguity away — it rejects the document at parse time', () => {
    const run = runDuplicates(doc, kp, true)
    expect(run.sigValid).toBe(false)
    expect(run.verdict).toBe('fail-closed')
    expect(run.jcsError).toMatch(/duplicate/)
  })
})

describe('Stage 4 — number spellings and float64 round-trip', () => {
  it('1.0000000000000001 parses to EXACTLY the float64 1 (the text distinction is unrepresentable)', () => {
    expect(Number('1.0000000000000001')).toBe(1)
    expect(Number('1.0') === Number('1e0') && Number('1e0') === Number('1')).toBe(true)
  })

  it('the spelling "1" survives a round-trip: signature verifies', () => {
    const run = runNumberForm('1', kp, false)
    expect(run.sigValid).toBe(true)
    expect(run.verdict).toBe('ok')
  })

  it.each(['1.0', '1e0', '1.0000000000000001'])(
    'the spelling "%s" is rewritten to "1" by a parse/re-serialize hop: signature fails closed',
    (form) => {
      const run = runNumberForm(form, kp, false)
      expect(run.roundTripped).toBe('1')
      expect(run.sigValid).toBe(false)
      expect(run.verdict).toBe('fail-closed')
    },
  )

  it.each(['1', '1.0', '1e0', '1.0000000000000001'])(
    'with JCS both ends agree on the canonical spelling of "%s": signature verifies',
    (form) => {
      const run = runNumberForm(form, kp, true)
      expect(run.sigValid).toBe(true)
      expect(run.verdict).toBe('ok')
    },
  )

  it('JCS is honest about what it cannot restore: distinct float64s stay distinct', () => {
    // 1e+23 and 1.0000000000000001e+23 are DIFFERENT doubles (RFC 8785 App. B)
    expect(Number('1e+23')).not.toBe(Number('1.0000000000000001e+23'))
  })
})
