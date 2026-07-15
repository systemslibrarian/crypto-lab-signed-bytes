/**
 * Stage 5 — where does the signature attach?
 *
 * A fixed document travels producer → wire → verifier. The learner picks the
 * point in the receive pipeline where signature verification happens, then
 * flips on in-transit re-encodings ("mutations"). Everything below runs the
 * real signer and the real verifier; nothing is precomputed.
 *
 * Signing points (signer and verifier always use the SAME convention):
 *   'raw'          sign/verify the exact wire bytes
 *   'reserialize'  both ends parse with JSON.parse and re-serialize with
 *                  JSON.stringify, then sign/verify THOSE bytes (a common
 *                  ad-hoc "fix" — the parser is now inside the trust boundary)
 *   'canonical'    both ends canonicalize with JCS (RFC 8785), then
 *                  sign/verify the canonical bytes
 *
 * For each run we report, independently:
 *   sigValid      — the real Ed25519 verifier's answer
 *   meaningEqual  — does the application (JSON.parse) recover the same value
 *                   from the delivered text as from the original?
 *   verdict       — ok / fail-closed / alarm derived from the two above
 */
import { utf8Encode } from '../core/bytes'
import { sign, verify, type Keypair } from '../crypto/ed25519'
import { canonicalize, canonicalizeText } from '../jcs/canonicalize'
import { E_ACUTE_NFC, E_ACUTE_NFD, type Verdict } from './stages'

export type SignPoint = 'raw' | 'reserialize' | 'canonical'
export type Mutation = 'whitespace' | 'numberform' | 'reorder' | 'nfd'

export const ALL_MUTATIONS: Mutation[] = ['whitespace', 'numberform', 'reorder', 'nfd']

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
    id: 'reorder',
    label: 'Reorder object keys',
    detail: 'Members swap position. For a JSON object read as a map, order carries no meaning.',
  },
  {
    id: 'nfd',
    label: 'Unicode-normalize to NFD',
    detail: 'é (U+00E9) becomes e + U+0301. Renders identically, but the application now receives a different code-point sequence.',
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
  /** Does JSON.parse recover the same value from delivered as from original? */
  meaningEqual: boolean
  verdict: Verdict
}

function toSignedForm(text: string, point: SignPoint): string {
  if (point === 'raw') return text
  if (point === 'reserialize') return JSON.stringify(JSON.parse(text))
  return canonicalizeText(text)
}

export function runBoundary(signPoint: SignPoint, mutationList: Mutation[], kp: Keypair): BoundaryRun {
  const mutations = new Set(mutationList)
  const originalText = buildWireDoc(new Set())
  const deliveredText = buildWireDoc(mutations)

  const signedText = toSignedForm(originalText, signPoint)
  const verifiedText = toSignedForm(deliveredText, signPoint)
  const signature = sign(utf8Encode(signedText), kp.secretKey)
  const sigValid = verify(signature, utf8Encode(verifiedText), kp.publicKey)

  const meaningEqual =
    canonicalize(JSON.parse(deliveredText)) === canonicalize(JSON.parse(originalText))

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
