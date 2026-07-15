import { utf8Encode } from '../core/bytes'
import { sign, verify } from '../crypto/ed25519'
import { chips, h, hexDiffView, liveRegion, mono, sigLine } from './dom'
import type { LabCtx } from './context'

/**
 * Exhibit 1 — the headline mechanism, shown as a step-through (never asserted
 * in prose): producer signs exact bytes → gateway re-serializes → verifier
 * rejects. All values on screen come from the real signer/verifier at click
 * time; the only motion is step reveal driven by the learner's button.
 */
export function mountMechanism(root: HTMLElement, ctx: LabCtx): void {
  const producerDoc = '{"amount": 1.0, "currency": "USD"}'
  const gatewayDoc = JSON.stringify(JSON.parse(producerDoc)) // {"amount":1,"currency":"USD"}

  const stepsHost = liveRegion('Mechanism walkthrough steps')
  const nextBtn = h('button', { class: 'primary', type: 'button' }, 'Start the walkthrough')
  const resetBtn = h('button', { type: 'button', hidden: '' }, 'Start over')

  let steps: HTMLElement[] = []
  let shown = 0

  function build(): void {
    const signedBytes = utf8Encode(producerDoc)
    const signature = sign(signedBytes, ctx.kp.secretKey)
    const deliveredBytes = utf8Encode(gatewayDoc)
    const sigValid = verify(signature, deliveredBytes, ctx.kp.publicKey)

    steps = [
      h(
        'div',
        { class: 'step', hidden: '' },
        h('span', { class: 'step-n' }, 'Step 1 · The producer writes an invoice'),
        mono(producerDoc),
        h('p', { class: 'dim' }, `As UTF-8 this is ${signedBytes.length} bytes — spaces, the ".0", everything.`),
      ),
      h(
        'div',
        { class: 'step', hidden: '' },
        h('span', { class: 'step-n' }, 'Step 2 · …and signs those exact bytes'),
        h('p', {}, 'Ed25519 sees no JSON, no object, no numbers — only the byte string:'),
        sigLine(signature),
        h('p', { class: 'dim' }, 'This signature is a claim about one byte string and nothing else.'),
      ),
      h(
        'div',
        { class: 'step', hidden: '' },
        h('span', { class: 'step-n' }, 'Step 3 · A gateway tidies it in transit'),
        h('p', {}, 'A proxy parses the JSON and re-serializes it — same object, tidier spelling:'),
        mono(gatewayDoc),
        hexDiffView('Bytes that were signed', signedBytes, 'Bytes that arrive', deliveredBytes),
      ),
      h(
        'div',
        { class: 'step', hidden: '' },
        h('span', { class: 'step-n' }, 'Step 4 · The receiver verifies'),
        chips(
          sigValid,
          sigValid ? 'ok' : 'fail-closed',
          'The verifier rejected the delivered bytes. Nothing was forged and nothing wrong was accepted — the primitive held perfectly. What failed is the system around it: two honest parties who agree about the object no longer agree about the bytes. Every "invalid signature" bug of this shape is an availability failure caused by an encoding, not an attack.',
        ),
      ),
    ]
    stepsHost.replaceChildren(...steps)
    shown = 0
  }

  nextBtn.addEventListener('click', () => {
    if (shown === 0) build()
    if (shown < steps.length) {
      steps[shown].removeAttribute('hidden')
      shown++
    }
    nextBtn.textContent = shown === 0 ? 'Start the walkthrough' : shown < steps.length ? 'Next step' : 'Done — walkthrough complete'
    if (shown >= steps.length) {
      nextBtn.setAttribute('disabled', '')
      resetBtn.removeAttribute('hidden')
    }
  })
  resetBtn.addEventListener('click', () => {
    build()
    nextBtn.removeAttribute('disabled')
    nextBtn.textContent = 'Start the walkthrough'
    resetBtn.setAttribute('hidden', '')
  })

  root.append(h('div', { class: 'row' }, nextBtn, resetBtn), stepsHost)
}
