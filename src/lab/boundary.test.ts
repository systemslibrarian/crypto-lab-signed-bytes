import { describe, expect, it } from 'vitest'
import { generateKeypair } from '../crypto/ed25519'
import { ALL_MUTATIONS, buildWireDoc, runBoundary, type Mutation, type SignPoint } from './boundary'

const kp = generateKeypair()

describe('Stage 5 — signature boundary', () => {
  it('with no in-transit re-encoding, all three boundaries verify and read ok', () => {
    for (const point of ['raw', 'reserialize', 'canonical'] as SignPoint[]) {
      const run = runBoundary(point, [], kp)
      expect(run.sigValid).toBe(true)
      expect(run.verdict).toBe('ok')
    }
  })

  it('sign-the-raw-bytes: EVERY re-encoding breaks the signature (fail-closed, brittle)', () => {
    for (const m of ALL_MUTATIONS) {
      const run = runBoundary('raw', [m], kp)
      expect(run.sigValid).toBe(false)
      expect(run.verdict).toBe('fail-closed')
    }
  })

  const reserializeMatrix: Array<[Mutation, boolean]> = [
    ['whitespace', true], // erased by JSON.parse -> accepted without detection
    ['numberform', true], // 1e0 -> 1 -> accepted without detection
    ['reorder', false], // JSON.stringify preserves insertion order -> rejected
    ['nfd', false], // parse/serialize never normalizes Unicode -> rejected
  ]

  it.each(reserializeMatrix)(
    'parse-then-reserialize boundary: %s in transit -> signature valid = %s',
    (mutation, expected) => {
      const run = runBoundary('reserialize', [mutation], kp)
      expect(run.sigValid).toBe(expected)
      expect(run.verdict).toBe(expected ? 'ok' : 'fail-closed')
    },
  )

  const canonicalMatrix: Array<[Mutation, boolean]> = [
    ['whitespace', true], // erased by canonicalization
    ['numberform', true], // canonical number spelling
    ['reorder', true], // canonical key order
    ['nfd', false], // JCS never normalizes Unicode -> rejected
  ]

  it.each(canonicalMatrix)(
    'canonical (JCS) boundary: %s in transit -> signature valid = %s',
    (mutation, expected) => {
      const run = runBoundary('canonical', [mutation], kp)
      expect(run.sigValid).toBe(expected)
      expect(run.verdict).toBe(expected ? 'ok' : 'fail-closed')
    },
  )

  it('accepted mutations really did change the wire bytes (unauthenticated surface)', () => {
    const run = runBoundary('canonical', ['whitespace', 'numberform', 'reorder'], kp)
    expect(run.deliveredText).not.toBe(run.originalText)
    expect(run.sigValid).toBe(true)
    expect(run.meaningEqual).toBe(true)
  })

  it('mutations compose: whitespace+numberform pass the reserialize boundary together', () => {
    const run = runBoundary('reserialize', ['whitespace', 'numberform'], kp)
    expect(run.sigValid).toBe(true)
    expect(run.verdict).toBe('ok')
  })

  it('buildWireDoc with no mutations is the producer document, byte for byte', () => {
    expect(buildWireDoc(new Set())).toBe('{"amount":1,"payee":"café"}')
  })
})
