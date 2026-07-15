import { diffMask, toHex } from '../core/bytes'
import { sha256Hex } from '../core/hash'
import type { Verdict } from '../lab/stages'

type Child = Node | string | null | undefined

export function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  for (const c of children) {
    if (c === null || c === undefined) continue
    el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return el
}

/**
 * VERDICT SEPARATION — the lab's core UI contract.
 *
 * chipCrypto: the raw return value of the real Ed25519 verifier. Rendered
 * NEUTRALLY on purpose: "the math said yes" is a statement about bytes, not
 * about safety, so it never gets success/danger coloring.
 *
 * chipVerdict: the system-integrity verdict, independently derived. Color
 * lives here and tracks integrity, not the boolean: a valid signature whose
 * meaning diverged renders as ALARM (red), never as green.
 */
export function chipCrypto(valid: boolean | null): HTMLElement {
  const state = valid === null ? 'NOT RUN' : valid ? 'VALID ✓' : 'INVALID ✗'
  return h(
    'span',
    { class: 'chip chip-crypto' },
    h('span', { class: 'chip-tag' }, 'Signature (Ed25519)'),
    h('span', { class: 'chip-state' }, state),
  )
}

const VERDICT_META: Record<Verdict, { cls: string; icon: string; label: string }> = {
  ok: { cls: 'v-ok', icon: '✓', label: 'OK' },
  'fail-closed': { cls: 'v-failclosed', icon: '⛔', label: 'FAIL-CLOSED' },
  alarm: { cls: 'v-alarm', icon: '⚠', label: 'ALARM' },
}

export function chipVerdict(verdict: Verdict): HTMLElement {
  const m = VERDICT_META[verdict]
  return h(
    'span',
    { class: `chip chip-verdict ${m.cls}` },
    h('span', { class: 'chip-tag' }, 'Verdict'),
    h('span', { class: 'chip-state' }, `${m.icon} ${m.label}`),
  )
}

export function chips(sigValid: boolean | null, verdict: Verdict, note: string): HTMLElement {
  return h(
    'div',
    {},
    h('div', { class: 'chips' }, chipCrypto(sigValid), chipVerdict(verdict)),
    h('p', { class: 'verdict-note' }, note),
  )
}

function hexLines(bytes: Uint8Array, mask: boolean[]): HTMLElement[] {
  const lines: HTMLElement[] = []
  for (let off = 0; off < bytes.length; off += 16) {
    const line = h('div', { class: 'hexline' })
    for (let i = off; i < Math.min(off + 16, bytes.length); i++) {
      line.append(h('span', { class: mask[i] ? 'b d' : 'b' }, bytes[i].toString(16).padStart(2, '0')))
    }
    lines.push(line)
  }
  if (bytes.length === 0) lines.push(h('div', { class: 'hexline dim' }, '(empty)'))
  return lines
}

/** Side-by-side hex of two byte strings with differing bytes marked (color +
 *  bold + underline), SHA-256 of each, and a text summary of the diff. */
export function hexDiffView(labelA: string, a: Uint8Array, labelB: string, b: Uint8Array): HTMLElement {
  const mask = diffMask(a, b)
  const nDiff = mask.filter(Boolean).length
  const hashA = sha256Hex(a)
  const hashB = sha256Hex(b)
  const same = hashA === hashB
  const box = (label: string, bytes: Uint8Array, hash: string) =>
    h(
      'div',
      {},
      h('p', { class: 'hexcaption' }, `${label} — ${bytes.length} bytes (UTF-8)`),
      h('div', { class: 'hexbox', tabindex: '0', role: 'region', 'aria-label': `${label} bytes in hexadecimal` }, ...hexLines(bytes, mask)),
      h('p', { class: 'digest' }, 'SHA-256: ', h('span', {}, hash.slice(0, 32) + '…')),
    )
  return h(
    'div',
    {},
    h('div', { class: 'hexpair' }, box(labelA, a, hashA), box(labelB, b, hashB)),
    h(
      'p',
      { class: 'hexcaption' },
      same
        ? h('span', { class: 'digest' }, h('span', { class: 'match-yes' }, '✓ identical'), ' — byte strings and SHA-256 digests match exactly.')
        : h(
            'span',
            { class: 'digest' },
            h('span', { class: 'match-no' }, `✗ ${nDiff} of ${Math.max(a.length, b.length)} byte positions differ`),
            ' — the SHA-256 digests do not match.',
          ),
    ),
  )
}

/** Code-point strip: each code point with its glyph and U+XXXX, positions
 *  differing from `other` marked (color + border + text in the label). */
export function codePointStrip(label: string, s: string, other: string): HTMLElement {
  const cps = [...s]
  const ocps = [...other]
  const strip = h('div', { class: 'cp-strip', role: 'list', 'aria-label': `${label}: code points` })
  cps.forEach((cp, i) => {
    const code = cp.codePointAt(0)!
    const differs = i >= ocps.length || ocps[i] !== cp
    strip.append(
      h(
        'span',
        { class: differs ? 'cp cp-diff' : 'cp', role: 'listitem' },
        h('span', { class: 'cp-glyph', 'aria-hidden': 'true' }, code === 0x301 ? '◌́' : cp),
        h('span', { class: 'cp-code' }, 'U+' + code.toString(16).toUpperCase().padStart(4, '0') + (differs ? ' ≠' : '')),
      ),
    )
  })
  return h('div', {}, h('p', { class: 'hexcaption' }, label), strip)
}

/** A polite live region so dynamic results are announced (WCAG 4.1.3). */
export function liveRegion(label: string): HTMLElement {
  return h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': label })
}

export function sigLine(signature: Uint8Array): HTMLElement {
  return h('p', { class: 'keyline' }, 'signature (64 bytes): ', toHex(signature))
}

export function mono(text: string): HTMLElement {
  return h('div', { class: 'wirebytes' }, text)
}
