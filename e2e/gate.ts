import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import { auditContrast, formatContrastFailures } from './contrast'
import { auditNonText } from './nontext'
import { NONTEXT_BASELINE } from './nontext-baseline'

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 }

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects a specific thing the
 * gate this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old `prepare()`
 *     pushed `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     and on this page the block does real, load-bearing work: it cancels the
 *     `.mech-packet` `left` transition that walks the packet along the pipeline
 *     diagram, and the one-shot `bytepulse` animation on the changed bytes. The
 *     injection produced a similar rendering by a different route, so it proved
 *     nothing about the block — and it was checked here for the failure where
 *     cancelling an animation strands an element at its start value: it cannot
 *     happen, because `bytepulse` only animates `transform: scale()` and the
 *     packet's position is set by a class, not by the transition.
 *     `expectNotBlank` measures that in every state rather than trusting it.
 *
 *  2. IT ASSEMBLED A DOCUMENT NO VISITOR CAN REACH. The old `prepare()` did
 *     this, verbatim:
 *
 *         document.querySelectorAll('[hidden],[role="tabpanel"]').forEach(el => {
 *           el.removeAttribute('hidden')
 *           el.style.display = ''
 *           el.classList.add('active', 'is-active', 'open')
 *         })
 *
 *     On this page the `hidden` attribute is how Exhibit 1's walkthrough works:
 *     all FOUR steps ship hidden and are revealed one per click, and the "Start
 *     over" button ships hidden until the walkthrough finishes. Stripping it
 *     produced a walkthrough showing every step at once beside a "Start the
 *     walkthrough" button and a "Start over" button — three mutually exclusive
 *     states rendered simultaneously. It also added `active` to every one of
 *     them, which is a real class here (`.mech-node.active` draws the
 *     accent-coloured highlight ring), so the diagram lit all three nodes at
 *     once. This gate never touches `hidden`, `display`, `open` or `class`;
 *     every step is revealed by the button that reveals it.
 *
 *  3. IT DROVE BY TEXT-MATCHING BUTTON LABELS AND SWALLOWED THE RESULT. The old
 *     drive collected every `<button>` on the page, kept the ones whose text
 *     matched `/run|compute|sign|verify|encrypt|simulate|start/`, and clicked
 *     each with `.catch(() => {})`. A relabelled control silently stopped being
 *     driven, a click that threw was swallowed, and the regex missed the JCS
 *     checkbox, the boundary slider, every radio and every mutation toggle
 *     entirely. Then it scanned ONCE, after `waitForTimeout(400)`, so every
 *     state it had built was already overwritten. This drive names every control
 *     it touches, asserts a real completion signal after each, and scans after
 *     every step, in {dark, light} x {1280, 380}.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. Almost every surface on
 *     this page is a `color-mix(in oklab, ...)` — the hero aside, the JCS bar,
 *     every verdict chip, the current-row highlight, the primary button, the
 *     changed-byte marks — and axe files all of them under `incomplete` rather
 *     than judging them. So does an `aria-label` on a role-less element.
 *
 *  5. IT HAD NO REFLOW OR NON-TEXT-CONTRAST ORACLE. The repo did ship a separate
 *     `e2e/border-contrast.spec.ts` for 1.4.11, and it was worse than nothing
 *     twice over: it queried `#app textarea, #app input[type="text"]`, which is
 *     EXACTLY and only the rule `--control-border` was applied to, so it
 *     asserted 3:1 over the two selectors where the correct token was already
 *     kept; and it compared each element's `borderTopColor` against its OWN
 *     `backgroundColor`, never against the surface outside the control, so it did
 *     not ask the question 1.4.11 asks. Every `#app button` on the page drew its
 *     edge from `--border` and dissolved into its panel, and that spec was
 *     structurally incapable of noticing. It is deleted; `nontext.ts` replaces it
 *     with a composite-aware audit of every control, run at every driven state.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number }
      const running = document.getAnimations().filter((a) => a.playState === 'running')
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0
      return w.__quietFrames >= 6
    },
    undefined,
    { timeout: 20_000, polling: 'raf' },
  )
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * `style.css` cannot currently be in that shape, and the assertion is what makes
 * that a measurement rather than a reading. Its reduced-motion block was read
 * declaration by declaration: it sets `transition: none` on `.mech-packet` and
 * `animation: none` on `.pulse-once .hexbox .b.d`, and nothing else. The file's
 * only `@keyframes` is `bytepulse`, which animates `transform: scale()` between
 * 1 and 1.35 and back to 1 — so cancelling it leaves the element at its declared
 * scale, visible. The only `opacity` in the file is
 * `.cl-hero-sub { opacity: 0.85 }`, static and nowhere near zero. The check runs
 * in every state anyway, because all of that is a property of the current
 * stylesheet rather than of the page.
 *
 * `aria-hidden` subtrees are excluded; see the note on `ariaHidden` in
 * `contrast.ts` for what this lab hides and why each one was checked by hand.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim()
      if (!own) continue
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue
      if (el.closest('[aria-hidden="true"]')) continue
      let effective = 1
      let node: Element | null = el
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity)
        node = node.parentElement
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`)
      }
    }
    return Array.from(new Set(out))
  })
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([])
}

/**
 * Uncaught page errors and console errors, collected from the moment the page is
 * created. Several exhibits here render their output from inside a `try/catch`
 * that paints a fail-closed chip on error, so a genuinely thrown renderer leaves
 * a plausible-looking page behind that a gate would scan and report green.
 * Attach before `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  return errors
}

