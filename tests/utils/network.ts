import { Page, Response } from '@playwright/test';

export interface IntercepytedProduct {
  name: string;
  price: number;
}



/** Keys that commonly hold a product's display name across different e-commerce APIs. */
const NAME_KEY_HINTS = ['name', 'nombre', 'title', 'titulo'];
/** Keys that commonly hold a product's price. */
const PRICE_KEY_HINTS = ['price', 'precio', 'importe', 'monto', 'costo', 'valor'];

function looksLikeNameKey(key: string): boolean {
  const k = key.toLowerCase();
  return NAME_KEY_HINTS.some((hint) => k.includes(hint));
}

function looksLikePriceKey(key: string): boolean {
  const k = key.toLowerCase();
  return PRICE_KEY_HINTS.some((hint) => k.includes(hint));
}

/** Extracts a numeric price from a value that may be a plain number, a numeric
 * string, or a nested object like { value: 14699 } / { amount: 14699 }. */
function coercePriceValue(value: unknown): number | null {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const nestedKey of ['value', 'amount', 'valor', 'monto']) {
      if (typeof obj[nestedKey] === 'number') return obj[nestedKey] as number;
    }
  }
  return null;
}

/**
 * We don't know Liverpool's exact search-API response shape ahead of time (it's an
 * internal API and can change without notice), so instead of hardcoding a single
 * field path (e.g. `data.products[].price`), we recursively walk the whole JSON
 * payload and pull out every object that looks like a product (has a name-like
 * field AND a price-like field, matched by substring so exact key names don't
 * need to be known in advance). This makes the validation layer resilient to
 * nesting changes and is the safer default for a black-box API.
 */
export function extractProductsFromJson(payload: unknown): IntercepytedProduct[] {
  const found: IntercepytedProduct[] = [];
  const seen = new Set<unknown>();

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);

    const nameKey = keys.find(
      (k) => looksLikeNameKey(k) && typeof obj[k] === 'string' && (obj[k] as string).trim().length > 1
    );
    const priceKey = keys.find((k) => looksLikePriceKey(k) && coercePriceValue(obj[k]) !== null);

    if (nameKey && priceKey) {
      found.push({
        name: (obj[nameKey] as string).trim(),
        price: coercePriceValue(obj[priceKey]) as number,
      });
    }

    for (const value of Object.values(obj)) {
      walk(value);
    }
  }

  walk(payload);
  return found;
}

/**
 * Confirmed via manual DevTools inspection: Liverpool does NOT ship search
 * results as a separate JSON call, nor as embedded JSON in the document (no
 * __NEXT_DATA__-style script tag either) — the products are rendered
 * directly as HTML markup in the search-results document response itself.
 * So the network response we validate against IS the document response;
 * we just need to parse product data out of its HTML instead of JSON.
 *
 * Each product is a `<a href="/tienda/pdp/...">` block containing an
 * `<h3>` (product name) and a price rendered as two adjacent text nodes
 * with no decimal separator (e.g. "$14,699" + "00") — the same quirk we
 * already handle for the UI-side extraction in SearchPage.getTopResults.
 */
function extractProductsFromHtml(html: string): IntercepytedProduct[] {
  const products: IntercepytedProduct[] = [];
  const anchorPattern = /<a[^>]+href="(\/tienda\/pdp\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const block = match[2];

    const nameMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (!nameMatch) continue;
    const name = nameMatch[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .trim();
    if (!name) continue;

    const plainText = block.replace(/<[^>]+>/g, '');
    const priceMatch = plainText.match(/\$(\d{1,3}(?:,\d{3})*)(\d{2})/);
    if (!priceMatch) continue;

    products.push({
      name,
      price: parseFloat(`${priceMatch[1].replace(/,/g, '')}.${priceMatch[2]}`),
    });
  }

  return products;
}

export interface CapturedApiResponse {
  url: string;
  products: IntercepytedProduct[];
}

/**
 * Starts listening for candidate search-API responses and reads each one's
 * body IMMEDIATELY as it arrives (inside the event handler), rather than
 * waiting and reading it later. This sidesteps a real race condition: if you
 * hold onto a Response object and read .json() after the page has since
 * navigated further (e.g. after applying a filter), Chromium may have
 * already discarded that response's body ("response was navigated away
 * from"). Reading eagerly, per-response, avoids that entirely.
 *
 * Call `.stop()` once the UI-side flow (search, filter, sort) is done; it
 * returns every candidate response that looked like search-results JSON
 * (matched the search term and contained product-shaped data).
 */
