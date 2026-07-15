# crypto-lab-signed-bytes

## What It Is

**Signed Bytes** is an interactive browser demo of Ed25519 signatures (RFC 8032, via `@noble/ed25519` with strict `zip215: false` verification) over JSON documents, built to teach one idea: **you cannot sign an object — you sign a representation.** Every layer that re-encodes a message between signing and verifying (key reordering, Unicode normalization, number re-serialization, duplicate-key parsing) is an opportunity for the bytes to change while the meaning doesn't, or for the meaning to change while the bytes don't. The demo pairs the signature with the JSON Canonicalization Scheme (JCS, RFC 8785) — implemented by hand so every rule is inspectable — plus a hand-rolled strict RFC 8259 parser with a configurable duplicate-key policy, the browser's real UTS #15 NFC/NFD normalizer, and SHA-256 digests for the byte-diff views.

The UI's core contract is **verdict separation**: the raw cryptographic result ("Signature: valid/invalid") and the security verdict ("OK / FAIL-CLOSED / ALARM") are separate, independently computed indicators. Color tracks system integrity, never the boolean — the centerpiece stage shows a *genuinely valid* signature next to a *red ALARM*, because two conforming parsers recover two different meanings from the same signed bytes.

Everything cryptographic is real and runs in the browser; keys are generated per page load and never persisted. **This is a teaching demo, not production crypto.** It does not prove anything about key management, transport security, or the security of Ed25519 itself.

## Exhibits

1. **One document, two byte strings** — a button-driven step-through of the headline mechanism: a producer signs an invoice's exact UTF-8 bytes, a well-meaning gateway re-serializes it in transit, and the real verifier rejects it. Hex diff and diverging SHA-256 digests are computed live at each step.
2. **Byte-diff sandbox** — two editable JSON documents; see parsed-meaning equality, an alignment-aware UTF-8 hex diff (an inserted byte highlights itself, not everything after it), SHA-256 divergence, and a sign-left/verify-right run against the real primitive.
3. **Stage 1: key order** — sign `{"a":1,"b":2}`, verify `{"b":2,"a":1}`; watch it fail closed, then watch JCS repair it.
4. **Stage 2: Unicode** — precomposed é (U+00E9) vs e + combining acute (U+0301): identical rendering, different bytes, code-point strips, three modes (no normalization / NFC before signing repairs it / normalization *after* signing breaks a genuine signature). JCS explicitly does **not** fix this — RFC 8785 never alters code points.
5. **Stage 3: duplicate keys (the centerpiece)** — craft `{"role":"user","role":"admin"}`; the signature over the exact bytes stays valid throughout, the verifier's first-wins parser authorizes `"user"`, the application's last-wins parser acts on `"admin"`: valid signature, red ALARM. With JCS the document is *rejected at parse time* (I-JSON) — canonicalization refuses the ambiguity rather than resolving it.
6. **Stage 4: number spellings** — `1`, `1.0`, `1e0`, `1.0000000000000001` (plus your own): every spelling is a different byte string, every one parses to exactly the same float64, and only the round-trip-stable spelling keeps its signature. Expert notes cover what JCS numbers do and don't preserve.
7. **Stage 5: the signature boundary** — a drawn receive pipeline (wire bytes → parse → NFC normalize → JCS serialize) with a draggable slider that moves the signature tap between its four stages. Flip on in-transit re-encodings and watch the real verifier's tolerance grow monotonically as the boundary moves — then read the full 4×4 tolerance matrix, every cell of which is a live sign/verify run. What the signature no longer notices is attacker-writable without detection; what it still notices breaks for every honest middlebox too.
8. **The tally** — a scoreboard computed by actually re-running every stage with JCS on: it fixes key order and number form; it does not fix Unicode composition; it refuses duplicate keys instead of canonicalizing them.

A global **JCS toggle** re-runs every stage live with RFC 8785 canonicalization applied before signing and before verifying.

## When to Use It

