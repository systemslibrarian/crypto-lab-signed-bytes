import { utf8Encode } from '../core/bytes'
import { runSignAcross } from '../lab/stages'
import { chips, h, hexDiffView, liveRegion, mono } from './dom'
import type { LabCtx } from './context'

/** Stage 1 — the minimal pair from the brief: {"a":1,"b":2} vs {"b":2,"a":1}. */
export function mountStageOrder(root: HTMLElement, ctx: LabCtx): void {
  const docA = '{"a":1,"b":2}'
  const docB = '{"b":2,"a":1}'
  const runBtn = h('button', { class: 'primary', type: 'button' }, 'Sign A, verify B')
  const out = liveRegion('Stage 1 result')

  function run(): void {
    const res = runSignAcross(docA, docB, ctx.kp, ctx.jcs())
    const pre = ctx.jcs()
      ? h(
          'p',
          { class: 'dim' },
          'JCS is ON: both ends canonicalize first. A was signed as ',
          h('code', {}, res.signedText),
          ' and B canonicalizes to ',
          h('code', {}, res.verifiedText),
          ' — the same byte string.',
        )
      : null
    const note = res.sigValid
      ? 'With one canonical spelling, "same object" and "same bytes" coincide again — the signature survives reordering because reordering can no longer reach the signed bytes.'
      : 'Every JSON parser agrees these are the same object, and the verifier still says no — because it was never asked about objects. It was asked about bytes, and the bytes moved. Fail-closed: nothing wrong was accepted, but two honest systems just stopped interoperating.'
    out.replaceChildren(
      pre ?? h('span', {}),
      hexDiffView('A (signed)', utf8Encode(res.signedText), 'B (verified)', utf8Encode(res.verifiedText)),
      chips(res.sigValid, res.verdict, note),
    )
  }

  runBtn.addEventListener('click', run)
  ctx.onJcs(run)
  root.append(
    h('div', { class: 'grid-2' }, h('div', {}, h('p', { class: 'hexcaption' }, 'Document A'), mono(docA)), h('div', {}, h('p', { class: 'hexcaption' }, 'Document B'), mono(docB))),
    h('div', { class: 'row' }, runBtn),
    out,
  )
  run()
}
