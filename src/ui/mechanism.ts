import { utf8Encode } from '../core/bytes'
import { sign, verify } from '../crypto/ed25519'
import { chips, h, hexDiffView, liveRegion, mono, sigLine } from './dom'
import type { LabCtx } from './context'

/**
 * Exhibit 1 — the headline mechanism, shown (never asserted): producer signs
 * exact bytes → gateway re-serializes → verifier rejects. A pipeline diagram
 * tracks where the message is; the packet moves and the changed bytes pulse
 * exactly once per learner click. All values come from the real signer and
 * verifier at click time; there is no idle motion.
 */
export function mountMechanism(root: HTMLElement, ctx: LabCtx): void {
  const producerDoc = '{"amount": 1.0, "currency": "USD"}'
  const gatewayDoc = JSON.stringify(JSON.parse(producerDoc)) // {"amount":1,"currency":"USD"}

  // The diagram is an illustration of the steps (which carry the content).
  const nodeProducer = h('div', { class: 'mech-node' }, 'Producer (signs)')
  const nodeGateway = h('div', { class: 'mech-node' }, 'Gateway (re-serializes)')
  const nodeVerifier = h('div', { class: 'mech-node' }, 'Verifier (checks bytes)')
  const packet = h('span', { class: 'mech-packet' }, '● bytes')
  const diagram = h('div', { class: 'mech-diagram at-producer', 'aria-hidden': 'true' }, nodeProducer, nodeGateway, nodeVerifier, packet)

  const stepsHost = liveRegion('Mechanism walkthrough steps')
  const nextBtn = h('button', { class: 'primary', type: 'button' }, 'Start the walkthrough')
  const resetBtn = h('button', { type: 'button', hidden: '' }, 'Start over')

  let steps: HTMLElement[] = []
  let shown = 0

  function setDiagram(step: number): void {
    diagram.classList.remove('at-producer', 'at-gateway', 'at-verifier')
    diagram.classList.add(step <= 2 ? 'at-producer' : step === 3 ? 'at-gateway' : 'at-verifier')
    nodeProducer.classList.toggle('active', step <= 2)
    nodeGateway.classList.toggle('active', step === 3)
    nodeVerifier.classList.toggle('active', step === 4)
    nodeVerifier.classList.toggle('rejecting', step === 4)
  }

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
          'The verifier rejected the delivered bytes. Nothing was forged and nothing wrong was accepted — the primitive held perfectly. What failed is the system around it: two honest parties who agree about the object no longer agree about the bytes.',
        ),
      ),
    ]
    stepsHost.replaceChildren(...steps)
    shown = 0
    setDiagram(1)
  }

  nextBtn.addEventListener('click', () => {
    if (shown === 0) build()
    if (shown < steps.length) {
      const step = steps[shown]
      step.removeAttribute('hidden')
      shown++
      setDiagram(shown)
      if (shown === 3) {
        // one-shot pulse on the changed bytes, then remove the hook
        step.classList.add('pulse-once')
        setTimeout(() => step.classList.remove('pulse-once'), 700)
      }
    }
    nextBtn.textContent = shown < steps.length ? 'Next step' : 'Done — walkthrough complete'
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

  root.append(diagram, h('div', { class: 'row' }, nextBtn, resetBtn), stepsHost)
  setDiagram(0)
}
