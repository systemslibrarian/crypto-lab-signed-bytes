import { utf8Encode } from '../core/bytes'
import { JsonParseError } from '../json/parse'
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
    let sameMeaning: boolean
    try {
      sameMeaning = recoveredMeaning(a, 'last') === recoveredMeaning(b, 'last')
    } catch (e) {
      const reason = e instanceof JsonParseError ? 'Could not parse:' : 'Cannot compare these JSON values.'
      out.replaceChildren(
        chips(null, 'fail-closed', `${reason} ${(e as Error).message}. Signing and verification did not run.`),
      )
      return
    }
    const meaningLine = h('p', { class: 'digest' }, 'Last-wins parser comparison · ',
      sameMeaning
        ? h('span', { class: 'match-yes' }, '✓ same JSON value')
        : h('span', { class: 'match-no' }, '✗ different JSON values'),
    )
    const run = runSignAcross(a, b, ctx.kp, ctx.jcs())
    if (run.jcsError) {
      out.replaceChildren(meaningLine, chips(null, 'fail-closed', `JCS refused the input. ${run.jcsError}. Signing and verification did not run.`))
      return
    }
    let note: string
    if (run.verdict === 'ok') {
      note = run.jcs
        ? 'Both documents canonicalize to the same bytes, so the signature verifies.'
        : 'The two texts are byte-identical, so the signature verifies.'
    } else if (run.verdict === 'alarm') {
      note = 'The signature verified, but the parser produced different JSON values.'
    } else {
      note = sameMeaning
        ? 'The parser recovered the same JSON value from both documents. Their different bytes caused verification to fail.'
        : 'The documents encode different JSON values. The signature for the left document failed verification on the right.'
    }
    out.replaceChildren(
      hexDiffView('Left (signed)', utf8Encode(run.signedText), 'Right (verified)', utf8Encode(run.verifiedText)),
      meaningLine,
      chips(run.sigValid, run.verdict, note),
    )
  }

  function retire(): void {
    if (!out.firstElementChild) return
    out.textContent = 'Document edited. Run the comparison to sign and verify the current text.'
  }

  taA.addEventListener('input', retire)
  taB.addEventListener('input', retire)
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
