import { describe, expect, it } from 'vitest'
import { byteDiffMasks, fromHex, toHex, utf8Encode } from './bytes'

describe('byteDiffMasks — alignment-aware hex diff', () => {
  it('identical inputs mark nothing', () => {
    const a = utf8Encode('{"a":1}')
    const m = byteDiffMasks(a, utf8Encode('{"a":1}'))
    expect(m.a.every((x) => !x)).toBe(true)
    expect(m.b.every((x) => !x)).toBe(true)
  })

  it('a single insertion marks only the inserted byte, not everything after it', () => {
    const a = utf8Encode('{"a":1}')
    const b = utf8Encode('{ "a":1}') // one space inserted at index 1
    const m = byteDiffMasks(a, b)
    expect(m.a.every((x) => !x)).toBe(true)
    expect(m.b.filter(Boolean).length).toBe(1)
    expect(m.b[1]).toBe(true)
  })

  it('a substitution marks one byte on each side', () => {
    const a = utf8Encode('{"a":1}')
    const b = utf8Encode('{"a":2}')
    const m = byteDiffMasks(a, b)
    expect(m.a.filter(Boolean).length).toBe(1)
    expect(m.b.filter(Boolean).length).toBe(1)
    expect(m.a[5]).toBe(true)
    expect(m.b[5]).toBe(true)
  })

  it('handles empty sides', () => {
    const m = byteDiffMasks(utf8Encode(''), utf8Encode('ab'))
    expect(m.a).toEqual([])
    expect(m.b).toEqual([true, true])
  })
})

describe('hex round-trip', () => {
  it('toHex/fromHex are inverses', () => {
    const bytes = new Uint8Array([0, 1, 0x7f, 0x80, 0xff])
    expect(fromHex(toHex(bytes))).toEqual(bytes)
  })

  it('fromHex rejects junk', () => {
    expect(() => fromHex('abc')).toThrow()
    expect(() => fromHex('zz')).toThrow()
  })
})
