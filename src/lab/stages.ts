/**
 * Stage logic — pure, testable functions behind every panel in the UI.
 *
 * Two independent outputs per run, NEVER collapsed into one (this separation
 * is the lab's whole point):
 *
 *   sigValid — the raw boolean the real Ed25519 verifier returned over the
 *              exact bytes it was handed. A fact about bytes, nothing more.
 *
 *   verdict  — what actually happened to the SYSTEM:
 *     'ok'          the meaning the application recovers is the meaning the
 *                   signer intended (integrity holds)
 *     'fail-closed' verification failed, nothing was accepted — safe but
 *                   broken interop (the primitive held; the encoding didn't)
 *     'alarm'       a signature verified AND the application recovers a
 *                   different meaning than the signer/verifier saw — the
 *                   valid-signature light is on while the meaning changed
 */
import { utf8Encode } from '../core/bytes'
import { sign, verify } from '../crypto/ed25519'
import type { Keypair } from '../crypto/ed25519'
import { canonicalize, canonicalizeText } from '../jcs/canonicalize'
import { parseJson, type DuplicatePolicy } from '../json/parse'

export type Verdict = 'ok' | 'fail-closed' | 'alarm'

export interface SignVerifyRun {
  /** Text whose UTF-8 bytes were actually signed. */
  signedText: string
  /** Text whose UTF-8 bytes were handed to the verifier. */
  verifiedText: string
  signature: Uint8Array
  /** Raw result of the real Ed25519 verifier. */
  sigValid: boolean
}

/** Sign the exact UTF-8 bytes of `signText`; verify over the exact UTF-8
 *  bytes of `verifyText`. No canonicalization, no repair — bytes in, bytes out. */
export function signVerify(signText: string, verifyText: string, kp: Keypair): SignVerifyRun {
  const signature = sign(utf8Encode(signText), kp.secretKey)
  const sigValid = verify(signature, utf8Encode(verifyText), kp.publicKey)
  return { signedText: signText, verifiedText: verifyText, signature, sigValid }
}

/** The meaning a parser recovers from a JSON text, in comparable (canonical)
 *  form. `policy` selects the parser's duplicate-key behavior. */
export function recoveredMeaning(text: string, policy: DuplicatePolicy): string {
  return canonicalize(parseJson(text, policy).value)
}

// ---------------------------------------------------------------- Stage 1+2

export interface StageRun extends SignVerifyRun {
  verdict: Verdict
  /** True when JCS was applied before signing and before verifying. */
  jcs: boolean
  /** Set when JCS itself refused the input (e.g. duplicate keys). */
  jcsError?: string
}

function verdictFor(run: SignVerifyRun, meaningEqual: boolean): Verdict {
  if (!run.sigValid) return 'fail-closed'
  return meaningEqual ? 'ok' : 'alarm'
}

/**
 * Sign one JSON text, verify another, optionally canonicalizing both ends
 * first (the JCS toggle). Used by Stage 1 (key order) and by the byte-diff
 * sandbox. Meaning comparison uses last-wins parsing — a JS application's view.
 */
export function runSignAcross(docA: string, docB: string, kp: Keypair, useJcs: boolean): StageRun {
  let signText = docA
  let verifyText = docB
  if (useJcs) {
    try {
      signText = canonicalizeText(docA)
      verifyText = canonicalizeText(docB)
    } catch (e) {
      // JCS refused the input: nothing is signed, nothing is accepted.
      return {
        signedText: '',
        verifiedText: docB,
        signature: new Uint8Array(64),
        sigValid: false,
        verdict: 'fail-closed',
        jcs: true,
        jcsError: String((e as Error).message),
      }
    }
  }
  const run = signVerify(signText, verifyText, kp)
  let meaningEqual = false
  try {
    meaningEqual = recoveredMeaning(docA, 'last') === recoveredMeaning(docB, 'last')
  } catch {
    meaningEqual = false
  }
  return { ...run, verdict: verdictFor(run, meaningEqual), jcs: useJcs }
}

// ------------------------------------------------------------------ Stage 2

export const E_ACUTE_NFC = 'café' // é as one code point U+00E9
export const E_ACUTE_NFD = 'café' // e + combining acute U+0301

export type UnicodeMode = 'divergent' | 'normalize-before' | 'normalize-after'

export interface UnicodeRun extends StageRun {
  mode: UnicodeMode
  signerDoc: string
  deliveredDoc: string
}

/**
 * Stage 2 — same rendered glyphs, different code points.
 *   'divergent'        signer emits NFC, the other party's stack produced NFD;
 *                      nobody normalizes → verify fails (fail-closed)
 *   'normalize-before' both sides NFC-normalize BEFORE sign/verify → repaired
 *   'normalize-after'  signature is made over NFC bytes, then a "helpful"
 *                      layer NFD-normalizes the already-signed message →
 *                      verify fails (fail-closed): normalization after
 *                      signing is indistinguishable from tampering
 * JCS does not change any of these outcomes: RFC 8785 never applies Unicode
 * normalization (an NFD é stays NFD through canonicalization).
 */
