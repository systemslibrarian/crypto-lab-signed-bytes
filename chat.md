# Signed Bytes: What Would Make This the Gold Standard

This repo is already closer to gold-standard than most teaching demos. The core strengths are real:

- Real crypto with a justified library boundary: Ed25519 via `@noble/ed25519`, with the teaching surface hand-rolled where the lesson lives (`src/crypto/ed25519.ts`, `src/jcs/canonicalize.ts`, `src/json/parse.ts`).
- Strong pedagogy and honesty in the README: the demo is explicit about what is real, what is being taught, and what it does not prove.
- Good test depth: `npm test` currently passes with 128 tests across byte helpers, parser behavior, JCS KATs, Ed25519 KATs, stage logic, and the Stage 5 boundary matrix.
- Production build health: `npm run build` passes and the bundle is small enough to remain inspectable.

If the goal is "gold standard," I would focus on the gaps below, in priority order.

## P0: Fix The Accessibility Gate So It Actually Runs Locally

This is the only concrete operational break I verified.

- `npm run test:a11y` currently fails with `Timed out waiting 60000ms from config.webServer`.
- The preview server starts correctly, but Playwright is waiting on `http://localhost:4173/crypto-lab-signed-bytes/` from `playwright.config.ts`.
- In practice, `vite preview` is serving successfully at `http://localhost:4173/`, while a direct request to `http://localhost:4173/crypto-lab-signed-bytes/` returns `404` locally.

Why this matters:

- A gold-standard repo cannot have a flagship quality gate that only appears to exist.
- Even if CI happens to pass in some environments, a broken local gate reduces trust and makes contributor workflows weaker.

What to do:

1. Make the Playwright `webServer.url` and `use.baseURL` match the actual preview behavior locally.
2. Add a single `npm run ci` script that runs the exact local quality bar in one command.
3. Treat "local developer can run the full gate without special knowledge" as part of the standard.

## P1: Add Behavior E2E, Not Just Axe Scans

The repo has strong unit coverage and an accessibility gate, but it still lacks end-to-end proof that the main teaching interactions behave correctly in the browser.

What is missing:

- There is only one Playwright spec today, and it is accessibility-only.
- The most important behaviors are UI-driven: the mechanism walkthrough, the JCS toggle, the duplicate-key ALARM, and the Stage 5 boundary tolerance story.

What to add:

1. A Playwright happy-path suite that asserts the headline outcomes in the actual UI:
   - mechanism walkthrough ends in fail-closed rejection
   - JCS repairs key order and number form
   - JCS does not repair Unicode composition
   - duplicate-key stage shows valid signature plus ALARM
   - boundary stage matrix changes consistently with the slider
2. Keyboard-only interaction tests for every stage with controls.
3. A small visual regression suite for the hero, verdict chips, duplicate-key ALARM stage, and boundary matrix.

Why this matters:

- The teaching value lives in the browser experience, not only in pure functions.
- Gold-standard educational software should catch broken explanations and broken interaction wiring, not just broken algorithms.

## P1: Make The Test Story Stronger Than "128 Passing"

The current tests are good. Gold standard would make them harder to game and easier to reason about over time.

Recommended additions:

1. Add line and branch coverage reporting with enforced thresholds.
2. Add property-based tests for parser and canonicalizer invariants.
   - parse -> canonicalize -> parse stability for accepted inputs
   - duplicate rejection invariants under JCS
   - Unicode and number edge cases beyond named examples
3. Add mutation testing for the most security-sensitive logic:
   - verdict separation in `src/lab/stages.ts`
   - duplicate-key policy handling in `src/json/parse.ts`
   - boundary tolerance logic in `src/lab/boundary.ts`
4. Add a browser-matrix run for Chromium, Firefox, and WebKit.

Why this matters:

- KATs prove conformance on known vectors; property and mutation tests prove the surrounding logic is difficult to accidentally weaken.
- Browser demos should not assume one engine is enough, especially when text encoding and DOM behavior are central to the lesson.

