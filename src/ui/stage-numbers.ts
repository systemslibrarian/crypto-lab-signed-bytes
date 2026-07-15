import { runNumberForm } from '../lab/stages'
import { serializeNumber } from '../jcs/canonicalize'
import { h, liveRegion } from './dom'
import type { LabCtx } from './context'

const DEFAULT_FORMS = ['1', '1.0', '1e0', '1.0000000000000001']

/**
 * Stage 4 — number spellings. Each row runs the real pipeline: sign the raw
 * spelling, let a gateway parse/re-serialize (float64 round-trip), verify
 * what arrives.
 */
export function mountStageNumbers(root: HTMLElement, ctx: LabCtx): void {
  const custom = h('input', { type: 'text', id: 'num-custom', 'aria-describedby': 'num-custom-note' }) as HTMLInputElement
  custom.value = '1.00'
  const addBtn = h('button', { type: 'button' }, 'Run my spelling')
  const out = liveRegion('Stage 4 results')
  let extra: string | null = null

  function row(form: string): HTMLElement {
    let cells: HTMLElement[]
    try {
      const res = runNumberForm(form, ctx.kp, ctx.jcs())
      const changed = res.roundTripped !== form
      cells = [
        h('td', {}, h('code', {}, form)),
        h('td', {}, h('code', {}, String(res.roundTripped))),
        h('td', {}, changed ? h('span', { class: 'cell-no' }, '✗ rewritten') : h('span', { class: 'cell-ok' }, '✓ unchanged')),
        h('td', {}, res.sigValid ? h('span', { class: 'cell-ok' }, 'valid ✓') : h('span', {}, 'invalid ✗')),
        h(
          'td',
          {},
          res.verdict === 'ok'
            ? h('span', { class: 'cell-ok' }, '✓ OK')
            : h('span', { class: 'cell-no' }, '⛔ FAIL-CLOSED'),
        ),
      ]
    } catch (e) {
      cells = [
        h('td', {}, h('code', {}, form)),
        h('td', { colspan: '4' }, `not a JSON number (${(e as Error).message}) — nothing signed, fails closed`),
      ]
    }
    return h('tr', {}, ...cells)
  }

  function run(): void {
    const forms = extra !== null && !DEFAULT_FORMS.includes(extra) ? [...DEFAULT_FORMS, extra] : DEFAULT_FORMS
    const jcs = ctx.jcs()
    out.replaceChildren(
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Producer signs'),
            h('th', { scope: 'col' }, 'After one parse/re-serialize hop'),
            h('th', { scope: 'col' }, 'Byte spelling'),
            h('th', { scope: 'col' }, 'Signature (Ed25519)'),
            h('th', { scope: 'col' }, 'Verdict'),
          ),
        ),
        h('tbody', {}, ...forms.map(row)),
      ),
      h(
        'p',
        { class: 'verdict-note' },
        jcs
          ? 'With JCS on, both ends sign and verify the canonical spelling (ECMAScript shortest-round-trip form), so every row verifies: the signature now binds the number VALUE as float64 recovers it, not the spelling. Note what was given up: 1.0000000000000001 was already indistinguishable from 1 to every float64 parser — canonicalization just makes the signature agree with that loss instead of fighting it.'
          : 'Every spelling of the same float64 is a different byte string, and only the spelling that survives the round-trip verbatim ("1") keeps its signature. The application-recovered VALUE is identical in every row — each rejection is fail-closed friction, not a security save. And 1.0000000000000001 is the sharpest case: JSON-the-text distinguishes it from 1, float64 cannot.',
      ),
    )
  }

  addBtn.addEventListener('click', () => {
    extra = custom.value.trim()
    run()
  })
  ctx.onJcs(run)
  root.append(
    h(
      'div',
      { class: 'row' },
      h('label', { for: 'num-custom' }, 'Try your own spelling:'),
      custom,
      addBtn,
    ),
    h('p', { class: 'dim', id: 'num-custom-note' }, 'e.g. 1e2, 0.1, 100.00, 9007199254740993'),
    out,
    h(
      'details',
      {},
      h('summary', {}, 'For the expert: what JCS numbers do and do not preserve'),
      h(
        'p',
        {},
        'RFC 8785 serializes numbers with ECMAScript Number::toString — the shortest decimal string that round-trips to the same IEEE-754 double (Appendix B of the RFC is a table of these; this demo passes all 24 as known-answer tests, plus the NaN/Infinity rejections). Distinct doubles always stay distinct: ',
        h('code', {}, '1e+23'),
        ' and ',
        h('code', {}, '1.0000000000000001e+23'),
        ' are different floats (',
        h('code', {}, serializeNumber(1e23)),
        ' vs ',
        h('code', {}, serializeNumber(1.0000000000000001e23)),
        '). What is NOT preserved is anything float64 itself cannot hold: 64-bit integers beyond 2^53, trailing zeros, exponent style. If those distinctions are meaning in your protocol, JSON numbers are the wrong carrier — use strings, or a format with real integers.',
      ),
    ),
  )
  run()
}