export function runUnicode(mode: UnicodeMode, kp: Keypair, useJcs: boolean): UnicodeRun {
  const nfcDoc = `{"venue":"${E_ACUTE_NFC}"}`
  const nfdDoc = `{"venue":"${E_ACUTE_NFD}"}`
  let signerDoc: string
  let deliveredDoc: string
  if (mode === 'normalize-before') {
    signerDoc = nfcDoc.normalize('NFC')
    deliveredDoc = nfdDoc.normalize('NFC') // receiver normalizes its copy before verifying
  } else {
    // 'divergent': the two parties independently hold NFC vs NFD spellings.
    // 'normalize-after': signer signed NFC; middleware NFD-ized it in transit.
    signerDoc = nfcDoc
    deliveredDoc = nfdDoc
  }
  const base = runSignAcross(signerDoc, deliveredDoc, kp, useJcs)
  return { ...base, mode, signerDoc, deliveredDoc }
}

// ------------------------------------------------------------------ Stage 3

export interface DuplicateRun extends StageRun {
  /** What a first-wins parser (the verifier's authorization check) recovers. */
  verifierView: string
  /** What a last-wins parser (the application, e.g. JSON.parse) recovers. */
  applicationView: string
  duplicateKeys: string[]
}

/**
 * Stage 3 — the centerpiece. The signature is made over the EXACT bytes of
 * `text` and verified over those same bytes: it is genuinely valid the whole
 * way through, and nothing here forges or alters it. The failure is entirely
 * downstream: RFC 8259 §4 leaves duplicate-key handling implementation-
 * defined, so a first-wins parser (the verifier's policy check) and a
 * last-wins parser (the application) recover different meanings from the
 * same signed bytes.
 *
 * With JCS: canonicalization does NOT repair this — JCS requires I-JSON
 * input, so the duplicate is REJECTED at parse time (fail-closed). And if an
 * upstream parser already collapsed the duplicate before canonicalization,
 * the ambiguity happened upstream of JCS entirely.
 */
export function runDuplicates(text: string, kp: Keypair, useJcs: boolean): DuplicateRun {
  const empty = { verifierView: '', applicationView: '', duplicateKeys: [] as string[] }
  if (useJcs) {
    let canon: string
    try {
      canon = canonicalizeText(text)
    } catch (e) {
      const failed: StageRun = {
        signedText: '',
        verifiedText: text,
        signature: new Uint8Array(64),
        sigValid: false,
        verdict: 'fail-closed',
        jcs: true,
        jcsError: String((e as Error).message),
      }
      return { ...failed, ...empty }
    }
    // No duplicates present: JCS passes it through like any other doc.
    const run = signVerify(canon, canon, kp)
    return {
      ...run,
      verdict: 'ok',
      jcs: true,
      verifierView: recoveredMeaning(canon, 'first'),
      applicationView: recoveredMeaning(canon, 'last'),
      duplicateKeys: [],
    }
  }

  const run = signVerify(text, text, kp) // same bytes both ends — sigValid is true
  let verifierView: string
  let applicationView: string
  let duplicateKeys: string[]
  try {
    const firstWins = parseJson(text, 'first')
    const lastWins = parseJson(text, 'last')
    verifierView = canonicalize(firstWins.value)
    applicationView = canonicalize(lastWins.value)
    duplicateKeys = firstWins.duplicates.map((d) => d.path)
  } catch (e) {
    return {
      ...run,
      verdict: 'fail-closed',
      jcs: false,
      jcsError: String((e as Error).message),
      ...empty,
    }
  }
  const diverged = verifierView !== applicationView
  return {
    ...run,
    // Signature valid + two conforming parsers disagree on the meaning = ALARM.
    verdict: run.sigValid ? (diverged ? 'alarm' : 'ok') : 'fail-closed',
    jcs: false,
    verifierView,
    applicationView,
    duplicateKeys,
  }
}

// ------------------------------------------------------------------ Stage 4

export interface NumberFormRun extends StageRun {
  /** The number literal exactly as the producer wrote it. */
  rawForm: string
  /** The float64 the parser recovered, re-serialized (what survives a round-trip). */
  roundTripped: string
}

/**
 * Stage 4 — number spellings. The producer signs `{"amount":<raw>}`; a
 * gateway parses and re-serializes it (float64 round-trip, i.e.
 * JSON.parse → JSON.stringify) and forwards the result; the verifier checks
 * the signature over what arrives. Every spelling whose round-trip differs
 * from the original text breaks the signature — while the application's
 * recovered VALUE is identical for all of them (they are the same float64).
 */
export function runNumberForm(rawForm: string, kp: Keypair, useJcs: boolean): NumberFormRun {
  const doc = `{"amount":${rawForm}}`
  const roundTrippedDoc = JSON.stringify(JSON.parse(doc))
  const roundTripped = JSON.stringify(JSON.parse(rawForm))
  if (useJcs) {
    // Both ends canonicalize: the signature is made over the canonical form,
    // and the verifier canonicalizes what the gateway delivered.
    const base = runSignAcross(doc, roundTrippedDoc, kp, true)
    return { ...base, rawForm, roundTripped }
  }
  const run = signVerify(doc, roundTrippedDoc, kp)
  const meaningEqual = recoveredMeaning(doc, 'last') === recoveredMeaning(roundTrippedDoc, 'last')
  return { ...run, verdict: verdictFor(run, meaningEqual), jcs: false, rawForm, roundTripped }
}
