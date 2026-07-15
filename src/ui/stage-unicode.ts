import { utf8Encode } from '../core/bytes'
import { E_ACUTE_NFC, E_ACUTE_NFD, runUnicode, type UnicodeMode } from '../lab/stages'
import { chips, codePointStrip, h, hexDiffView, liveRegion } from './dom'
import type { LabCtx } from './context'

const MODES: Array<{ id: UnicodeMode; label: string; blurb: string }> = [
  {
    id: 'divergent',
    label: 'No normalization (the default reality)',
    blurb: 'The signer emits precomposed é (NFC); the receiver holds the decomposed spelling (NFD) — e.g. a filename that crossed a macOS filesystem. Nobody normalizes.',
  },
  {
    id: 'normalize-before',
    label: 'Normalize to NFC before signing AND before verifying',
    blurb: 'Both parties adopt the same contract: NFC-normalize, then sign/verify. The repair happens on both sides of the signature.',
  },
  {
    id: 'normalize-after',
    label: 'Normalize AFTER signing (the trap)',
    blurb: 'The signature is made over NFC bytes; then a "helpful" layer normalizes the already-signed message to NFD in transit.',
  },
]

const NOTES: Record<UnicodeMode, (sigValid: boolean) => string> = {
  divergent: () =>
    'Your screen renders both documents identically — the difference exists only at the code-point level, and the signature lives below even that, at the byte level. Fail-closed: nothing forged, but two systems that "obviously" hold the same text cannot agree.',
  'normalize-before': () =>
    'Repaired. Normalization is safe exactly here: applied identically on both sides, BEFORE the bytes are signed and BEFORE they are verified, it becomes part of the agreed encoding.',
  'normalize-after': () =>
    'Broken by helpfulness. To Ed25519, normalization-after-signing is byte tampering — the verifier cannot tell a Unicode cleanup from an attack, and must not try. Any transformation applied after signing sits outside the signature’s protection and breaks it.',
}

/** Stage 2 — NFC vs NFD. Same glyphs, different code points, different bytes. */
export function mountStageUnicode(root: HTMLElement, ctx: LabCtx): void {
  let mode: UnicodeMode = 'divergent'
  const out = liveRegion('Stage 2 result')

  const radios = MODES.map((m) => {
    const input = h('input', { type: 'radio', name: 'unicode-mode', id: `um-${m.id}`, value: m.id }) as HTMLInputElement
    if (m.id === mode) input.checked = true
    input.addEventListener('change', () => {
      if (input.checked) {
        mode = m.id
        run()
      }
    })
    return h('div', {}, h('div', {}, input, ' ', h('label', { for: `um-${m.id}` }, h('strong', {}, m.label))), h('p', { class: 'dim', style: 'margin:0.1rem 0 0.5rem 1.6rem' }, m.blurb))
  })

  function run(): void {
    const res = runUnicode(mode, ctx.kp, ctx.jcs())
    const jcsNote = ctx.jcs()
      ? h(
          'p',
          { class: 'dim' },
          'JCS is ON and changes nothing here: RFC 8785 sorts keys and respells numbers but never alters the code points inside a string. An NFD é passes through canonicalization untouched.',
        )
      : null
    out.replaceChildren(
      h(
        'div',
        { class: 'grid-2' },
        codePointStrip(`Signer's string ("${E_ACUTE_NFC}")`, E_ACUTE_NFC, mode === 'normalize-before' ? E_ACUTE_NFC : E_ACUTE_NFD),
        codePointStrip(
          `Receiver's string (renders as "${E_ACUTE_NFD}")`,
          mode === 'normalize-before' ? E_ACUTE_NFD.normalize('NFC') : E_ACUTE_NFD,
          E_ACUTE_NFC,
        ),
      ),
      hexDiffView('Bytes signed', utf8Encode(res.signedText), 'Bytes verified', utf8Encode(res.verifiedText)),
      jcsNote ?? h('span', {}),
      chips(res.sigValid, res.verdict, NOTES[mode](res.sigValid)),
    )
  }

  root.append(
    h('fieldset', {}, h('legend', {}, 'Who normalizes, and when?'), ...radios),
    out,
    h(
      'details',
      {},
      h('summary', {}, 'For the expert: why not have the verifier normalize?'),
      h(
        'p',
        {},
        'Verify-then-normalize keeps the signature over the exact received bytes, so it stays sound; normalize-then-verify means the verifier accepts any pre-image of the normalized form — the signature no longer pins down which bytes were sent, only an equivalence class. That is sometimes an acceptable design (it is exactly what canonicalization schemes formalize), but it must be a deliberate, documented contract on both sides — never something a transport layer does on its own. UTS #15 normalization is also not injective: distinct inputs collapse, so any byte-addressed system downstream (dedup, audit logs, content hashes) will disagree with the verifier about identity.',
      ),
    ),
  )
  ctx.onJcs(run)
  run()
}
