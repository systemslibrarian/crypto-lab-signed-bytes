/**
 * Stage 5 — where does the signature attach?
 *
 * A fixed receive pipeline processes every message the same way:
 *
 *     wire bytes → parse → normalize (NFC) → serialize (JCS)
 *
 * and the application consumes the end of it. The learner drags the signature
 * boundary to one of the four taps: signer and verifier both compute the
 * representation at that point and sign/verify THOSE bytes. Everything below
 * runs the real signer and the real verifier; nothing is precomputed.
 *
 * The trade the slider makes visible: every pipeline stage upstream of the
 * boundary is re-derived by the verifier, so byte changes in that dimension
 * become invisible to the signature (an attacker-writable surface that the
 * pipeline itself declares meaning-free); every stage downstream still reaches
 * the signed bytes, so the same change fails closed — for attackers and for
 * honest middleboxes alike.
 */
import { utf8Encode } from '../core/bytes'
import { sign, verify, type Keypair } from '../crypto/ed25519'
import { canonicalize } from '../jcs/canonicalize'
import { parseJson, type JsonValue } from '../json/parse'
import { E_ACUTE_NFC, E_ACUTE_NFD, type Verdict } from './stages'

// [extension] point: the likely next exhibit is a deterministic-CBOR (RFC 8949
// §4.2 / COSE) tap for comparison — add a SignPoint here and a SIGN_POINT_INFO
// entry; toSignedForm() is the only other place that must learn the encoding.
export type SignPoint = 'raw' | 'parse' | 'normalize' | 'canonical'
// [extension] point: new in-transit re-encodings (e.g. string escape respelling
// "é" ↔ literal é) slot in as a Mutation + MUTATION_INFO entry + one
// branch in buildWireDoc; the matrix and tests pick them up automatically.
export type Mutation = 'whitespace' | 'numberform' | 'nfd' | 'reorder'

export const SIGN_POINTS: SignPoint[] = ['raw', 'parse', 'normalize', 'canonical']
export const ALL_MUTATIONS: Mutation[] = ['whitespace', 'numberform', 'nfd', 'reorder']

export interface SignPointInfo {
  id: SignPoint
  label: string
  detail: string
}

export const SIGN_POINT_INFO: SignPointInfo[] = [
  {
    id: 'raw',
    label: 'Wire bytes',
    detail: 'Sign/verify the exact bytes on the wire. Nothing is re-derived; any re-encoding anywhere breaks it.',
  },
  {
    id: 'parse',
    label: 'After parse',
    detail: 'Both ends parse (strict, duplicates rejected) and re-serialize, then sign/verify those bytes. Whitespace and number spelling are re-derived.',
  },
  {
    id: 'normalize',
    label: 'After NFC normalize',
    detail: 'Additionally NFC-normalize every string (keys and values) before re-serializing. Unicode composition is now re-derived too.',
  },
  {
    id: 'canonical',
    label: 'After JCS serialize',
    detail: 'Serialize with RFC 8785 canonical form (sorted keys, canonical numbers). Key order joins the re-derived set. Note the pipeline normalizes BEFORE JCS — JCS itself never touches code points.',
  },
]

export interface MutationInfo {
  id: Mutation
  label: string
  detail: string
}

export const MUTATION_INFO: MutationInfo[] = [
  {
    id: 'whitespace',
    label: 'Insert whitespace',
    detail: 'A pretty-printer adds spaces between tokens. JSON meaning is unchanged by inter-token whitespace (RFC 8259 §2).',
  },
  {
    id: 'numberform',
    label: 'Respell the number',
    detail: '1 becomes 1e0 — a different byte string that every float64 parser reads as exactly the same number.',
  },
  {
    id: 'nfd',
    label: 'Unicode-normalize to NFD',
    detail: 'é (U+00E9) becomes e + U+0301. Renders identically; different code points, different bytes.',
  },
  {
    id: 'reorder',
    label: 'Reorder object keys',
    detail: 'Members swap position. For a JSON object read as a map, order carries no meaning.',
  },
]

/** Build the wire document with a chosen set of in-transit re-encodings.
 *  With no mutations this is exactly what the producer emitted. */
export function buildWireDoc(mutations: ReadonlySet<Mutation>): string {
  const eAcute = mutations.has('nfd') ? E_ACUTE_NFD.slice(3) : E_ACUTE_NFC.slice(3)
  const num = mutations.has('numberform') ? '1e0' : '1'
  const sp = mutations.has('whitespace') ? ' ' : ''
  const members = [`"amount":${sp}${num}`, `"payee":${sp}"caf${eAcute}"`]
  if (mutations.has('reorder')) members.reverse()
  return `{${sp}${members.join(`,${sp}`)}${sp}}`
}

function deepNfc(v: JsonValue): JsonValue {
  if (typeof v === 'string') return v.normalize('NFC')
  if (Array.isArray(v)) return v.map(deepNfc)
  if (v !== null && typeof v === 'object') {
    const out: { [k: string]: JsonValue } = {}
    for (const [k, val] of Object.entries(v)) out[k.normalize('NFC')] = deepNfc(val)
    return out
  }
  return v
}

/** The byte string (as text) that the signature covers at a given tap point.
 *  Signer and verifier always apply the SAME derivation. Throws on malformed
 *  or duplicate-key input — the pipeline is strict and fails closed. */
export function toSignedForm(text: string, point: SignPoint): string {
  if (point === 'raw') return text
  const value = parseJson(text, 'reject').value
  if (point === 'parse') return JSON.stringify(value)
  if (point === 'normalize') return JSON.stringify(deepNfc(value))
  return canonicalize(deepNfc(value))
}

export interface BoundaryRun {
  signPoint: SignPoint
  mutations: Mutation[]
  /** What the producer put on the wire. */
  originalText: string
  /** What arrived after in-transit re-encoding. */
  deliveredText: string
  /** The byte string the signature was actually made over. */
  signedText: string
  /** The byte string the verifier actually checked. */
  verifiedText: string
  signature: Uint8Array
  sigValid: boolean
  /** Does the application — which consumes the END of the pipeline — recover
   *  the same value from the delivered text as from the original? */
  meaningEqual: boolean
  verdict: Verdict
}

export function runBoundary(signPoint: SignPoint, mutationList: Mutation[], kp: Keypair): BoundaryRun {
  const mutations = new Set(mutationList)
  const originalText = buildWireDoc(new Set())
  const deliveredText = buildWireDoc(mutations)

  const signedText = toSignedForm(originalText, signPoint)
  const verifiedText = toSignedForm(deliveredText, signPoint)
  const signature = sign(utf8Encode(signedText), kp.secretKey)
  const sigValid = verify(signature, utf8Encode(verifiedText), kp.publicKey)

  // The application reads the pipeline's output (full derivation), whatever
  // the signature boundary is.
  const meaningEqual = toSignedForm(deliveredText, 'canonical') === toSignedForm(originalText, 'canonical')

  const verdict: Verdict = !sigValid ? 'fail-closed' : meaningEqual ? 'ok' : 'alarm'
  return {
    signPoint,
    mutations: [...mutations],
    originalText,
    deliveredText,
    signedText,
    verifiedText,
    signature,
    sigValid,
    meaningEqual,
    verdict,
  }
}