## P1: Add Static Analysis And Supply-Chain Hygiene

I did not find evidence of ESLint, formatting enforcement, dependency automation, or security scanning in the repo.

For a gold-standard public codebase, I would add:

1. ESLint with TypeScript rules, wired into CI.
2. Prettier or an equally explicit formatting policy.
3. Dependabot or Renovate for dependency updates.
4. CodeQL and `npm audit` in CI, with a policy for triage rather than silent drift.
5. A pinned Node support policy in the README and CI, rather than only an Actions version selection.

Why this matters:

- The code is security-adjacent and educational. That raises the bar for clarity and maintenance, even though it is not production crypto.
- A gold-standard repo should make drift visible before it becomes debt.

## P2: Make The Demo Reproducible In Test Mode

The app correctly generates a fresh Ed25519 keypair per page load. That is good for the live demo, but it makes deterministic browser assertions and screenshot baselines harder than they need to be.

What to add:

1. A clearly non-default test mode that swaps in a fixed seed or fixture keypair.
2. Stable selectors or explicit test IDs for the critical stage outputs.
3. A way to hide or freeze incidental per-load variance in screenshot runs.

Why this matters:

- Reproducibility is one of the differences between a polished demo and a reference implementation.
- It also makes regression investigation much faster.

## P2: Raise The Documentation From Excellent README To Full Maintainer Standard

The README is already strong. The next step is maintainer-facing documentation.

I would add:

1. `CONTRIBUTING.md` with the repo quality bar, local commands, and how to add a new stage safely.
2. `LICENSE` if this is intended to be a reusable public project.
3. A short architecture note describing the invariants:
   - byte-level truth lives in `src/core`
   - crypto validity and security verdicts must remain separate
   - parser policy differences are part of the lesson and must never be normalized away accidentally
4. A release checklist for README, tests, a11y, and GitHub Pages deploy verification.

Why this matters:

- Gold-standard repos are legible to future maintainers, not only impressive to readers.

## P2: Tighten The Educational UX With Explicit Expert/Newcomer Layers

The pedagogy is already thoughtful. The next gain is in making the expert and newcomer paths more intentional.

Ideas worth considering:

1. Add a compact glossary drawer for terms like JCS, NFC/NFD, I-JSON, and ZIP215.
2. Add "show me the exact bytes" and "explain this in plain language" toggles where the densest panels live.
3. Add deep-linkable stage URLs or hashes so a teacher can send students directly to the duplicate-key or boundary stage.
4. Add a teacher mode or worksheet prompts for classroom use.

Why this matters:

- The repo already teaches well. Gold standard would make it easier to teach with, not just learn from.

## P3: Add Performance And Size Budgets

The current bundle is small, which is good. Gold standard would preserve that with enforcement.

What to add:

1. A bundle-size budget in CI.
2. A lightweight performance smoke test for first load on a throttled mobile profile.
3. A policy that new visual features must justify any noticeable JS or CSS growth.

Why this matters:

- Teaching demos should stay fast and inspectable.
- Performance regressions are easiest to prevent when budgets exist before the project grows.

## Recommended Order Of Operations

1. Fix the local Playwright preview/a11y URL mismatch.
2. Add `npm run ci` plus lint/security automation.
3. Add browser-level behavior E2E for the core teaching flows.
4. Add coverage thresholds, property tests, and mutation tests.
5. Add reproducible test mode and visual regression.
6. Add maintainer docs, license, and release checklist.
7. Add educational deep-linking and glossary/teacher-mode polish.

## Bottom Line

This is already an excellent repo. The difference between "excellent" and "gold standard" here is not more crypto or more stages. It is operational rigor, browser-level proof of the teaching flows, and maintainer-grade repeatability.

If I were only allowed to choose three upgrades, I would choose:

1. Fix the broken local a11y gate.
2. Add real Playwright behavior tests for the key teaching moments.
3. Add static analysis plus reproducible test mode.