import { describe, expect, it } from 'vitest'
import { generateKeypair } from '../crypto/ed25519'
import {
  ALL_MUTATIONS,
  SIGN_POINTS,
  buildWireDoc,
  runBoundary,
  toSignedForm,
  type Mutation,
  type SignPoint,
} from './boundary'

const kp = generateKeypair()

/** Which mutations each boundary tolerates (signature still verifies).
 *  Cumulative pipeline → strictly monotone tolerance. */
const TOLERANCE: Record<SignPoint, Mutation[]> = {
  raw: [],
  parse: ['whitespace', 'numberform'],
  normalize: ['whitespace', 'numberform', 'nfd'],
  canonical: ['whitespace', 'numberform', 'nfd', 'reorder'],
}

describe('Stage 5 — signature boundary', () => {
  it('with no in-transit re-encoding, all four boundaries verify and read ok', () => {
    for (const point of SIGN_POINTS) {
      const run = runBoundary(point, [], kp)
      expect(run.sigValid).toBe(true)
      expect(run.verdict).toBe('ok')
    }
  })

  for (const point of SIGN_POINTS) {
    it.each(ALL_MUTATIONS)(`boundary "${point}": mutation %s matches the tolerance matrix`, (m) => {
      const run = runBoundary(point, [m], kp)
      const tolerated = TOLERANCE[point].includes(m)
      expect(run.sigValid).toBe(tolerated)
      expect(run.verdict).toBe(tolerated ? 'ok' : 'fail-closed')
    })
  }

  it('tolerance grows monotonically as the boundary moves down the pipeline', () => {
    for (let i = 1; i < SIGN_POINTS.length; i++) {
      const prev = new Set(TOLERANCE[SIGN_POINTS[i - 1]])
      for (const m of prev) expect(TOLERANCE[SIGN_POINTS[i]]).toContain(m)
    }
  })

  it('all tolerated mutations composed together still verify at the canonical tap', () => {
    const run = runBoundary('canonical', [...ALL_MUTATIONS], kp)
    expect(run.deliveredText).not.toBe(run.originalText) // wire bytes really changed
    expect(run.sigValid).toBe(true)
    expect(run.meaningEqual).toBe(true)
    expect(run.verdict).toBe('ok')
  })

  it('whitespace+numberform compose at the parse tap', () => {
    const run = runBoundary('parse', ['whitespace', 'numberform'], kp)
    expect(run.sigValid).toBe(true)
    expect(run.verdict).toBe('ok')
  })

  it('buildWireDoc with no mutations is the producer document, byte for byte', () => {
    expect(buildWireDoc(new Set())).toBe('{"amount":1,"payee":"café"}')
  })

  it('the pipeline is strict: duplicate keys fail closed at every non-raw tap', () => {
    for (const point of ['parse', 'normalize', 'canonical'] as SignPoint[]) {
      expect(() => toSignedForm('{"a":1,"a":2}', point)).toThrow(/duplicate/)
    }
  })

  it('normalize tap derives NFC: both é spellings produce the same signed form', () => {
    const nfc = '{"payee":"café"}'
    const nfd = '{"payee":"café"}'
    expect(toSignedForm(nfc, 'normalize')).toBe(toSignedForm(nfd, 'normalize'))
    expect(toSignedForm(nfc, 'parse')).not.toBe(toSignedForm(nfd, 'parse'))
  })
})
