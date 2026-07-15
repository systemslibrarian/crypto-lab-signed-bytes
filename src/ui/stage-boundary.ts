import { utf8Encode } from '../core/bytes'
import { MUTATION_INFO, runBoundary, type Mutation, type SignPoint } from '../lab/boundary'
import { chips, h, hexDiffView, liveRegion, mono } from './dom'
import type { LabCtx } from './context'

const STOPS: Array<{ id: SignPoint; label: string; blurb: string }> = [
  {
    id: 'raw',
    label: 'At the raw bytes',
    blurb: 'Sign and verify the exact wire bytes. Maximum strictness: any re-encoding anywhere breaks it.',
  },
  {
    id: 'reserialize',
    label: 'After parse + re-serialize',
    blurb: 'Both ends parse with JSON.parse and re-serialize with JSON.stringify, then sign/verify those bytes — a common ad-hoc fix.',
  },
  {
    id: 'canonical',
    label: 'After JCS canonicalization',
    blurb: 'Both ends canonicalize (RFC 8785), then sign/verify the canonical bytes.',
  },
]

/** Stage 5 — drag the signature boundary along the pipeline, flip on
 *  in-transit re-encodings, watch the real verifier's tolerance change. */
export function mountStageBoundary(root: HTMLElement, ctx: LabCtx): void {
  let signAt: SignPoint = 'raw'
  const active = new Set<Mutation>()
  const out = liveRegion('Stage 5 result')

  const stopEls = STOPS.map((s) => {
    const input = h('input', { type: 'radio', name: 'sign-at', id: `stop-${s.id}`, value: s.id }) as HTMLInputElement
    if (s.id === signAt) input.checked = true
    input.addEventListener('change', () => {
      if (input.checked) {
        signAt = s.id
        paint()
        run()
      }
    })
    return h(
      'div',
      { class: 'boundary-stop', 'data-stop': s.id },
      h('div', {}, input, ' ', h('label', { for: `stop-${s.id}` }, h('strong', {}, s.label))),
      h('p', { class: 'dim', style: 'margin:0.2rem 0 0' }, s.blurb),
    )
  })

  function paint(): void {
    stopEls.forEach((el) => el.classList.toggle('selected', el.getAttribute('data-stop') === signAt))
  }

  const mutEls = MUTATION_INFO.map((m) => {
    const input = h('input', { type: 'checkbox', id: `mut-${m.id}` }) as HTMLInputElement
    input.addEventListener('change', () => {
      if (input.checked) active.add(m.id)
      else active.delete(m.id)
      run()
    })
    return h(
      'li',
      {},
      h('div', {}, input, ' ', h('label', { for: `mut-${m.id}` }, h('strong', {}, m.label))),
      h('p', { class: 'dim', style: 'margin:0.15rem 0 0 1.6rem' }, m.detail),
    )
  })

  function run(): void {
    const res = runBoundary(signAt, [...active], ctx.kp)
    const changed = res.deliveredText !== res.originalText
    const note = !changed
      ? 'No re-encoding is on: the delivered bytes are the signed bytes, and everything agrees.'
      : res.sigValid
        ? 'The signature still verifies even though the wire bytes changed — the flipped re-encodings live OUTSIDE what this boundary signs. That is the trade: those byte surfaces are now attacker-writable without detection. Here each of them is meaning-free to a JSON application (the application recovers the identical object), but any downstream system that assigns meaning to raw bytes — content hashes, audit logs, dedup — now disagrees with your verifier.'
        : 'The verifier refused: at this boundary, the flipped re-encoding still reaches the signed byte string. Fail-closed — which also means every HONEST middlebox that does the same re-encoding breaks your protocol. Strictness and interop friction are the same knob.'
    out.replaceChildren(
      h('p', { class: 'hexcaption' }, 'Producer emitted:'),
      mono(res.originalText),
      h('p', { class: 'hexcaption' }, 'Delivered after in-transit re-encoding:'),
      mono(res.deliveredText),
      h('p', { class: 'hexcaption' }, `Signature computed over (${signAt === 'raw' ? 'raw wire bytes' : signAt === 'reserialize' ? 'both ends re-serialize before signing/verifying' : 'both ends canonicalize before signing/verifying'}):`),
      hexDiffView('Signed byte string', utf8Encode(res.signedText), 'Verified byte string', utf8Encode(res.verifiedText)),
      chips(res.sigValid, res.verdict, note),
    )
  }

  root.append(
    h('fieldset', {}, h('legend', {}, 'Apply the signature…'), h('div', { class: 'boundary-track' }, ...stopEls)),
    h('fieldset', {}, h('legend', {}, 'In-transit re-encodings (the attacker/middlebox)'), h('ul', { class: 'muta-list' }, ...mutEls)),
    out,
  )
  paint()
  ctx.onJcs(run)
  run()
}
