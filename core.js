/* Simpan — receipt-to-pantry demo, offline-first.
 * core.js holds ALL logic + seeded demo data so it can be unit-tested in Node
 * (no browser, no network) and reused unchanged by the browser UI.
 *
 * Design rules this file enforces (regression-tested):
 *   - No network calls, no external URLs, no fetch/XHR, no API keys.
 *   - Empty pantry and zero-value ledgers never divide by zero.
 *   - Hostile receipt files (zero-byte, oversize, HEIC, non-image, corrupt)
 *     return a { reason } instead of throwing or hanging.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SimpanCore = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_BYTES = 5 * 1024 * 1024;      // 5 MB receipt-photo cap
  var MIN_DIM = 200;                     // smallest plausible receipt photo edge

  // Where food is kept changes how long it lasts. Values are days for a
  // category in each storage place; `fridge` is the baseline the demo assumes.
  // Conservative heuristics for the demo, not a food-safety claim.
  var STORAGE_DAYS = {
    poultry: { pantry: 1,  fridge: 2,   freezer: 180 },
    fish:    { pantry: 1,  fridge: 2,   freezer: 180 },
    meat:    { pantry: 1,  fridge: 3,   freezer: 180 },
    veg:     { pantry: 2,  fridge: 4,   freezer: 240 },
    greens:  { pantry: 1,  fridge: 3,   freezer: 240 },
    fruit:   { pantry: 3,  fridge: 5,   freezer: 300 },
    bakery:  { pantry: 3,  fridge: 4,   freezer: 90  },
    dairy:   { pantry: 1,  fridge: 7,   freezer: 60  },
    eggs:    { pantry: 7,  fridge: 21,  freezer: 365 },
    dry:     { pantry: 180, fridge: 180, freezer: 730 },
    frozen:  { pantry: 1,  fridge: 3,   freezer: 365 },
    drinks:  { pantry: 90, fridge: 180, freezer: 365 },
    other:   { pantry: 3,  fridge: 7,   freezer: 60  }
  };

  var STORAGES = ['pantry', 'fridge', 'freezer'];
  var DEFAULT_STORAGE = 'fridge';

  // Backward-compatible view of the same table (fridge values).
  var CATEGORY_DAYS = {};
  Object.keys(STORAGE_DAYS).forEach(function (k) { CATEGORY_DAYS[k] = STORAGE_DAYS[k][DEFAULT_STORAGE]; });

  function normalizeCategory(category) {
    var c = (category || 'other').toLowerCase();
    return Object.prototype.hasOwnProperty.call(STORAGE_DAYS, c) ? c : 'other';
  }

  function normalizeStorage(storage) {
    var s = (storage || DEFAULT_STORAGE).toLowerCase();
    return STORAGES.indexOf(s) === -1 ? DEFAULT_STORAGE : s;
  }

  // Seeded sample receipt — the deterministic demo path. prices in RM.
  var DEMO_RECEIPT = [
    { name: 'Ayam (chicken breast)', category: 'poultry',  qty: '500 g', unit: 'pack', price: 9.80, shelfDays: 2, purchasedDaysAgo: 1 },
    { name: 'Bayam (spinach)',        category: 'greens',   qty: '1',     unit: 'bunch', price: 3.20, shelfDays: 3, purchasedDaysAgo: 2 },
    { name: 'Roti Gandum (bread)',    category: 'bakery',   qty: '1',     unit: 'loaf', price: 4.50, shelfDays: 4, purchasedDaysAgo: 2 },
    { name: 'Susu Segar (fresh milk)',category: 'dairy',    qty: '1 L',   unit: 'carton', price: 7.50, shelfDays: 7, purchasedDaysAgo: 3 },
    { name: 'Pisang (bananas)',       category: 'fruit',    qty: '1 kg',  unit: 'bunch', price: 5.00, shelfDays: 5, purchasedDaysAgo: 1 },
    { name: 'Telur AA (eggs)',        category: 'eggs',     qty: '10',    unit: 'pcs', price: 6.90, shelfDays: 21, purchasedDaysAgo: 3 },
    { name: 'Beras (rice)',           category: 'dry',      qty: '5 kg',  unit: 'bag', price: 28.00, shelfDays: 180, purchasedDaysAgo: 0 },
    { name: 'Minyak Masak (oil)',     category: 'dry',      qty: '1 L',   unit: 'bottle', price: 9.90, shelfDays: 365, purchasedDaysAgo: 0 }
  ];

  // Days a category lasts in a given storage. Default arg keeps the old
  // one-argument call working (fridge baseline).
  function shelfDaysFor(category, storage) {
    var c = normalizeCategory(category);
    var s = storage === undefined ? DEFAULT_STORAGE : normalizeStorage(storage);
    return STORAGE_DAYS[c][s];
  }

  // Ratio of a storage place to the fridge baseline, so an item's explicit
  // shelfDays (measured in a fridge) can be scaled when it moves.
  function storageRatio(category, storage) {
    var c = normalizeCategory(category);
    var s = normalizeStorage(storage);
    return STORAGE_DAYS[c][s] / STORAGE_DAYS[c][DEFAULT_STORAGE];
  }

  function effectiveShelfDays(item) {
    var base = item.shelfDays != null ? item.shelfDays : shelfDaysFor(item.category);
    var scaled = base * storageRatio(item.category, item.storage);
    return Math.max(0, Math.round(scaled));
  }

  function daysLeftOf(item) {
    return effectiveShelfDays(item) - (item.purchasedDaysAgo || 0);
  }


  function statusOf(daysLeft) {
    if (daysLeft < 0) return 'expired';
    if (daysLeft === 0) return 'expired';   // expires today
    if (daysLeft <= 2) return 'soon';
    return 'fresh';
  }

  function expiryLabel(daysLeft) {
    if (daysLeft < 0) return 'Expired ' + (-daysLeft) + 'd ago';
    if (daysLeft === 0) return 'Expires today';
    if (daysLeft === 1) return '1 day left';
    return daysLeft + ' days left';
  }

  // Raw receipt rows -> pantry items with derived fields. Pure, no mutation.
  function buildPantry(rawItems) {
    var rows = Array.isArray(rawItems) ? rawItems : [];
    return rows.map(function (r, i) {
      var dl = daysLeftOf(r);
      return {
        id: 'item-' + (i + 1),
        name: r.name,
        category: r.category || 'other',
        qty: r.qty != null ? String(r.qty) : '',
        unit: r.unit || '',
        price: typeof r.price === 'number' ? r.price : 0,
        shelfDays: r.shelfDays != null ? r.shelfDays : shelfDaysFor(r.category, r.storage),
        storage: normalizeStorage(r.storage),
        purchasedDaysAgo: r.purchasedDaysAgo || 0,
        daysLeft: dl,
        status: statusOf(dl),
        expiryLabel: expiryLabel(dl),
        disposition: null            // null | 'used' | 'tossed'
      };
    });
  }

  // "Use this first" — active items sorted by days-left ascending.
  function useFirstList(pantry) {
    var list = (pantry || []).filter(function (it) { return it.disposition === null; });
    return list.slice().sort(function (a, b) { return a.daysLeft - b.daysLeft; });
  }

  function setDisposition(pantry, id, disposition) {
    return (pantry || []).map(function (it) {
      if (it.id !== id) return it;
      return Object.assign({}, it, { disposition: disposition });
    });
  }
  function markUsed(pantry, id) { return setDisposition(pantry, id, 'used'); }
  function markTossed(pantry, id) { return setDisposition(pantry, id, 'tossed'); }

  // Move an item to another storage place and recompute its expiry. Immutable:
  // returns a new pantry, the input is untouched.
  function setStorage(pantry, id, storage) {
    var target = normalizeStorage(storage);
    return (pantry || []).map(function (it) {
      if (it.id !== id) return it;
      var moved = Object.assign({}, it, { storage: target });
      var dl = daysLeftOf(moved);
      return Object.assign(moved, {
        daysLeft: dl,
        status: statusOf(dl),
        expiryLabel: expiryLabel(dl)
      });
    });
  }

  // Aggregates for the waste/savings ledger + recap. Never divides by zero.
  function summary(pantry) {
    var rows = pantry || [];
    var s = { total: rows.length, used: 0, tossed: 0, remaining: 0,
              rescuedRM: 0, wastedRM: 0, totalRM: 0 };
    rows.forEach(function (it) {
      s.totalRM += it.price || 0;
      if (it.disposition === 'used') { s.used += 1; s.rescuedRM += it.price || 0; }
      else if (it.disposition === 'tossed') { s.tossed += 1; s.wastedRM += it.price || 0; }
      else { s.remaining += 1; }
    });
    // round to 2dp to avoid float noise on screen
    s.rescuedRM = Math.round(s.rescuedRM * 100) / 100;
    s.wastedRM = Math.round(s.wastedRM * 100) / 100;
    s.totalRM = Math.round(s.totalRM * 100) / 100;
    var denom = s.rescuedRM + s.wastedRM;
    s.rescueRate = denom === 0 ? 0 : s.rescuedRM / denom;   // guarded
    return s;
  }

  // ---- hostile file validation (pure, byte-level, testable in Node) ----

  function sniffImage(bytes) {
    if (!bytes || bytes.length < 4) return 'empty';
    var b = bytes;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
    if (b[0] === 0x42 && b[1] === 0x4D) return 'bmp';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
      // RIFF....WEBP
      if (bytes.length >= 12 &&
          b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
      return 'unknown';
    }
    if (bytes.length >= 12 &&
        b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) { // "ftyp"
      var brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
      if (['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1', 'hevm', 'heim', 'heis'].indexOf(brand) !== -1) return 'heic';
      if (['avif', 'avis'].indexOf(brand) !== -1) return 'avif';
      return 'unknown';
    }
    return 'unknown';
  }

  var HEIC_EXTS = /\.(heic|heif|avif)$/i;

  // Validate a chosen receipt file from its metadata + first bytes.
  // Returns { ok:true } or { ok:false, code, reason }. Never throws.
  function validateReceiptFile(opts) {
    opts = opts || {};
    var name = opts.name || '';
    var size = typeof opts.size === 'number' ? opts.size : 0;
    var bytes = opts.firstBytes || null;

    if (size === 0) {
      return { ok: false, code: 'empty', reason: 'This file is empty — nothing to scan.' };
    }
    if (HEIC_EXTS.test(name)) {
      return { ok: false, code: 'heic', reason: 'HEIC/HEIF photos aren\u2019t supported yet — save it as JPG or PNG and try again.' };
    }
    if (size > MAX_BYTES) {
      return { ok: false, code: 'too_big', reason: 'That file is over 5 MB — too large to scan. Try a smaller photo.' };
    }
    var kind = sniffImage(bytes);
    if (kind === 'empty') {
      return { ok: false, code: 'empty', reason: 'This file is empty — nothing to scan.' };
    }
    if (kind === 'heic') {
      return { ok: false, code: 'heic', reason: 'HEIC/HEIF photos aren\u2019t supported yet — save it as JPG or PNG and try again.' };
    }
    if (kind === 'avif') {
      return { ok: false, code: 'avif', reason: 'AVIF photos aren\u2019t supported yet — save it as JPG or PNG.' };
    }
    if (kind === 'unknown') {
      return { ok: false, code: 'not_image', reason: 'That doesn\u2019t look like an image file — pick a JPG or PNG photo of the receipt.' };
    }
    // Looks like a real image: hand off to decode (browser verifies it actually
    // loads and is big enough). Offline OCR is unavailable, so the caller falls
    // back to the bundled sample receipt.
    return { ok: true, kind: kind };
  }

  return {
    MAX_BYTES: MAX_BYTES,
    MIN_DIM: MIN_DIM,
    CATEGORY_DAYS: CATEGORY_DAYS,
    STORAGE_DAYS: STORAGE_DAYS,
    STORAGES: STORAGES,
    DEFAULT_STORAGE: DEFAULT_STORAGE,
    DEMO_RECEIPT: DEMO_RECEIPT,
    shelfDaysFor: shelfDaysFor,
    daysLeftOf: daysLeftOf,
    statusOf: statusOf,
    expiryLabel: expiryLabel,
    buildPantry: buildPantry,
    useFirstList: useFirstList,
    markUsed: markUsed,
    markTossed: markTossed,
    setStorage: setStorage,
    effectiveShelfDays: effectiveShelfDays,
    summary: summary,
    sniffImage: sniffImage,
    validateReceiptFile: validateReceiptFile
  };
}));
