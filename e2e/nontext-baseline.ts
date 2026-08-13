/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 *
 * What survives here is the SHARED Crypto Lab top bar, and nothing else. Every
 * control inside `<main id="app">` is audited with no exemption and comes back
 * clean — including every `#app button`, which was the real finding this oracle
 * turned up in this repo and which is now fixed in `src/style.css` rather than
 * baselined.
 *
 * `.cl-btn` draws its edge as
 * `1px solid color-mix(in srgb, var(--accent, #35d6bb) 38%, transparent)` over
 * the bar's fixed `#0b1512`. This lab defines `--accent` as the SAME `#c2410c`
 * in both themes, so unlike most repos in this fleet the finding does not move
 * with the theme.
 *
 * Every repo in this fleet carries a byte-identical copy of that markup and CSS,
 * and `CLAUDE.md` is explicit that a change every lab should get is a deliberate
 * reviewed fleet-wide pass and never an overwrite driven from one repo. So it is
 * measured here, ratcheted here, and reported upward.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {
  'control-boundary|a.cl-btn': { ratio: 1.2, required: 3, unverified: false },
  'control-boundary|button#cl-theme-toggle.cl-btn.cl-icon': {
    ratio: 1.2,
    required: 3,
    unverified: false,
  },
}
