import './style.css'
import { toHex } from './core/bytes'
import { generateKeypair } from './crypto/ed25519'
import type { LabCtx } from './ui/context'
import { h } from './ui/dom'
import { mountMechanism } from './ui/mechanism'
import { mountSandbox } from './ui/sandbox'
import { mountScoreboard } from './ui/scoreboard'
import { mountStageBoundary } from './ui/stage-boundary'
import { mountStageDup } from './ui/stage-dup'
import { mountStageNumbers } from './ui/stage-numbers'
import { mountStageOrder } from './ui/stage-order'
import { mountStageUnicode } from './ui/stage-unicode'

// One Ed25519 keypair per page load, in memory only — every exhibit signs
// and verifies against this key.
const kp = generateKeypair()

const jcsToggle = document.getElementById('jcs-toggle') as HTMLInputElement
const jcsListeners: Array<() => void> = []
const ctx: LabCtx = {
  kp,
  jcs: () => jcsToggle.checked,
  onJcs: (fn) => jcsListeners.push(fn),
}
jcsToggle.addEventListener('change', () => {
  for (const fn of jcsListeners) fn()
})

const keyBanner = document.getElementById('key-banner')
if (keyBanner) {
  keyBanner.append(
    h(
      'p',
      { class: 'keyline' },
      'This session’s Ed25519 public key (fresh this page load, never stored): ',
      toHex(kp.publicKey),
    ),
  )
}

const mounts: Record<string, (root: HTMLElement, ctx: LabCtx) => void> = {
  mechanism: mountMechanism,
  sandbox: mountSandbox,
  'stage-order': mountStageOrder,
  'stage-unicode': mountStageUnicode,
  'stage-dup': mountStageDup,
  'stage-numbers': mountStageNumbers,
  'stage-boundary': mountStageBoundary,
  scoreboard: mountScoreboard,
}

for (const [name, mountFn] of Object.entries(mounts)) {
  const el = document.querySelector<HTMLElement>(`[data-mount="${name}"]`)
  if (el) mountFn(el, ctx)
}
