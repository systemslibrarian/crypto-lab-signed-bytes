import type { Keypair } from '../crypto/ed25519'

/** Shared per-session state handed to every exhibit. */
export interface LabCtx {
  kp: Keypair
  /** Current state of the global JCS toggle. */
  jcs(): boolean
  /** Subscribe to JCS toggle changes (used to re-run a stage live). */
  onJcs(fn: () => void): void
}
