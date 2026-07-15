import { utf8Encode } from '../core/bytes'
import {
  ALL_MUTATIONS,
  MUTATION_INFO,
  SIGN_POINTS,
  SIGN_POINT_INFO,
  runBoundary,
  type Mutation,
  type SignPoint,
} from '../lab/boundary'
import { chips, h, hexDiffView, liveRegion, mono } from './dom'
import type { LabCtx } from './context'

/**
 * Stage 5 — a drawn receive pipeline (wire bytes → parse → NFC normalize →
 * JCS serialize) with a draggable slider that moves the signature boundary
 * between its taps. Two live outputs:
 *   - the current run (real sign/verify for the selected tap + mutations)
 *   - the full tolerance matrix: every tap × every mutation, each cell a
 *     real sign/verify run, so the whole trade-off is visible at once.
 */
export function mountStageBoundary(root: HTMLElement, ctx: LabCtx): void {
  let signAt: SignPoint = 'raw'
  const active = new Set<Mutation>()
  const out = liveRegion('Stage 5 result')
  const matrixHost = h('div', {})

  // ---- the pipeline diagram + slider -----------------------------------
  const nodes = SIGN_POINT_INFO.map((s) =>
    h(
      'div',
      { class: 'pipe-node', 'data-point': s.id },
      h('span', { class: 'pipe-node-label' }, s.label),
      h('span', { class: 'pipe-badge', 'aria-hidden': 'true' }, '✍ signed here'),
    ),
  )
  const slider = h('input', {
    type: 'range',
    id: 'boundary-slider',
    min: '0',
    max: String(SIGN_POINTS.length - 1),
    step: '1',
    value: '0',
    'aria-describedby': 'boundary-slider-detail',
  }) as HTMLInputElement
  const sliderDetail = h('p', { class: 'dim', id: 'boundary-slider-detail' })

  function paintPipeline(): void {
    const idx = SIGN_POINTS.indexOf(signAt)
    nodes.forEach((node, i) => {
      node.classList.toggle('inside', i <= idx && idx > 0 && i > 0)
      node.classList.toggle('tap', i === idx)
    })
    const info = SIGN_POINT_INFO[idx]
    slider.setAttribute('aria-valuetext', `${info.label}: ${info.detail}`)
    sliderDetail.textContent = info.detail
  }

  slider.addEventListener('input', () => {
    signAt = SIGN_POINTS[Number(slider.value)]
    paintPipeline()
    run()
  })

  // ---- mutation toggles -------------------------------------------------
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

  // ---- the tolerance matrix: 4 taps × 4 mutations, all measured live ----
  function renderMatrix(): void {
    const table = h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Signature attaches…'),
          ...MUTATION_INFO.map((m) => h('th', { scope: 'col' }, m.label)),
        ),
      ),
      h(
        'tbody',
        {},
        ...SIGN_POINT_INFO.map((s) => {
          const isCurrent = s.id === signAt
          return h(
            'tr',
            isCurrent ? { class: 'current-row', 'aria-current': 'true' } : {},
            h('th', { scope: 'row' }, s.label + (isCurrent ? ' (selected)' : '')),
            ...ALL_MUTATIONS.map((m) => {
              const r = runBoundary(s.id, [m], ctx.kp)
              return h(
                'td',
                {},
                r.sigValid
                  ? h('span', { class: 'cell-ok' }, '✓ verifies')
                  : h('span', { class: 'cell-no' }, '✗ rejected'),
              )
            }),
          )
        }),
      ),
    )
    matrixHost.replaceChildren(
      h('h3', {}, 'The whole trade-off at once'),
      h(
        'p',
        { class: 'dim' },
        'Each cell is a real sign/verify run: the mutation is applied in transit and the signature is checked at that row’s tap. Reading down a column: the boundary where a re-encoding stops breaking things is the boundary where it becomes invisible.',
      ),
      h('div', { class: 'hexbox', tabindex: '0', role: 'region', 'aria-label': 'Boundary tolerance matrix', style: 'max-height:none' }, table),
    )
  }

  // ---- the current run --------------------------------------------------
  function run(): void {
    const res = runBoundary(signAt, [...active], ctx.kp)
    const changed = res.deliveredText !== res.originalText
    const note = !changed
      ? 'No re-encoding is on: the delivered bytes are the signed bytes, and everything agrees.'
      : res.sigValid
        ? 'The wire bytes changed and the signature still verifies: the flipped re-encodings live upstream of the boundary, so the verifier re-derives them away. That byte surface is now writable in transit without detection — this pipeline declares it meaning-free, and any consumer that hashes or logs raw bytes must agree to that, or disagree with your verifier.'
        : 'The verifier refused: at this boundary the flipped re-encoding still reaches the signed byte string. Fail-closed — and note that an honest pretty-printer or proxy doing the same thing breaks the protocol identically. Strictness and interop friction are one knob.'
    out.replaceChildren(
      h('p', { class: 'hexcaption' }, 'Producer emitted → delivered after in-transit re-encoding:'),
      mono(res.originalText),
      mono(res.deliveredText),
      hexDiffView('Signed byte string', utf8Encode(res.signedText), 'Verified byte string', utf8Encode(res.verifiedText)),
      chips(res.sigValid, res.verdict, note),
    )
    renderMatrix()
  }

  root.append(
    h(
      'div',
      { class: 'pipe-wrap' },
      h('div', { class: 'pipe-track' }, ...nodes),
      h(
        'div',
        { class: 'row', style: 'margin-top:0.4rem' },
        h('label', { for: 'boundary-slider' }, h('strong', {}, 'Drag the signature boundary:')),
        slider,
      ),
      sliderDetail,
    ),
    h('fieldset', {}, h('legend', {}, 'In-transit re-encodings (the attacker/middlebox)'), h('ul', { class: 'muta-list' }, ...mutEls)),
    out,
    matrixHost,
    h(
      'details',
      {},
      h('summary', {}, 'For the expert: what the pipeline buys and what it costs'),
      h(
        'p',
        {},
        'Moving the boundary right makes the verifier tolerant of exactly the re-encodings the pipeline re-derives — and puts the parser, the normalizer, and the serializer inside the trusted computing base: a bug in any of them is now a bug in your signature scheme. This pipeline normalizes BEFORE canonicalizing because RFC 8785 deliberately never touches code points; the application here consumes the pipeline’s end, so tolerated changes never reach it in divergent form. If your application reads the raw bytes instead (many do), an accepted NFD rewrite does reach it — that is Stage 2’s trap wearing a different hat.',
      ),
    ),
  )
  paintPipeline()
  ctx.onJcs(run)
  run()
}
