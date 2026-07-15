/**
 * Ed25519 (RFC 8032) via @noble/ed25519.
 *
 * Why a library, and why this one: the signature scheme is NOT the teaching
 * subject of this lab — the byte string it signs is. So the curve arithmetic
 * stays in an audited, minimal, pure-TypeScript implementation rather than
 * being hand-rolled (the hand-rolled, inspectable parts of this lab are the
 * JSON parser and the RFC 8785 canonicalizer, where the lesson lives).
 * @noble/ed25519 is chosen over WebCrypto because SubtleCrypto's Ed25519 is
 * still not uniformly available across browsers, and noble exposes the strict
 * RFC 8032 verification switch (zip215: false) we want to be explicit about.
 *
 * Verification here is strict RFC 8032 / FIPS 186-5 (zip215: false); the
 * sibling demo crypto-lab-ed25519-forge explores the ZIP215 divergence.
 */
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'

// noble v2 ships no hash; wire the sync API to @noble/hashes SHA-512.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))

export interface Keypair {
  secretKey: Uint8Array
  publicKey: Uint8Array
}

export function generateKeypair(): Keypair {
  const secretKey = ed.utils.randomPrivateKey()
  return { secretKey, publicKey: ed.getPublicKey(secretKey) }
}

export function keypairFromSeed(seed: Uint8Array): Keypair {
  return { secretKey: seed, publicKey: ed.getPublicKey(seed) }
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed.sign(message, secretKey)
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed.verify(signature, message, publicKey, { zip215: false })
  } catch {
    // Malformed signature/point encodings fail closed.
    return false
  }
}
