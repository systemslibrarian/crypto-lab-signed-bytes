import { utf8Encode } from '../core/bytes'
import { runDuplicates } from '../lab/stages'
import { chips, h, hexDiffView, liveRegion, sigLine } from './dom'
import type { LabCtx } from './context'

/**
 * Stage 3 — the centerpiece. The learner plays the attacker: craft a document
 * with duplicate keys, get it signed (the signing service's policy check reads
 * first-wins and sees nothing wrong), then watch the application (last-wins)
 * act on the other value while the signature stays genuinely valid.
 */
export function mountStageDup(root: HTMLElement, ctx: LabCtx): void {
  const ta = h('textarea', { id: 'dup-doc', rows: '2' }) as HTMLTextAreaElement
  ta.value = '{"role":"user","role":"admin"}'
  const runBtn = h('button', { class: 'primary', type: 'button' }, 'Sign the exact bytes, then verify & parse')
  const out = liveRegion('Stage 3 result')

  function viewBox(title: string, body: string, alarm: boolean): HTMLElement {
    return h(
      'div',
      {},
      h('p', { class: 'hexcaption' }, title),
      h('div', { class: alarm ? 'wirebytes' : 'wirebytes' }, body),
    )
  }

  function run(): void {
    const res = runDuplicates(ta.value, ctx.kp, ctx.jcs())
    if (res.jcsError !== undefined) {
      const why = ctx.jcs()
        ? `JCS refused the document before anything was signed: ${res.jcsError}. RFC 8785 requires I-JSON input (RFC 7493), which forbids duplicate member names — canonicalization does not resolve the ambiguity, it refuses to touch it. Note what this means: the fix for duplicate keys is a PARSER policy (reject), not a serializer. If some upstream parser already collapsed the duplicate before JCS ran, the damage happened out of its sight.`
        : `The parser refused the document: ${res.jcsError}. Nothing was signed or accepted.`
      out.replaceChildren(chips(res.sigValid ? true : null, res.verdict, why))
      return
    }
    const diverged = res.verifierView !== res.applicationView
    const note = diverged
      ? `The signature is genuinely valid — these are the exact bytes that were signed, untouched. And yet the verifier's policy check authorized ${res.verifierView} while the application will act on ${res.applicationView}. Both parsers conform to RFC 8259. No cryptographic check failed, and the system is still compromised: "the bytes were signed" never implied "every parser recovers the same meaning from them." This is why the verdict light is red while the signature light says valid.`
      : 'No duplicate keys, so every conforming parser recovers the same object: the valid signature and the intact meaning coincide, and green is honest here.'
    const bytes = utf8Encode(res.signedText)
    out.replaceChildren(
      hexDiffView('Bytes signed', bytes, 'Bytes verified (identical)', utf8Encode(res.verifiedText)),
      sigLine(res.signature),
      h(
        'div',
        { class: 'grid-2' },
        viewBox('Verifier’s policy check parses (first-wins) and authorizes:', res.verifierView, false),
        viewBox('Application parses (last-wins, like JSON.parse) and acts on:', res.applicationView, diverged),
      ),
      chips(res.sigValid, res.verdict, note),
    )
  }

  runBtn.addEventListener('click', run)
  ctx.onJcs(run)
  root.append(
    h('label', { for: 'dup-doc' }, 'Craft the document the signing service will sign:'),
    ta,
    h('div', { class: 'row' }, runBtn),
    out,
    h(
      'details',
      {},
      h('summary', {}, 'For the expert: where this has bitten real systems'),
      h(
        'p',
        {},
        'Parser differentials over duplicate keys (and their cousins in other formats) power interoperability attacks wherever one component validates and a different component consumes: signed OAuth/OIDC payloads, policy documents, transaction metadata, package manifests. The defense is boring and total: reject duplicates at parse time (I-JSON, RFC 7493 §2.3) in EVERY component, or better, parse once and pass the parsed value — never re-parse the raw bytes downstream of validation.',
      ),
    ),
  )
  run()
}
