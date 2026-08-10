# Test Strategy

## What would I NOT automate, and why?

- **Payment / checkout completion.** High business risk if a bug creates a real order or charge, requires sensitive test payment credentials, and the ROI is low compared to manual/exploratory testing plus backend-level integration tests on the payment service itself.
- **Visual pixel-perfect layout across every breakpoint.** Cheaper and more stable to cover with a small, targeted visual-regression snapshot (see bonus) than to assert exact positioning in the E2E flow — CSS changes shouldn't break a functional suite.
- **Exact copy/marketing text** (banners, promo strings). These change constantly for merchandising reasons unrelated to functionality; asserting on them creates high-maintenance, low-value tests.
- **Third-party content** (ads, recommendation widgets, chat widgets). Outside the team's control and a common source of flakiness with no functional value to this flow.
- **Recommendation/personalization algorithm quality** ("is this the *best* sort?") — that's a data-science/product concern, not something E2E UI tests should assert on.

## If Liverpool added a CAPTCHA to the search flow

I would **not** try to bypass or solve it programmatically (this is against most CAPTCHA providers' ToS and brittle by nature). Instead:
1. Ask engineering for a **test/staging environment with CAPTCHA disabled** for automated test traffic (e.g. a feature flag, allow-listed test user-agent, or a bypass token) — this is the standard industry approach.
2. If that's not possible, **scope E2E coverage to below the CAPTCHA step** and move deeper flow coverage to API/component-level tests that don't go through the browser challenge.
3. Keep one manual/exploratory smoke check for the CAPTCHA UX itself, since that's a human-facing control and not meaningfully automatable end-to-end.

## Flakiness risks and mitigations

| Risk | Mitigation used |
|---|---|
| Dynamic content / async rendering (SPA) | Waits are state-based (`waitFor`, `waitForLoadState`), never fixed `sleep()` calls |
| Network response timing (Part 2) | Response listener is attached **before** the triggering action, avoiding a race condition |
| Selector drift on a frequently-changing storefront | Locators prefer `data-testid`/role/text over brittle CSS/XPath, with documented fallbacks and a Codegen-based recovery workflow |
| Environment flukes in CI | 2 retries configured in CI only (not locally, to avoid masking real bugs during development) |
| Ambiguous/unknown API response shape | Generic recursive product extractor instead of a hardcoded JSON path, so the test survives minor payload restructuring |
| Third-party pop-ups (cookie banners, etc.) | Handled defensively with short timeouts and `.catch()`, so their *absence* doesn't fail the test |

## Adding this to a CI pipeline with 50+ other suites

- **Tag and split**: mark this as `@e2e` / `@smoke` vs `@regression` and only run the smoke subset on every PR; run the full regression suite on a schedule (nightly) or on merge to main.
- **Parallelize and shard** using Playwright's `--shard` across multiple CI runners to keep wall-clock time flat as suites grow.
- **Isolate flake blame**: report to a shared dashboard (e.g. Allure/Playwright HTML published per-suite) with per-suite ownership, so a flaky suite doesn't block unrelated teams.
- **Fail fast on infra vs. product issues**: separate "environment health" checks (site is up, API reachable) from functional assertions so a prod outage doesn't get logged as 50 unrelated test failures.
- **Cap total pipeline time** with a strict per-suite timeout and move slow/heavy suites (visual regression, cross-browser) to a separate, non-blocking job.
