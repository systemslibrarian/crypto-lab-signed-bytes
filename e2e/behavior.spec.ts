import { expect, test } from '@playwright/test'

/**
 * Browser-level proof of the teaching flows: every headline outcome the page
 * exists to show is asserted in the rendered UI, driven the way a learner
 * drives it (clicks and keyboard). The crypto underneath is the real thing,
 * so these are end-to-end: real sign, real verify, real DOM.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('.')
})

test('JCS refuses lone surrogates in values and names before signing, then accepts valid pairs', async ({ page }) => {
  await page.locator('#jcs-toggle').check();
  const out = page.locator('#sandbox [role="status"]');
  for (const text of ['"\\ud800"', '{"\\udfff":1}', '{"x":["\\udc00"]}']) {
    await page.locator('#sandbox-a').fill(text);
    await page.locator('#sandbox-b').fill(text);
    await page.locator('#sandbox button').click();
    await expect(out).toContainText(/surrogate/i);
    await expect(out.locator('.chip-crypto')).toContainText('NOT RUN');
    await expect(out.locator('.chip-verdict')).toContainText('FAIL-CLOSED');
  }
  await page.locator('#sandbox-a').fill('"\\ud83d\\ude00"');
  await page.locator('#sandbox-b').fill('"\\ud83d\\ude00"');
  await page.locator('#sandbox button').click();
  await expect(out.locator('.chip-crypto')).toContainText('VALID');
  await expect(out.locator('.chip-verdict')).toContainText('OK');
});

test('special JSON members remain part of the signed meaning under JCS', async ({ page }) => {
  await page.locator('#jcs-toggle').check();
  await page.locator('#sandbox-a').fill('{"__proto__":{"n":1},"x":2}');
  await page.locator('#sandbox-b').fill('{"x":2}');
  await page.locator('#sandbox button').click();
  const out = page.locator('#sandbox [role="status"]');
  await expect(out).toContainText('different objects');
  await expect(out.locator('.chip-crypto')).toContainText('INVALID');
  await expect(out.locator('.chip-verdict')).toContainText('FAIL-CLOSED');
});

test('mechanism walkthrough: producer signs, gateway re-encodes, verifier fails closed', async ({ page }) => {
  const mech = page.locator('#mechanism')
  await mech.getByRole('button', { name: 'Start the walkthrough' }).click()
  for (let i = 0; i < 3; i++) {
    await mech.getByRole('button', { name: 'Next step' }).click()
  }
  await expect(mech).toContainText('INVALID ✗')
  await expect(mech).toContainText('FAIL-CLOSED')
  await expect(mech.getByRole('button', { name: /Done/ })).toBeDisabled()
})

test('JCS toggle repairs key order and number form — but not Unicode composition', async ({ page }) => {
  // before: stage 1 fails closed
  await expect(page.locator('#stage-1 [role="status"]')).toContainText('INVALID ✗')
  await page.locator('#jcs-toggle').check()
  // key order repaired
  const s1 = page.locator('#stage-1 [role="status"]')
  await expect(s1).toContainText('VALID ✓')
  await expect(s1).toContainText('✓ OK')
  // number form repaired: no row in the stage 4 table still reads invalid
  await expect(page.locator('#stage-4')).not.toContainText('invalid ✗')
  // Unicode NOT repaired
  const s2 = page.locator('#stage-2 [role="status"]')
  await expect(s2).toContainText('INVALID ✗')
  await expect(s2).toContainText('FAIL-CLOSED')
})

test('duplicate keys: signature stays VALID while the verdict is ALARM, and the two parser views diverge', async ({ page }) => {
  await page.locator('#stage-3').getByRole('button', { name: /Sign the exact bytes/ }).click()
  const s3 = page.locator('#stage-3 [role="status"]')
  await expect(s3).toContainText('VALID ✓')
  await expect(s3).toContainText('ALARM')
  await expect(s3).toContainText('{"role":"user"}')
  await expect(s3).toContainText('{"role":"admin"}')
})

test('duplicate keys under JCS: rejected at parse, nothing signed', async ({ page }) => {
  await page.locator('#jcs-toggle').check()
  await page.locator('#stage-3').getByRole('button', { name: /Sign the exact bytes/ }).click()
  const s3 = page.locator('#stage-3 [role="status"]')
  await expect(s3).toContainText('FAIL-CLOSED')
  await expect(s3).toContainText(/duplicate/i)
})

test('boundary slider (keyboard): dragging the tap from raw to canonical flips a reordered doc from rejected to verified', async ({ page }) => {
  await page.locator('#mut-reorder').check()
  const s5 = page.locator('#stage-5 [role="status"]')
  await expect(s5).toContainText('INVALID ✗') // raw tap: reorder breaks it
  const slider = page.locator('#boundary-slider')
  await slider.focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(s5).toContainText('VALID ✓')
  await expect(s5).toContainText('✓ OK')
  await expect(page.locator('#stage-5 tr.current-row th')).toContainText(/After JCS serialize/i)
})

test('boundary tolerance matrix is complete and monotone at the extremes', async ({ page }) => {
  const matrix = page.locator('#stage-5 table').last()
  await expect(matrix.locator('tbody td')).toHaveCount(16)
  const rawRow = matrix.locator('tbody tr').first()
  await expect(rawRow.locator('td', { hasText: '✗ rejected' })).toHaveCount(4)
  const canonicalRow = matrix.locator('tbody tr').last()
  await expect(canonicalRow.locator('td', { hasText: '✓ verifies' })).toHaveCount(4)
})

test('scoreboard reports measured repairs: order and numbers fixed, duplicates refused', async ({ page }) => {
  const board = page.locator('#scoreboard')
  await expect(board.locator('td', { hasText: '✓ yes' })).toHaveCount(2)
  await expect(board).toContainText('refused instead')
  await expect(board).toContainText('signature valid ✓ + meaning diverged — ALARM')
})

test('unicode stage: normalize-before repairs, normalize-after breaks a genuine signature', async ({ page }) => {
  const s2 = page.locator('#stage-2 [role="status"]')
  await page.locator('#um-normalize-before').check()
  await expect(s2).toContainText('VALID ✓')
  await expect(s2).toContainText('✓ OK')
  await page.locator('#um-normalize-after').check()
  await expect(s2).toContainText('INVALID ✗')
  await expect(s2).toContainText('FAIL-CLOSED')
})