/**
 * Exactly one banner landmark.
 *
 * This lab's hero is a `<header class="cl-hero">` INSIDE `<main id="app">`,
 * which scopes it out of the banner role on its own. That matters here more
 * than in most repos, because this copy of `index.html` carries the OLDER
 * `dedupeBanner()` — it walks `document.body.children` rather than using
 * `closest('main, …')`, so a hero nested inside `<main>` is invisible to it and
 * would NOT be demoted if it ever did imply banner. The single banner is
 * therefore a property of the nesting alone. Asserting the OUTCOME rather than
 * either mechanism is what catches a change to that nesting.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION'])
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true
      if (el.tagName !== 'HEADER') return false
      if (el.getAttribute('role')) return false // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false
      return true
    }
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length
  })
  expect(banners, 'exactly one banner landmark').toBe(1)
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page.
 *
 * The theme is seeded through `localStorage` rather than by clicking the toggle,
 * which pins down a real failure mode as a side effect: `index.html`'s
 * anti-flash script reads `localStorage.getItem('theme')` and the shared bar's
 * toggle writes `localStorage.setItem('theme', …)`. If those keys drift apart
 * the theme silently stops persisting, and this boot fails on `data-theme`
 * rather than quietly scanning dark twice. (This lab has no toggle of its own,
 * so the shared bar's is the only writer.)
 *
 * The defaults are asserted at length because SEVEN exhibits mount themselves
 * into empty `<div data-mount>` hosts and every one of them runs a real Ed25519
 * sign and verify at mount time. A navigation that resolves proves nothing here:
 * a mount that threw would leave its host empty, and an empty div is exactly
 * what a scan reports as perfectly accessible. The one exhibit that does NOT
 * self-run — the mechanism walkthrough — is asserted to be in its un-started
 * state, because that is the first thing every reader sees and the gate this
 * replaces could never scan it: it force-revealed all four steps before looking.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the whole
  // test timeout and reports nothing useful. 20s turns that silent hang into a
  // named failure naming the locator.
  page.setDefaultTimeout(20_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
  await page.goto('.')
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect',
  ).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await assertSingleBanner(page)

  // The `hidden` attribute really removes an element. `[hidden]` has specificity
  // (0,1,0) — identical to a class — so any later `.foo { display: … }` beats it
  // and the attribute silently does nothing. This lab hides all four walkthrough
  // steps and the "Start over" button with it, and `style.css` carries an
  // explicit `#app .step[hidden] { display: none }` for exactly that reason.
  // Measured from a live element rather than inferred from the CSS.
  expect(
    await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.hidden = true
      document.body.appendChild(probe)
      const display = getComputedStyle(probe).display
      probe.remove()
      return display
    }),
    'the hidden attribute must actually hide (it is how the walkthrough steps are hidden)',
  ).toBe('none')

  // The skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run says
  // nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app')
  await expect(page.locator('main#app')).toHaveCount(1)

  // ── Every exhibit mounted, and its first real sign/verify already ran ────
  for (const mount of [
    'mechanism',
    'sandbox',
    'stage-order',
    'stage-unicode',
    'stage-dup',
    'stage-numbers',
    'stage-boundary',
    'scoreboard',
  ]) {
    await expect(
      page.locator(`[data-mount="${mount}"]`),
      `the ${mount} exhibit must have mounted something`,
    ).not.toBeEmpty()
  }
  // The session keypair is real and rendered.
  await expect(page.locator('#key-banner .keyline')).toHaveText(/^This session’s Ed25519 public key .*: [0-9a-f]{64}$/)

  // ── The walkthrough is UN-STARTED, which the old gate could never scan ──
  await expect(page.locator('#mechanism .step')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start the walkthrough' })).toBeVisible()
  await expect(page.locator('#mechanism button', { hasText: 'Start over' })).toBeHidden()
  // …and its diagram has exactly one node lit, not all three. `renderStep`
  // does `nodeProducer.classList.toggle('active', step <= 2)`, so at the
  // un-started step 0 the Producer is lit as a "you are here" marker and the
  // other two are not. This assertion previously demanded 0, contradicting the
  // comment directly above it and the count asserted later in the drive — the
  // assumption was wrong about the lab, not the other way round.
  await expect(page.locator('#mechanism .mech-node.active')).toHaveCount(1)

  // ── Every shipped control default ───────────────────────────────────────
  await expect(page.locator('#jcs-toggle')).not.toBeChecked()
  await expect(page.locator('#sandbox-a')).toHaveValue('{"amount": 1.0, "to": "alice"}')
  await expect(page.locator('#sandbox-b')).toHaveValue('{"to":"alice","amount":1}')
  await expect(page.locator('#dup-doc')).toHaveValue('{"role":"user","role":"admin"}')
  await expect(page.locator('#num-custom')).toHaveValue('1.00')
  await expect(page.locator('#boundary-slider')).toHaveValue('0')
  await expect(page.locator('#um-divergent')).toBeChecked()
  for (const m of ['whitespace', 'numberform', 'nfd', 'reorder']) {
    await expect(page.locator(`#mut-${m}`)).not.toBeChecked()
  }

  // ── Four disclosures, all shut ──────────────────────────────────────────
  // The gate this replaces opened all of them from script before its only scan.
  await expect(page.locator('#app details')).toHaveCount(4)
  await expect(page.locator('#app details[open]')).toHaveCount(0)

  // ── The headline teaching outcomes, asserted so a scan cannot pass while
  //    measuring a page that is not showing them ──────────────────────────
  // Stage 1 and 2 fail closed with JCS off; Stage 3 is the centrepiece — a
  // genuinely VALID signature beside an ALARM verdict.
  await expect(page.locator('#stage-1 [role="status"]')).toContainText('INVALID ✗')
  await expect(page.locator('#stage-2 [role="status"]')).toContainText('INVALID ✗')
  await expect(page.locator('#stage-3 [role="status"] .chip-crypto')).toContainText('VALID ✓')
  await expect(page.locator('#stage-3 [role="status"] .chip-verdict')).toContainText('ALARM')

  await settle(page)
  await expectNotBlank(page, `${theme} first paint`)
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. The shapes at risk
 * here are the two fixed-column grids — `.pipe-track` at `repeat(4, 1fr)` and
 * `.mech-diagram` at `repeat(3, 1fr)`, both of which take each track's
 * min-content as its automatic minimum — the scoreboard and boundary-matrix
 * tables at `width: 100%`, and the 64-hex `.keyline` and `.wirebytes` runs,
 * which rely on `word-break: break-all`.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    if (doc.scrollWidth <= doc.clientWidth) return null

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. Every
    // `.hexbox` on this page is such a decoy, and so is the boundary matrix
    // table inside its own `.hexbox`.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true
        n = n.parentElement
      }
      return false
    }

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right)
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0]
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    }
  })
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull()
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * This lab already handles its known case, and does it in the right place:
 * `dom.ts`'s `hexDiffView()` builds every `.hexbox` with `tabindex="0"`,
 * `role="region"` and an `aria-label`, and `stage-boundary.ts` does the same for
 * the tolerance matrix. Those are the only `overflow: auto` boxes here, and each
 * one holds the byte evidence the whole lab is about. The assertion stays
 * because a helper is a convention, not an enforcement — and because at 380px
 * every `.hexbox` on the page genuinely scrolls, where at 1280px most do not.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el)
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`,
      )
  })
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`,
  ).toEqual([])
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run. It
 * is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the committed
 * workflow, and a run with it set prints every finding as it happens and then
 * fails at the end, so a green collection run cannot be mistaken for a green
 * gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT
const collected: string[] = []

function record(entry: string): void {
  collected.push(entry)
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`)
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected)
    return
  }
  try {
    expect(actual, message).toEqual(expected)
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`)
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([])
}

async function expectScrollersReachableSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectScrollersReachable(page, label)
  try {
    await expectScrollersReachable(page, label)
  } catch (e) {
    record(String(e).slice(0, 900))
  }
}

/**
 * The 1.4.11 ratchet, soft-wrapped the same way as every other oracle here.
 *
 * The wrapper is written out longhand rather than folded into a neighbour
 * because of how this oracle died elsewhere in this fleet:
 * `expectNoNewNonTextFailures` had been called from inside
 * `expectScrollersReachableSoft`, AFTER that function's `if (!COLLECTING) return`
 * guard, so in a strict run — which is every run in CI and every run anyone reads
 * as a pass — the guard returned first and `nontext.ts` never executed at all.
 * It is called from `scan()` here, at every driven state, and this repo's
 * baseline was captured by that live path.
 */
async function expectNoNewNonTextFailuresSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoNewNonTextFailures(page, label)
  try {
    await expectNoNewNonTextFailures(page, label)
  } catch (e) {
    record(String(e).slice(0, 900))
  }
}

async function expectNoHorizontalOverflowSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoHorizontalOverflow(page, label)
  try {
    await expectNoHorizontalOverflow(page, label)
  } catch (e) {
    record(String(e).slice(0, 900))
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast, and
 * the arithmetic text walk cannot reach a control's boundary or a `::before`
 * glyph, because a pseudo-element is not an element and owns no text node. Both
 * halves are live here — the control-boundary half found every `#app button`,
 * and the generated-content half is what measures the `→` connectors that
 * `.pipe-node::after` and `.mech-node::after` draw between the pipeline nodes.
 * The check this repo shipped instead — `e2e/border-contrast.spec.ts` — is
 * deleted, for the two reasons given at the top of this file.
 *
 * The remaining backlog here is the shared Crypto Lab top bar, byte-identical in
 * every repo in the fleet and not this one's to change, so this does not block on
 * it. A check that merely logs is not a gate, though, so it ratchets: anything
 * NOT in the baseline fails, anything in the baseline that got WORSE fails, and
 * anything in the baseline that has been FIXED fails until its entry is deleted.
 * That last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>()

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page)
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`)
    }
    return
  }
  const problems: string[] = []
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`
    nonTextSeen.add(key)
    const base = NONTEXT_BASELINE[key]
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`)
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`)
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([])
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k))
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)',
  ).toEqual([])
}

