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

/** Per-index difference mask between two byte strings (true = bytes differ or
 *  only one side has a byte at that index). Drives the hex-diff viewer. */
export function diffMask(a: Uint8Array, b: Uint8Array): boolean[] {
  const n = Math.max(a.length, b.length)
  const mask = new Array<boolean>(n)
  for (let i = 0; i < n; i++) mask[i] = i >= a.length || i >= b.length || a[i] !== b[i]
  return mask
}
