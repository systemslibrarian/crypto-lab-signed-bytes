import { utf8Encode } from '../core/bytes'
import { recoveredMeaning, runSignAcross } from '../lab/stages'
import { chips, h, hexDiffView, liveRegion } from './dom'
import type { LabCtx } from './context'

/** Exhibit 2 — editable byte-diff sandbox. Sign the left document's bytes,
 *  verify over the right document's bytes, and show every layer where two
 *  "equal" documents already diverge. */
export function mountSandbox(root: HTMLElement, ctx: LabCtx): void {
  const taA = h('textarea', { id: 'sandbox-a', rows: '3', 'aria-describedby': 'sandbox-note' }) as HTMLTextAreaElement
  const taB = h('textarea', { id: 'sandbox-b', rows: '3', 'aria-describedby': 'sandbox-note' }) as HTMLTextAreaElement
  taA.value = '{"amount": 1.0, "to": "alice"}'
  taB.value = '{"to":"alice","amount":1}'

  const runBtn = h('button', { class: 'primary', type: 'button' }, 'Sign left · verify right')
  const out = liveRegion('Sandbox result')

  function run(): void {
    const a = taA.value
    const b = taB.value
    let meaningLine: HTMLElement
    try {
      const equal = recoveredMeaning(a, 'last') === recoveredMeaning(b, 'last')
      meaningLine = h(
        'p',
        { class: 'digest' },
        'Parsed meaning (last-wins parser): ',
        equal
          ? h('span', { class: 'match-yes' }, '✓ identical objects')
          : h('span', { class: 'match-no' }, '✗ different objects'),
      )
    } catch (e) {
      out.replaceChildren(
        chips(null, 'fail-closed', `Could not parse: ${(e as Error).message}. Nothing was signed — malformed input fails closed.`),
      )
      return
    }
    const run = runSignAcross(a, b, ctx.kp, ctx.jcs())
    const note = run.jcsError
      ? `JCS refused the input (${run.jcsError}) — nothing signed, nothing accepted.`
      : run.verdict === 'ok'
        ? run.jcs
          ? 'With JCS on, both ends canonicalize to the same byte string before signing/verifying, so the signature verifies — and the two spellings really do carry the same meaning.'
          : 'The two texts are byte-identical, so of course the signature verifies.'
        : run.verdict === 'alarm'
          ? 'A signature verified while the parsed meanings differ — inspect the documents above.'
          : run.sigValid === false && ctx.jcs()
            ? 'Even after canonicalization the two documents are different byte strings — they genuinely disagree, and the verifier correctly refuses. Fail-closed.'
            : 'The verifier answered a question about bytes, and the bytes differ — even though a parser recovers the same object from both. Fail-closed: safe, but broken interop.'
    out.replaceChildren(
      hexDiffView('Left (signed)', utf8Encode(run.signedText), 'Right (verified)', utf8Encode(run.verifiedText)),
      meaningLine,
      chips(run.sigValid, run.verdict, note),
    )
  }

  runBtn.addEventListener('click', run)
  ctx.onJcs(run)

  root.append(
    h(
      'div',
      { class: 'grid-2' },
      h('div', {}, h('label', { for: 'sandbox-a' }, 'Document A — its bytes get signed'), taA),
      h('div', {}, h('label', { for: 'sandbox-b' }, 'Document B — its bytes get verified'), taB),
    ),
    h('p', { class: 'dim', id: 'sandbox-note' }, 'Edit freely — both fields are re-read on every run.'),
    h('div', { class: 'row' }, runBtn),
    out,
  )
  run()
}
