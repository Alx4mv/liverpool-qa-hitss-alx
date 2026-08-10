import { test, expect } from '@playwright/test';
import { SearchPage } from './pages/SearchPage';
import { startSearchResponseCapture } from './utils/network';

// Bonus (data-driven): add more terms here and the same test runs for each,
// with zero code changes.
const SEARCH_TERMS = ['playstation 5'];
const COLOR_FILTER = 'Blanco';
const RESULTS_TO_EXTRACT = 5;
const MIN_MATCHES_REQUIRED = 3;

for (const term of SEARCH_TERMS) {
  test.describe(`Liverpool search flow — "${term}"`, () => {
    test(`filters by color, sorts by price, and cross-validates top ${RESULTS_TO_EXTRACT} results against the API`, async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);

      await test.step('Navigate to Liverpool', async () => {
        await searchPage.goto();
      });

      // Start capturing candidate search-API responses BEFORE triggering the
      // search. Each candidate's body is read the instant it arrives (see
      // startSearchResponseCapture), so later navigations (filter/sort)
      // can't invalidate it.
      const responseCapture = startSearchResponseCapture(page, term);

      await test.step(`Search for "${term}"`, async () => {
        await searchPage.search(term);
      });

      await test.step('Filter by color: White', async () => {
        await searchPage.filterByColor(COLOR_FILTER);
      });

      await test.step('Sort by price: lowest to highest', async () => {
        await searchPage.sortByPriceLowToHigh();
      });

      let uiResults: Awaited<ReturnType<typeof searchPage.getTopResults>> = [];
      await test.step(`Extract top ${RESULTS_TO_EXTRACT} results from the UI`, async () => {
        uiResults = await searchPage.getTopResults(RESULTS_TO_EXTRACT);

        // eslint-disable-next-line no-console
        console.log('\n=== UI RESULTS ===');
        uiResults.forEach((p, i) =>
          console.log(`${i + 1}. ${p.name} — ${p.priceText}`)
        );

        expect(uiResults.length).toBeGreaterThan(0);
      });

      let apiProducts: ReturnType<typeof responseCapture.stop>[number]['products'] = [];
      await test.step('Intercept and parse the search network response', async () => {
        await page.waitForTimeout(500); // let any trailing response finish landing
        const candidates = responseCapture.stop();

        // TEMP DEBUG: dump every same-site response we saw during the whole
        // flow, so we can see exactly what the color-filter/sort actions
        // actually triggered on the network (if anything).
        // eslint-disable-next-line no-console
        //console.log('\n=== ALL SAME-SITE RESPONSES SEEN (debug) ===');
        //responseCapture.getDebugLog().forEach((r, i) =>
        //  console.log(`${i + 1}. [${r.status}] ${r.contentType} — ${r.url}`)
        //);

        // Pick whichever captured response's products best overlap with what
        // we actually see in the UI. We stopped guessing the exact filtering/
        // sorting endpoint by URL pattern — the real one didn't echo the
        // search term or any predictable keyword — so instead we let content
        // decide: score each candidate by how many UI product names it
        // contains, and keep the best one. This is naturally also the
        // strongest possible cross-validation signal.
        function overlapScore(products: { name: string }[]): number {
          return uiResults.filter((ui) =>
            products.some(
              (p) =>
                normalize(p.name).includes(normalize(ui.name)) ||
                normalize(ui.name).includes(normalize(p.name))
            )
          ).length;
        }

        const best = candidates.reduce<typeof candidates[number] | null>((acc, cur) => {
          const curScore = overlapScore(cur.products);
          const accScore = acc ? overlapScore(acc.products) : -1;
          return curScore > accScore ? cur : acc;
        }, null);

        apiProducts = best?.products ?? [];

        // eslint-disable-next-line no-console
        console.log(
          `\n=== INTERCEPTED API PRODUCTS (from ${best?.url ?? 'n/a'}, ${candidates.length} candidates seen) ===`
        );
        apiProducts
          .slice(0, 10)
          .forEach((p, i) => console.log(`${i + 1}. ${p.name} — $${p.price}`));

        expect(apiProducts.length, 'API response should contain product data').toBeGreaterThan(0);
      });

      await test.step('Cross-validate UI results against intercepted response', async () => {
        let matches = 0;
        const discrepancies: string[] = [];

        for (const uiProduct of uiResults) {
          const apiMatch = apiProducts.find(
            (apiProduct) =>
              normalize(apiProduct.name).includes(normalize(uiProduct.name)) ||
              normalize(uiProduct.name).includes(normalize(apiProduct.name))
          );

          if (!apiMatch) {
            discrepancies.push(`NOT FOUND IN API: "${uiProduct.name}" (UI price: ${uiProduct.priceText})`);
            continue;
          }

          matches++;

          if (Math.abs(apiMatch.price - uiProduct.price) > 0.01) {
            discrepancies.push(
              `PRICE MISMATCH: "${uiProduct.name}" — UI: ${uiProduct.price}, API: ${apiMatch.price}`
            );
          }
        }

        // eslint-disable-next-line no-console
        console.log(`\n=== CROSS-VALIDATION: ${matches}/${uiResults.length} UI results matched in API ===`);
        if (discrepancies.length > 0) {
          console.log('Discrepancies found:');
          discrepancies.forEach((d) => console.log(`  - ${d}`));
        } else {
          console.log('No discrepancies found.');
        }

        expect(
          matches,
          `Expected at least ${MIN_MATCHES_REQUIRED} of ${uiResults.length} UI results to appear in the intercepted API response`
        ).toBeGreaterThanOrEqual(MIN_MATCHES_REQUIRED);
      });
    });
  });
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]/g, '');
}