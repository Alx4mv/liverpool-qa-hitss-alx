import { Page, Locator } from '@playwright/test';

export interface Product {
  name: string;
  priceText: string;
  price: number;
}

/**
 * Converts a Mexican-peso formatted string ("$11,599.00") into a number (11599.00).
 * Exported so tests can reuse the same parsing logic when reading the intercepted
 * network response, guaranteeing UI and API prices are compared in the same format.
 */
export function parsePrice(text: string): number {
  const match = text.replace(/\s/g, '').match(/[\d.,]+/);
  if (!match) return NaN;
  // Remove thousands separators, keep decimal point.
  return parseFloat(match[0].replace(/,/g, ''));
}

/**
 * Page Object Model for the Liverpool.com.mx search results flow.
 *
 * IMPORTANT (read this before running):
 * Liverpool.com.mx is a JS-heavy storefront. The selectors below are written to be
 * as resilient as possible (role/text based, with data-testid as a first choice and
 * CSS fallbacks), but the exact DOM can change at any time and I could not execute
 * a live browser session against the real site to verify them pixel-by-pixel.
 *
 * If a step fails locally, open a terminal and run:
 *   npm run codegen
 * This opens a real browser + inspector. Click the element that's failing
 * (e.g. the color filter, or the sort dropdown) and Playwright will print the
 * exact selector it used. Paste that selector into the matching method below.
 * This is normal, expected setup work for any UI automation project — the site's
 * markup is the "source of truth", not this file.
 */
export class SearchPage {
  readonly page: Page;
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page
      .getByRole('searchbox')
      .or(page.getByPlaceholder(/buscar/i))
      .or(page.locator('input[type="search"], input[name*="search" i]'));
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.dismissCookieBannerIfPresent();
  }

  /**
   * Liverpool's cookie banner has no "Aceptar"/"Entendido" text — it's a dialog
   * with a paragraph plus a single icon-only close button (the accessible name
   * of that button is just the Material icon ligature "close"). We target the
   * dialog role directly instead of matching on button text.
   */
  private async dismissCookieBannerIfPresent(): Promise<void> {
    const dialog = this.page.getByRole('dialog');
    await dialog
      .locator('button')
      .first()
      .click({ timeout: 8_000 })
      .catch(() => {
        // No banner shown — nothing to do.
      });
  }

  async search(term: string): Promise<void> {
    const input = this.searchInput.first();
    await input.click();
    await input.fill(term);

    // Press Enter and race it against a URL change. Some autocomplete/
    // suggestions overlays intercept the Enter keypress instead of letting
    // it submit the search, so this isn't always enough on its own.
    await input.press('Enter');
    const navigatedViaEnter = await this.page
      .waitForURL(/[?&]s=/, { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (!navigatedViaEnter) {
      // Fallback: click the search (magnifying glass) icon next to the input.
      const searchIcon = this.page.getByText('search', { exact: true }).first();
      await searchIcon.click({ timeout: 5_000 }).catch(() => {});
      await this.page.waitForURL(/[?&]s=/, { timeout: 15_000 }).catch(() => {});
    }

    await this.page.waitForLoadState('domcontentloaded');
    // The cookie dialog can appear a moment after load, so check again here too.
    await this.dismissCookieBannerIfPresent();
    await this.waitForResultsGrid();
  }

  /** Waits until at least one product card is rendered. */
  async waitForResultsGrid(): Promise<void> {
    await this.productCards.first().waitFor({ state: 'visible', timeout: 20_000 });
  }

  /**
   * Confirmed against the real DOM: product cards are plain <a> links to a
   * PDP (product detail page), always matching href="/tienda/pdp/...".
   */
  get productCards(): Locator {
    return this.page.locator('a[href*="/tienda/pdp/"]');
  }

  async filterByColor(color: string): Promise<void> {
    const colorCheckbox = this.page.getByRole('checkbox', {
      name: new RegExp(`^${color}`, 'i'),
    });

    // The "Color" facet is usually already expanded on the results page, but
    // guard for the collapsed case without accidentally re-collapsing it.
    const alreadyVisible = await colorCheckbox
      .first()
      .isVisible()
      .catch(() => false);
    if (!alreadyVisible) {
      await this.page
        .getByRole('button', { name: /^color$/i })
        .click({ timeout: 5_000 })
        .catch(() => {});
    }

    await colorCheckbox.first().click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.dismissCookieBannerIfPresent();
    await this.waitForResultsGrid();
  }

  async sortByPriceLowToHigh(): Promise<void> {
    const sortControl = this.page.getByRole('button', { name: /ordenar por/i });
    await sortControl.click();

    const lowToHighOption = this.page.getByText(/menor precio/i).first();
    await lowToHighOption.click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.dismissCookieBannerIfPresent();
    await this.waitForResultsGrid();
  }

  /**
   * Reads the name + price of the first N rendered product cards.
   *
   * Price quirk: Liverpool renders pesos and centavos as two separate text
   * nodes with no decimal separator between them (e.g. "$10,199" + "25"),
   * so plain innerText concatenates them as "$10,19925". We reconstruct the
   * real price with a regex over the card's full text instead of relying on
   * a single nested locator, which is more resilient to markup changes.
   */
  async getTopResults(count: number): Promise<Product[]> {
    await this.waitForResultsGrid();
    const cards = this.productCards;
    const total = await cards.count();
    const results: Product[] = [];

    for (let i = 0; i < Math.min(count, total); i++) {
      const card = cards.nth(i);
      const name = (await card.locator('h3').first().innerText()).trim();
      const cardText = await card.innerText();

      // Matches "$10,199" + "25" (cents) as the first price found — for
      // discounted items this is the current/lower price, which appears
      // first in the DOM.
      const priceMatch = cardText.match(/\$(\d{1,3}(?:,\d{3})*)(\d{2})/);
      const priceText = priceMatch ? `$${priceMatch[1]}.${priceMatch[2]}` : cardText.slice(0, 30);
      const price = priceMatch
        ? parseFloat(`${priceMatch[1].replace(/,/g, '')}.${priceMatch[2]}`)
        : NaN;

      results.push({ name, priceText, price });
    }

    return results;
  }
}