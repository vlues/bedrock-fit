/* ===================== Bedrock — barcode → OpenFoodFacts lookup ===================== */
/* Packaged food via barcode: exact label nutrition instead of an AI guess.
   Data comes from OpenFoodFacts (open, free, no API key, CORS-enabled),
   which has strong coverage of European/Spanish products. Live camera
   detection uses the browser's native BarcodeDetector where available
   (Chrome/Android); on browsers without it (iOS Safari) the flow falls
   back to typing the number printed under the barcode — same lookup. */

const Barcode = (() => {

  function detectorSupported() {
    return 'BarcodeDetector' in window;
  }

  // Prefer the local-language product name (product_name is the package's
  // primary language — Spanish for products bought in Spain), then explicit
  // es/en variants, so the log reads the way the label does.
  function productName(p) {
    return (p.product_name || p.product_name_es || p.product_name_en || '').trim();
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  async function lookup(code, _retriesLeft = 1) {
    const clean = String(code || '').replace(/\D/g, '');
    if (clean.length < 6) return { ok: false, error: 'bad_code' };
    try {
      const res = await withTimeout(fetch(
        `https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=product_name,product_name_es,product_name_en,brands,nutriments,serving_quantity,serving_size,quantity`
      ), 10000, 'openfoodfacts');
      if (!res.ok) {
        if (res.status === 404) return { ok: false, error: 'not_found' }; // v2 404s unknown barcodes rather than returning status:0
        if (res.status >= 500 && _retriesLeft > 0) { await sleep(600); return lookup(clean, _retriesLeft - 1); }
        return { ok: false, error: 'http_' + res.status };
      }
      const data = await res.json();
      if (data.status !== 1 || !data.product) return { ok: false, error: 'not_found' };
      const p = data.product;
      const n = p.nutriments || {};
      const per100 = {
        calories: num(n['energy-kcal_100g']),
        proteinG: num(n.proteins_100g),
        carbG: num(n.carbohydrates_100g),
        fatG: num(n.fat_100g)
      };
      if (per100.calories == null && per100.proteinG == null) return { ok: false, error: 'no_nutrition' };
      const base = productName(p) || 'Packaged food';
      const brand = p.brands ? String(p.brands).split(',')[0].trim() : '';
      const name = brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${base} (${brand})` : base;
      return {
        ok: true,
        name,
        per100,
        servingG: num(p.serving_quantity),
        servingLabel: p.serving_size || null,
        code: clean
      };
    } catch (e) {
      if (_retriesLeft > 0) { await sleep(600); return lookup(clean, _retriesLeft - 1); }
      return { ok: false, error: String(e).startsWith('Error: timeout') ? 'timeout' : 'network' };
    }
  }

  return { detectorSupported, lookup };
})();
