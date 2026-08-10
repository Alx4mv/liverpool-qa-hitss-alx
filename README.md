# Liverpool QA Challenge — E2E Automation

Playwright + TypeScript framework that automates the "playstation 5" search flow on
[Liverpool.com.mx](https://www.liverpool.com.mx), cross-validates the UI results against
the intercepted network response, and reports results via the Playwright HTML reporter.

## 1. Install

```bash
npm install
npx playwright install --with-deps chromium
```

## 2. Run the tests

**Headless (default):**
```bash
npm test
```

**Headed (see the browser):**
```bash
npm run test:headed
```

**Interactive UI mode (great for debugging locally):**
```bash
npm run test:ui
```

## 3. View the HTML report

After any run:
```bash
npm run report
```
This opens `playwright-report/index.html` with pass/fail status, steps, screenshots on
failure, and traces.

## 4. If a selector fails (site markup changed)

Run:
```bash
npm run codegen
```
This opens a real browser + Playwright Inspector. Click the element that's failing
(search box, color filter, sort dropdown), copy the selector it prints, and paste it
into `tests/pages/SearchPage.ts`. See the comments at the top of that file for details.

## Project structure

```
tests/
  pages/SearchPage.ts     # Page Object — all selectors live here
  utils/network.ts        # Network interception + generic product extractor
  search.spec.ts          # The E2E scenario (Part 1 + Part 2)
playwright.config.ts       # Headless default, HTML reporter, screenshot-on-failure
.github/workflows/test.yml # CI pipeline
TEST_STRATEGY.md           # Test strategy write-up
```

## CI

Every push/PR to `main` runs the suite headless on GitHub Actions and uploads the
HTML report as a downloadable artifact.

**Passing run:** _add your Actions run link / badge here after your first push, e.g.:_
`https://github.com/<your-user>/<your-repo>/actions`

```md
![E2E Tests](https://github.com/<your-user>/<your-repo>/actions/workflows/test.yml/badge.svg)
```