/**
 * Scan the page as it currently stands.
 *
 * Seven assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those ratios
 *    arithmetically — which matters more here than in most labs, because nearly
 *    every meaningful surface on this page is a `color-mix(in oklab, …)`: all
 *    three verdict chips, the JCS bar, the primary button, `.pipe-node.inside`,
 *    `.cp-diff`, `.current-row`, the changed-byte marks in every hex view, and
 *    the hero aside. axe resolves none of them. Everything else in that bucket
 *    is a real result axe simply could not finish — including
 *    `aria-prohibited-attr`, which is where an `aria-label` on a role-less
 *    element hides, a defect that never reaches the violations array at all.
 *    This page depends on getting that right in three places: `liveRegion()`
 *    pairs its `aria-label` with `role="status"`, `hexDiffView()` pairs the
 *    `.hexbox`'s with `role="region"`, and `codePointStrip()` pairs the strip's
 *    with `role="list"`. Drop any of those roles and the label is silently
 *    discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it, which is the question
 *    `border-contrast.spec.ts` never asked.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page)
  await expectNotBlank(page, label)
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads exactly
  // like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of axe-core
  // 4.12's 105 rule definitions; the chained form executes 4.
  //
  // Confirmed here by experiment rather than by reading: `<html lang="en">` was
  // changed to `<html>` and the full drive re-run against the identical page. The
  // merged form below failed on `html-has-lang` (SC 3.1.1, tagged `wcag2a`) at
  // the very first state. See the commit message for the measured before/after.
  //
  // The landmark four are still wanted because they are best-practice rather than
  // WCAG-tagged, so `withTags` alone does not reach them — and this page has the
  // shape they catch: a sticky `<header role="banner">` above a `<main id="app">`
  // that itself contains a `<header class="cl-hero">` with an
  // `<aside role="complementary">` inside it.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze()
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  }

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }))
  softExpect(violations, `axe violations in state: ${label}`, [])

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }))
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, [])

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))))
  softExpect(contrast, `measured contrast failures in state: ${label}`, [])

  await expectNoNewNonTextFailuresSoft(page, label)
  await expectScrollersReachableSoft(page, label)
  await expectNoHorizontalOverflowSoft(page, label)
}

// ── The drive ───────────────────────────────────────────────────────────────

/** The four taps the Stage 5 signature boundary can sit at, slider order. */
const SIGN_POINTS = ['Wire bytes', 'After parse', 'After NFC normalize', 'After JCS serialize'] as const

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Six things shape this drive:
 *
 *  - THE UN-STARTED WALKTHROUGH IS SCANNED FIRST, then each of its four steps is
 *    revealed by its own button. That is five distinct renderings the gate this
 *    replaces collapsed into one, by stripping `hidden` from all four steps and
 *    the "Start over" button before its only scan.
 *
 *  - THE JCS TOGGLE IS A GLOBAL MODE FORK, and both branches are driven. Every
 *    stage on the page re-runs when it flips, and the outcomes INVERT: Stage 1
 *    goes from fail-closed to valid, Stage 3 goes from a valid-signature ALARM to
 *    a parser refusal, Stage 4's whole table changes verdict. Scanning one branch
 *    scans half the lab, and which half depends on a default.
 *
 *  - EVERY BRANCH OF EVERY FORK. Stage 2 has three radio modes and the third
 *    ("normalize AFTER signing") is the one the exhibit exists to warn about.
 *    Stage 5 has four taps on its slider and four independent mutation toggles,
 *    and the interesting cell — a signature that still verifies while the wire
 *    bytes changed — only exists with the boundary moved AND a mutation on.
 *
 *  - THE ERROR STATES ARE DRIVEN. The sandbox's `catch` renders a fail-closed
 *    chip for unparseable input; Stage 4's per-row `catch` renders a
 *    `colspan="4"` cell for a spelling that is not a JSON number. Neither is
 *    reachable without typing something wrong on purpose, and neither had ever
 *    been looked at.
 *
 *  - HOVER IS A STATE. `#app button:hover` swaps its border to `--accent-text`
 *    and `#app a:hover` thickens its underline. A visitor is in one of those
 *    states immediately after pointing at anything.
 *
 *  - NO FIXED TIMEOUTS. The old drive ended with `waitForTimeout(400)`. Every
 *    operation here is synchronous Ed25519 on the main thread with a real DOM
 *    completion signal — a chip's text, a step losing `hidden`, a row count, a
 *    slider's `aria-valuetext` — and the drive waits on those.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`)

  await scanAt('first paint, walkthrough un-started and JCS off')

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('Tab')
  await expect(page.locator('a.cl-skip-link')).toBeFocused()
  await scanAt('skip link focused, slid into view')

  // ── Exhibit 1: the walkthrough, one step per click ──────────────────────
  const mech = page.locator('#mechanism')
  await mech.getByRole('button', { name: 'Start the walkthrough' }).click()
  await expect(mech.locator('.step:not([hidden])')).toHaveCount(1)
  await expect(mech.locator('.mech-node.active')).toHaveCount(1)
  await scanAt('walkthrough step 1, the producer writes an invoice')

  await mech.getByRole('button', { name: 'Next step' }).click()
  await expect(mech.locator('.step:not([hidden])')).toHaveCount(2)
  await expect(mech.locator('.keyline')).toHaveText(/signature \(64 bytes\): [0-9a-f]{128}$/)
  await scanAt('walkthrough step 2, the exact bytes signed')

  await mech.getByRole('button', { name: 'Next step' }).click()
  await expect(mech.locator('.step:not([hidden])')).toHaveCount(3)
  // Step 3 is the byte diff, and the only place `.b.d` (the changed-byte mark)
  // is painted in this exhibit. It also carries the one-shot `bytepulse`, which
  // reduced motion cancels — so what is scanned here is the reduced-motion
  // rendering, which is the one a reader with the preference set ever sees.
  await expect(mech.locator('.hexbox .b.d').first()).toBeVisible()
  await scanAt('walkthrough step 3, the gateway re-serialized and the bytes diverged')

  await mech.getByRole('button', { name: 'Next step' }).click()
  await expect(mech.locator('.step:not([hidden])')).toHaveCount(4)
  await expect(mech.locator('.chip-crypto')).toContainText('INVALID ✗')
  await expect(mech.locator('.chip-verdict')).toContainText('FAIL-CLOSED')
  await expect(mech.getByRole('button', { name: /Done/ })).toBeDisabled()
  await scanAt('walkthrough step 4, the verifier fails closed (and Next is disabled)')

  await mech.getByRole('button', { name: 'Start over' }).click()
  await expect(mech.locator('.step:not([hidden])')).toHaveCount(0)
  await expect(mech.getByRole('button', { name: 'Start the walkthrough' })).toBeEnabled()
  await scanAt('walkthrough reset to its un-started state')

  await mech.getByRole('button', { name: 'Start the walkthrough' }).hover()
  await scanAt('a primary button hovered')

  // ── Exhibit 2: the sandbox, including its parse-failure branch ──────────
  await page.click('#sandbox button')
  await expect(page.locator('#sandbox [role="status"] .chip-verdict')).toContainText('FAIL-CLOSED')
  await scanAt('sandbox run, two spellings of one object disagreeing')

  await page.fill('#sandbox-a', '{"amount": 1.0,')
  await page.click('#sandbox button')
  await expect(page.locator('#sandbox [role="status"]')).toContainText('Could not parse:')
  await expect(page.locator('#sandbox [role="status"] .chip-crypto')).toContainText('NOT RUN')
  await scanAt('sandbox rejected malformed JSON, nothing signed')

  await page.fill('#sandbox-a', '{"amount": 1.0, "to": "alice"}')
  await page.click('#sandbox button')
  await expect(page.locator('#sandbox [role="status"] .chip-verdict')).toContainText('FAIL-CLOSED')
  await scanAt('sandbox restored')

  // ── Stage 2: all three normalization modes ──────────────────────────────
  // `normalize-before` is the only state on the page where Stage 2 renders an
  // OK verdict, and `normalize-after` is the trap the exhibit exists for.
  await page.check('#um-normalize-before')
  await expect(page.locator('#stage-2 .chip-verdict')).toContainText('OK')
  await expect(page.locator('#stage-2 .cp-diff')).toHaveCount(0)
  await scanAt('Stage 2 normalizing on both sides, the repaired state')

  await page.check('#um-normalize-after')
  await expect(page.locator('#stage-2 .chip-verdict')).toContainText('FAIL-CLOSED')
  await expect(page.locator('#stage-2 .cp-diff').first()).toBeVisible()
  await scanAt('Stage 2 normalizing AFTER signing, the trap')

  await page.check('#um-divergent')
  await expect(page.locator('#stage-2 .chip-verdict')).toContainText('FAIL-CLOSED')
  await scanAt('Stage 2 back to no normalization')

  // ── Stage 3: the centrepiece, and its no-duplicate control case ─────────
  await page.click('#stage-3 button')
  await expect(page.locator('#stage-3 .chip-verdict')).toContainText('ALARM')
  await expect(page.locator('#stage-3 .wirebytes').first()).toBeVisible()
  await scanAt('Stage 3 re-run, one valid signature and two meanings')

  await page.fill('#dup-doc', '{"role":"admin"}')
  await page.click('#stage-3 button')
  await expect(page.locator('#stage-3 .chip-verdict')).toContainText('OK')
  await scanAt('Stage 3 with no duplicate key, the honest green')

  await page.fill('#dup-doc', '{"role":"user","role":"admin"}')
  await page.click('#stage-3 button')
  await expect(page.locator('#stage-3 .chip-verdict')).toContainText('ALARM')

  // ── Stage 4: a custom spelling, and a spelling that is not a number ─────
  await page.fill('#num-custom', '9007199254740993')
  await page.click('#stage-4 button')
  await expect(page.locator('#stage-4 tbody tr')).toHaveCount(5)
  await scanAt('Stage 4 with a fifth, learner-supplied number spelling')

  await page.fill('#num-custom', 'not-a-number')
  await page.click('#stage-4 button')
  await expect(page.locator('#stage-4 td[colspan="4"]')).toContainText('not a JSON number')
  await scanAt('Stage 4 rejected a non-numeric spelling, fails closed')

  // ── Stage 5: every tap on the slider, then the mutations ────────────────
  for (let i = 0; i < SIGN_POINTS.length; i++) {
    await page.locator('#boundary-slider').fill(String(i))
    await expect(page.locator('#boundary-slider')).toHaveAttribute(
      'aria-valuetext',
      new RegExp(`^${SIGN_POINTS[i]}: `),
    )
    await expect(page.locator('#stage-5 .pipe-node.tap')).toHaveCount(1)
    await expect(page.locator('#stage-5 tr.current-row')).toHaveCount(1)
    await scanAt(`Stage 5 signature boundary at "${SIGN_POINTS[i]}"`)
  }

  // With the boundary at the end of the pipeline and every re-encoding on, the
  // signature still verifies while the wire bytes changed — the state the whole
  // exhibit is built to produce, and one no single scan of a default page
  // reaches.
  for (const m of ['whitespace', 'numberform', 'nfd', 'reorder']) {
    await page.check(`#mut-${m}`)
  }
  await expect(page.locator('#stage-5 [role="status"] .chip-crypto')).toContainText('VALID ✓')
  await scanAt('Stage 5 at the canonical tap with all four re-encodings on')

  // Now drag the boundary back to the wire with the same mutations on: the same
  // re-encodings that were invisible a moment ago now fail closed.
  await page.locator('#boundary-slider').fill('0')
  await expect(page.locator('#stage-5 [role="status"] .chip-crypto')).toContainText('INVALID ✗')
  await scanAt('Stage 5 back at the wire, the same re-encodings now rejected')

  for (const m of ['whitespace', 'numberform', 'nfd', 'reorder']) {
    await page.uncheck(`#mut-${m}`)
  }

  // ── The four expert disclosures, opened through their own summaries ─────
  const shut = page.locator('#app details:not([open]) > summary')
  await expect(shut).toHaveCount(4)
  for (let i = 0; i < 4; i++) await shut.first().click()
  await expect(page.locator('#app details:not([open])')).toHaveCount(0)
  await scanAt('all four expert disclosures open')

  // ── JCS ON: the global mode fork, which inverts every stage ─────────────
  await page.check('#jcs-toggle')
  await expect(page.locator('#stage-1 [role="status"]')).toContainText('VALID ✓')
  await expect(page.locator('#stage-1 [role="status"]')).toContainText('✓ OK')
  // JCS does NOT repair Unicode composition — the exhibit's whole point.
  await expect(page.locator('#stage-2 [role="status"]')).toContainText('INVALID ✗')
  // …and it REFUSES a duplicate-key document rather than resolving it.
  await expect(page.locator('#stage-3 [role="status"]')).toContainText('RFC 8785 requires I-JSON')
  await expect(page.locator('#stage-4')).not.toContainText('invalid ✗')
  await scanAt('JCS canonicalization ON, every stage re-run')

  await page.click('#stage-4 button')
  await expect(page.locator('#stage-4 tbody tr')).toHaveCount(5)
  await scanAt('Stage 4 re-run under JCS')

  await page.locator('#app a').first().hover()
  await scanAt('an in-prose link hovered')

  await page.uncheck('#jcs-toggle')
  await expect(page.locator('#stage-1 [role="status"]')).toContainText('INVALID ✗')
  await scanAt('JCS off again, the finished page with every disclosure open')
}
