import { expect, test } from '@playwright/test'
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate'

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where the
 * walkthrough has not been started, all four of its steps are behind the
 * `hidden` attribute, four expert disclosures are shut and seven exhibits have
 * already run a real Ed25519 sign and verify; the skip link focused; the
 * walkthrough advanced one step per click through all four and then reset; the
 * sandbox run, fed malformed JSON so its fail-closed branch renders, and
 * restored; Stage 2 in all three normalization modes, including the
 * normalize-after-signing trap; Stage 3 as the centrepiece — a genuinely valid
 * signature beside an ALARM verdict — and again with the duplicate key removed,
 * which is the only state where its green is honest; Stage 4 with a
 * learner-supplied spelling and then with one that is not a JSON number at all;
 * Stage 5 at each of its four signature boundaries, then with all four in-transit
 * re-encodings on at the canonical tap (where the signature still verifies) and
 * again at the wire tap (where the same re-encodings now fail closed); all four
 * disclosures opened through their own summaries; and the JCS toggle flipped,
 * which is a global mode fork that inverts the outcome of every stage on the
 * page. Every one of those states is scanned, in both themes, at desktop and
 * phone width.
 *
 * See `gate.ts` for why nothing is injected into the page, why no step is
 * force-revealed (the `hidden` attribute IS the walkthrough's mechanism, and the
 * old gate also added the live `active` class to everything it un-hid), why the
 * lab's defaults are asserted rather than assumed, and why `violations` is not
 * the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_200_000)
    const errors = watchPageErrors(page)
    await boot(page, theme)
    await driveAllStates(page, theme)
    expect(errors, errors.join('\n')).toEqual([])
    expectBaselineNotStale()
    reportCollected()
  })

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_200_000)
    const errors = watchPageErrors(page)
    await page.setViewportSize(NARROW)
    await boot(page, theme)
    await driveAllStates(page, `${theme} @380px`)
    expect(errors, errors.join('\n')).toEqual([])
    expectBaselineNotStale()
    reportCollected()
  })
}
