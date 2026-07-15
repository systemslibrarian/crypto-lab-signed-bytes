import { sha256 } from '@noble/hashes/sha256'
import { toHex } from './bytes'

/** SHA-256 of a byte string, hex-encoded. Used by the byte-diff viewer to show
 *  that two "equal" documents already diverge at the digest level. */
export function sha256Hex(bytes: Uint8Array): string {
  return toHex(sha256(bytes))
}
