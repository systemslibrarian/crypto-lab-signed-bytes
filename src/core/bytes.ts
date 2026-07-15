/** Byte-level helpers. The whole lab is about exact bytes, so these are the
 *  ground truth every stage renders from. */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text)
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`not a hex string: ${hex.slice(0, 32)}…`)
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export interface DiffMasks {
  /** true at index i = byte a[i] has no counterpart in b (changed/removed) */
  a: boolean[]
  /** true at index j = byte b[j] has no counterpart in a (changed/inserted) */
  b: boolean[]
}

/**
 * Alignment-aware byte diff for the hex viewer: bytes not on a longest common
 * subsequence are marked, so a single inserted byte highlights just itself
 * instead of shifting every byte after it into "different". Falls back to
 * positional comparison when the quadratic LCS table would be too large.
 */
export function byteDiffMasks(a: Uint8Array, b: Uint8Array): DiffMasks {
  const n = a.length
  const m = b.length
  if (n * m > 1 << 18) {
    // fallback: positional diff (documents this large scroll anyway)
    return {
      a: Array.from({ length: n }, (_, i) => i >= m || a[i] !== b[i]),
      b: Array.from({ length: m }, (_, j) => j >= n || a[j] !== b[j]),
    }
  }
  const w = m + 1
  const lcs = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }
  const maskA = new Array<boolean>(n).fill(true)
  const maskB = new Array<boolean>(m).fill(true)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      maskA[i] = false
      maskB[j] = false
      i++
      j++
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      i++
    } else {
      j++
    }
  }
  return { a: maskA, b: maskB }
}