- **Teaching signing pipelines** — why "sign the JSON" is underspecified until you say *which bytes*.
- **Motivating canonicalization** — JCS/RFC 8785 (or deterministic CBOR, RFC 8949 §4.2) as the fix for serializer-side divergence, with honest limits.
- **Explaining parser-differential attacks** — the duplicate-key stage is a minimal, real reproduction of the validate-with-one-parser/consume-with-another bug class.
- **Arguing for I-JSON (RFC 7493)** — reject duplicate keys everywhere, parse once, pass parsed values.
- **Do NOT use this to sign anything real** — keys are throwaway, there is no key management, and the code is optimized for inspectability, not for constant-time or side-channel hardening beyond what `@noble/ed25519` provides.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-signed-bytes](https://systemslibrarian.github.io/crypto-lab-signed-bytes/)**

Step through the mechanism, break each stage yourself against the real verifier, craft a duplicate-key document and watch a valid signature coexist with a red ALARM, then flip the JCS toggle and see exactly which failures canonicalization repairs.

## What Can Go Wrong

- **Fail-closed friction (Stages 1, 2, 4)** — any re-encoding between signing and verifying breaks verification: not an integrity failure, but an availability/interop failure that pushes teams toward dangerous "fixes."
- **Normalization after signing (Stage 2)** — a transport layer that "cleans up" Unicode is indistinguishable from tampering to the verifier. Normalization is only safe as an explicit contract applied on both sides *before* the signature.
- **Parser differentials (Stage 3)** — the signature can be perfectly valid while the verifier and the application recover different meanings. No cryptographic check catches this; only a parser policy (reject duplicates, parse once) does.
- **Semantic loss in numbers (Stage 4)** — `1.0000000000000001` and `1` are different JSON texts but the *same* float64; distinctions your protocol cares about can be destroyed before any signature is involved. (Distinct float64s always stay distinct under JCS.)
- **Boundary complacency (Stage 5)** — signing a canonical form means whitespace, key order, and number spelling become unauthenticated byte surfaces. Harmless to a JSON application, but any consumer that assigns meaning to raw bytes (content hashes, audit logs, dedup) now disagrees with your verifier.

## Real-World Usage

- **JCS (RFC 8785)** is used where JSON must be signed in place: JSON Web Proofs work, verifiable credentials (`RsaSignature2018`-era canonicalization debates), and several ledger/attestation formats.
- **JWS (RFC 7515)** sidesteps canonicalization by signing base64url-encoded bytes — the payload never gets re-encoded; that design choice is exactly this lab's lesson applied. See the sibling [JWT Forge](https://systemslibrarian.github.io/crypto-lab-jwt-forge/) demo.
- **Deterministic CBOR (RFC 8949 §4.2) / COSE** is the binary-format answer used in WebAuthn attestation and ISO mDL — named here as the alternative, deliberately not implemented.
- **Duplicate-key parser differentials** recur in real advisories wherever one component validates raw bytes and another re-parses them (OAuth/OIDC payload handling, policy documents, package manifests).

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-signed-bytes.git
cd crypto-lab-signed-bytes
npm install
npm run dev        # Vite dev server
npm test           # Vitest unit + KAT suite
npm run build      # typecheck + production build
npm run test:a11y  # axe-core WCAG 2.1 AA gate (both themes), needs the build
```

## Related Demos

- [Ed25519 Forge](https://systemslibrarian.github.io/crypto-lab-ed25519-forge/) — the curve itself: keygen, determinism, cofactor/ZIP215 verifier malleability.
- [JWT Forge](https://systemslibrarian.github.io/crypto-lab-jwt-forge/) — token signing and algorithm-confusion failures.
- [Hash Zoo](https://systemslibrarian.github.io/crypto-lab-hash-zoo/) — the digests underneath the byte-diff views.

## Build & Verify

- **128 Vitest tests**, all executed in CI before deploy, including:
  - **RFC 8032 §7.1 known-answer tests** — 4 vectors (TEST 1, 2, 3, SHA(abc)): seed → public key, deterministic signature bytes, and verification (12 test cases).
  - **RFC 8785 known-answer tests** — all 24 Appendix B number-serialization samples (IEEE-754 bits → canonical text) plus NaN/Infinity rejection; the §3.2.2 sample document canonicalized byte-for-byte; the §3.2.3 Unicode key-sorting example (UTF-16 code-unit order, emoji-before-U+FB33 included).
  - Hand-rolled parser: strict-grammar rejection suite and all three duplicate-key policies.
  - Stage logic: every verdict in the UI (fail-closed, repaired-by-JCS, the valid-signature ALARM) is asserted against the real primitives, and the entire Stage 5 tolerance matrix — all 16 boundary×mutation cells plus its monotonicity — is tested.
- **Accessibility gate**: `@axe-core/playwright` scans the production build in **both** themes for WCAG 2.1 A/AA; violations block the GitHub Pages deploy (`.github/workflows/deploy.yml`).
- Hand-rolled teaching parts: `src/jcs/canonicalize.ts` (RFC 8785) and `src/json/parse.ts` (RFC 8259 + duplicate policies). Library crypto: `@noble/ed25519` + `@noble/hashes` — the signature scheme is not the lesson here, the bytes it binds are.

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
