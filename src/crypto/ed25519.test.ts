import { describe, expect, it } from 'vitest'
import { fromHex, toHex, utf8Encode } from '../core/bytes'
import { keypairFromSeed, generateKeypair, sign, verify } from './ed25519'

/** RFC 8032 §7.1 test vectors (Ed25519). */
const KATS = [
  {
    name: 'TEST 1 (empty message)',
    seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    pub: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    msg: '',
    sig: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    name: 'TEST 2 (one byte)',
    seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    pub: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    msg: '72',
    sig: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
  {
    name: 'TEST 3 (two bytes)',
    seed: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
    pub: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
    msg: 'af82',
    sig: '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a',
  },
  {
    name: 'TEST SHA(abc)',
    seed: '833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42',
    pub: 'ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf',
    msg: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    sig: 'dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704',
  },
]

describe('Ed25519 — RFC 8032 §7.1 known-answer tests', () => {
  it.each(KATS)('$name: seed → public key', ({ seed, pub }) => {
    expect(toHex(keypairFromSeed(fromHex(seed)).publicKey)).toBe(pub)
  })

  it.each(KATS)('$name: deterministic signature matches the spec', ({ seed, msg, sig }) => {
    expect(toHex(sign(fromHex(msg), fromHex(seed)))).toBe(sig)
  })

  it.each(KATS)('$name: spec signature verifies', ({ pub, msg, sig }) => {
    expect(verify(fromHex(sig), fromHex(msg), fromHex(pub))).toBe(true)
  })
})

describe('Ed25519 — accept good / reject every bad', () => {
  const kp = generateKeypair()
  const msg = utf8Encode('{"amount":1,"payee":"alice"}')
  const sig = sign(msg, kp.secretKey)

  it('accepts a genuine signature over the exact bytes', () => {
    expect(verify(sig, msg, kp.publicKey)).toBe(true)
  })

  it('rejects when a single message byte changes', () => {
    const tampered = new Uint8Array(msg)
    tampered[0] ^= 0x01
    expect(verify(sig, tampered, kp.publicKey)).toBe(false)
  })

  it('rejects when a single signature bit flips', () => {
    const tampered = new Uint8Array(sig)
    tampered[32] ^= 0x01
    expect(verify(tampered, msg, kp.publicKey)).toBe(false)
  })

  it('rejects under a different public key', () => {
    const other = generateKeypair()
    expect(verify(sig, msg, other.publicKey)).toBe(false)
  })

  it('fails closed on a malformed signature encoding', () => {
    expect(verify(new Uint8Array(64).fill(0xff), msg, kp.publicKey)).toBe(false)
  })
})