/**
 * Many modern storefronts (Next.js and similar SSR frameworks) don't always
 * fetch search results via a separate XHR/fetch call — the results can be
 * server-rendered and shipped embedded as JSON inside the HTML document
 * itself (classically in a `<script id="__NEXT_DATA__">` tag, but other
 * frameworks use similar patterns). We scan for any `<script type="application/json">`
 * block (by id or generic type) and try to parse each one.
 */
function extractEmbeddedJsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scriptTagPattern = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

  const nextDataMatch = html.match(nextDataPattern);
  if (nextDataMatch) {
    try {
      blocks.push(JSON.parse(nextDataMatch[1]));
    } catch {
      // Not valid JSON — skip.
    }
  }

  let match: RegExpExecArray | null;
  while ((match = scriptTagPattern.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // Not valid JSON — skip.
    }
  }

  return blocks;
}

export interface DebugSeenResponse {
  url: string;
  contentType: string;
  status: number;
}

export function startSearchResponseCapture(
  page: Page,
  searchTerm: string
): { stop: () => CapturedApiResponse[]; getDebugLog: () => DebugSeenResponse[] } {
  const termSlug = searchTerm.toLowerCase().replace(/\s+/g, '');
  const captured: CapturedApiResponse[] = [];
  const debugLog: DebugSeenResponse[] = [];

  const handler = async (response: Response) => {
    try {
      const rawUrl = response.url();
      const decodedUrl = decodeURIComponent(rawUrl).toLowerCase();
      const contentType = response.headers()['content-type'] || '';
      const status = response.status();

      const isSameSite = decodedUrl.includes('liverpool.com.mx');
      if (isSameSite) {
        debugLog.push({ url: rawUrl, contentType, status });
      }
      if (status !== 200) return;

      // We deliberately do NOT filter candidates by guessing URL keywords
      // here anymore — Liverpool's color-filter and sort actions turned out
      // not to echo the search term or any predictable keyword in their
      // request URL, so a keyword filter was silently discarding the real
      // response. Instead we accept any same-site JSON/HTML response and let
      // the caller pick the one whose content actually matches the UI
      // (see the "best overlap" selection in search.spec.ts).
      if (!isSameSite) return;

      if (contentType.includes('application/json')) {
        const json = await response.json(); // read NOW, while the body is guaranteed available
        const products = extractProductsFromJson(json);
        if (products.length > 0) {
          captured.push({ url: response.url(), products });
        }
        return;
      }

      // SSR fallback: the search-results page itself is an HTML document
      // whose response body carries the product data — either as embedded
      // JSON (some frameworks) or, as confirmed for Liverpool, as directly
      // rendered markup. Try both extraction strategies.
      if (contentType.includes('text/html')) {
        const html = await response.text();

        const jsonBlocks = extractEmbeddedJsonBlocks(html);
        for (const block of jsonBlocks) {
          const products = extractProductsFromJson(block);
          if (products.length > 0) {
            captured.push({ url: response.url(), products });
          }
        }

        const htmlProducts = extractProductsFromHtml(html);
        if (htmlProducts.length > 0) {
          captured.push({ url: `${response.url()} (parsed from HTML)`, products: htmlProducts });
        }
      }
    } catch {
      // Some matched responses are transient/aborted/non-JSON in practice
      // despite the content-type check (e.g. cancelled prefetches) — safe to skip.
    }
  };

  page.on('response', handler);

  return {
    stop: () => {
      page.off('response', handler);
      return captured;
    },
    getDebugLog: () => debugLog,
  };
}

/** @deprecated superseded by startSearchResponseCapture — kept unused to avoid breaking other imports. */
export function waitForSearchResponse(page: Page, searchTerm: string): Promise<Response> {
  const termSlug = searchTerm.toLowerCase().replace(/\s+/g, '');
  return page.waitForResponse(
    (response) => {
      const url = response.url().toLowerCase();
      const isJson = (response.headers()['content-type'] || '').includes('application/json');
      const looksLikeSearchCall = url.includes('search') || url.includes('busqueda') || url.includes(termSlug);
      return isJson && looksLikeSearchCall && response.status() === 200;
    },
    { timeout: 30_000 }
  );
}