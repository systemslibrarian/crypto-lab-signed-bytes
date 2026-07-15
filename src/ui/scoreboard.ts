import { runDuplicates, runNumberForm, runSignAcross, runUnicode } from '../lab/stages'
import { h } from './dom'
import type { LabCtx } from './context'

/**
 * The tally: for each stage's failure, actually re-run it with JCS off and
 * with JCS on, and report what the real verifier did. Compute-both-sides,
 * never assert.
 */
export function mountScoreboard(root: HTMLElement, ctx: LabCtx): void {
  const kp = ctx.kp

  interface Row {
    failure: string
    stage: string
    without: string
    withJcs: string
    fixed: 'yes' | 'no' | 'rejected'
    why: string
  }

  function describe(sigValid: boolean, verdict: string): string {
    if (verdict === 'alarm') return 'signature valid ✓ + meaning diverged — ALARM'
    return sigValid ? 'signature valid ✓ — accepted' : 'signature invalid ✗ — fail-closed'
  }

  function compute(): Row[] {
    const orderOff = runSignAcross('{"a":1,"b":2}', '{"b":2,"a":1}', kp, false)
    const orderOn = runSignAcross('{"a":1,"b":2}', '{"b":2,"a":1}', kp, true)
    const numOff = runNumberForm('1.0', kp, false)
    const numOn = runNumberForm('1.0', kp, true)
    const uniOff = runUnicode('divergent', kp, false)
    const uniOn = runUnicode('divergent', kp, true)
    const dupDoc = '{"role":"user","role":"admin"}'
    const dupOff = runDuplicates(dupDoc, kp, false)
    const dupOn = runDuplicates(dupDoc, kp, true)

    return [
      {
        failure: 'Key order changed in transit',
        stage: 'Stage 1',
        without: describe(orderOff.sigValid, orderOff.verdict),
        withJcs: describe(orderOn.sigValid, orderOn.verdict),
        fixed: orderOn.sigValid && orderOn.verdict === 'ok' ? 'yes' : 'no',
        why: 'JCS fixes it: canonical key order makes every member ordering the same byte string.',
      },
      {
        failure: 'Number respelled (1.0 → 1)',
        stage: 'Stage 4',
        without: describe(numOff.sigValid, numOff.verdict),
        withJcs: describe(numOn.sigValid, numOn.verdict),
        fixed: numOn.sigValid && numOn.verdict === 'ok' ? 'yes' : 'no',
        why: 'JCS fixes it: one canonical spelling per float64 value.',
      },
      {
        failure: 'Unicode NFC/NFD divergence',
        stage: 'Stage 2',
        without: describe(uniOff.sigValid, uniOff.verdict),
        withJcs: describe(uniOn.sigValid, uniOn.verdict),
        fixed: uniOn.sigValid && uniOn.verdict === 'ok' ? 'yes' : 'no',
        why: 'NOT fixed: RFC 8785 never alters the code points inside strings. Normalization is a separate contract both sides must adopt before signing.',
      },
      {
        failure: 'Duplicate keys, two parser policies',
        stage: 'Stage 3',
        without: describe(dupOff.sigValid, dupOff.verdict),
        withJcs: dupOn.jcsError !== undefined ? 'rejected at parse — nothing signed' : describe(dupOn.sigValid, dupOn.verdict),
        fixed: dupOn.jcsError !== undefined ? 'rejected' : dupOn.verdict === 'ok' ? 'yes' : 'no',
        why: 'NOT canonicalized: JCS requires I-JSON input and refuses duplicates outright. The real hazard — two parsers disagreeing — happens upstream of any serializer, so the defense is a parser policy (reject duplicates everywhere), not canonicalization.',
      },
    ]
  }

  function render(): void {
    const rows = compute()
    const table = h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Failure'),
          h('th', { scope: 'col' }, 'Without JCS (measured)'),
          h('th', { scope: 'col' }, 'With JCS (measured)'),
          h('th', { scope: 'col' }, 'Repaired by JCS?'),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            {},
            h('td', {}, h('strong', {}, r.failure), h('span', { class: 'dim' }, ` (${r.stage})`)),
            h('td', {}, r.without),
            h('td', {}, r.withJcs),
            h(
              'td',
              {},
              r.fixed === 'yes'
                ? h('span', { class: 'cell-ok' }, '✓ yes')
                : r.fixed === 'rejected'
                  ? h('span', { class: 'cell-no' }, '⛔ refused instead')
                  : h('span', { class: 'cell-no' }, '✗ no'),
              h('p', { class: 'dim', style: 'margin:0.2rem 0 0; font-size:0.82rem' }, r.why),
            ),
          ),
        ),
      ),
    )
    root.replaceChildren(
      h('div', { class: 'hexbox', tabindex: '0', role: 'region', 'aria-label': 'JCS repair scoreboard', style: 'max-height:none; overflow:auto' }, table),
      h(
        'p',
        { class: 'verdict-note' },
        'The pattern: canonicalization repairs exactly the failures that live in the SERIALIZER — spelling choices for one agreed value. It cannot repair failures that live in the PARSER (duplicate keys) or in the text model itself (Unicode composition). A signature over canonical bytes still binds bytes; it just chooses which bytes both sides will agree to compute.',
      ),
    )
  }

  render()
  ctx.onJcs(render)
}
