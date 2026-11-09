// Simpan regression suite — run with:  node --test tests/regression.test.js
// Covers: shelf-life heuristic, pantry build/order, ledger math (incl. divide-by-zero),
// empty-pantry recovery, and every hostile receipt-file case from the fixture set.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../core.js');
const FIX = path.join(__dirname, '..', 'fixtures');

function firstBytes(file, n) {
  const buf = fs.readFileSync(file);
  return buf.subarray(0, n);
}

// ---- shelf-life heuristic ----
test('shelf-life heuristic maps categories and falls back to "other"', () => {
  assert.strictEqual(C.shelfDaysFor('dairy'), 7);
  assert.strictEqual(C.shelfDaysFor('poultry'), 2);
  assert.strictEqual(C.shelfDaysFor('eggs'), 21);
  assert.strictEqual(C.shelfDaysFor('whatever-unknown'), 7);
  assert.strictEqual(C.shelfDaysFor(undefined), 7);
  assert.strictEqual(C.shelfDaysFor(''), 7);
});

// ---- pantry build + ordering ----
test('buildPantry derives daysLeft/status/expiryLabel for every seeded item', () => {
  const p = C.buildPantry(C.DEMO_RECEIPT);
  assert.strictEqual(p.length, 8);
  for (const it of p) {
    assert.strictEqual(it.daysLeft, it.shelfDays - it.purchasedDaysAgo);
    assert.ok(['fresh', 'soon', 'expired'].includes(it.status), 'status valid: ' + it.status);
    assert.ok(it.expiryLabel.length > 0);
    assert.strictEqual(it.disposition, null);
  }
  // chicken: shelf 2, bought 1 day ago -> 1 day left -> 'soon'
  const chicken = p.find(x => x.name.includes('Ayam'));
  assert.strictEqual(chicken.daysLeft, 1);
  assert.strictEqual(chicken.status, 'soon');
});

test('useFirstList sorts by days-left ascending and excludes used/tossed', () => {
  let p = C.buildPantry(C.DEMO_RECEIPT);
  const list = C.useFirstList(p);
  assert.strictEqual(list.length, 8);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].daysLeft <= list[i].daysLeft, 'ascending order');
  }
  // mark the first (soonest) used -> drops out, next takes its place
  const firstId = list[0].id;
  p = C.markUsed(p, firstId);
  const after = C.useFirstList(p);
  assert.strictEqual(after.length, 7);
  assert.ok(!after.some(x => x.id === firstId));
});

test('markUsed/markTossed are immutable and set disposition', () => {
  const p = C.buildPantry(C.DEMO_RECEIPT);
  const id = p[0].id;
  const used = C.markUsed(p, id);
  assert.strictEqual(used.find(x => x.id === id).disposition, 'used');
  assert.strictEqual(p.find(x => x.id === id).disposition, null); // original untouched
  const tossed = C.markTossed(p, id);
  assert.strictEqual(tossed.find(x => x.id === id).disposition, 'tossed');
});

// ---- ledger math (divide-by-zero) ----
test('summary never divides by zero (rescueRate guarded)', () => {
  const empty = C.summary([]);
  assert.strictEqual(empty.total, 0);
  assert.strictEqual(empty.rescuedRM, 0);
  assert.strictEqual(empty.wastedRM, 0);
  assert.strictEqual(empty.rescueRate, 0);
  assert.ok(Number.isFinite(empty.rescueRate), 'no NaN');

  let p = C.buildPantry(C.DEMO_RECEIPT);
  p = C.markUsed(p, p[0].id);
  p = C.markTossed(p, p[1].id);
  const s = C.summary(p);
  assert.strictEqual(s.used, 1);
  assert.strictEqual(s.tossed, 1);
  assert.strictEqual(s.remaining, 6);
  assert.ok(s.rescuedRM > 0);
  assert.ok(s.wastedRM > 0);
  assert.ok(Number.isFinite(s.rescueRate));
  assert.ok(s.rescueRate > 0 && s.rescueRate < 1);
});

test('empty pantry recovers with zero state and no throw', () => {
  const p = C.buildPantry([]);
  assert.deepStrictEqual(C.useFirstList(p), []);
  const s = C.summary(p);
  assert.deepStrictEqual({ t: s.total, u: s.used, to: s.tossed, r: s.rescuedRM, w: s.wastedRM },
    { t: 0, u: 0, to: 0, r: 0, w: 0 });
});

// ---- hostile receipt files ----
test('zero-byte file -> empty', () => {
  const f = path.join(FIX, 'zero-byte.jpg');
  const size = fs.statSync(f).size;
  assert.strictEqual(size, 0);
  const r = C.validateReceiptFile({ name: 'zero-byte.jpg', size: 0, firstBytes: new Uint8Array(0) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'empty');
});

test('oversize file -> too_big', () => {
  const f = path.join(FIX, 'huge.jpg');
  const size = fs.statSync(f).size;
  assert.ok(size > C.MAX_BYTES, 'huge fixture exceeds cap');
  const r = C.validateReceiptFile({ name: 'huge.jpg', size, firstBytes: firstBytes(f, 32) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'too_big');
});

test('.heic extension -> heic', () => {
  const r = C.validateReceiptFile({ name: 'photo.HEIC', size: 1000, firstBytes: new Uint8Array([1, 2, 3]) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'heic');
});

test('HEIC magic bytes -> heic', () => {
  const f = path.join(FIX, 'fake.heic');
  const r = C.validateReceiptFile({ name: 'fake.heic', size: fs.statSync(f).size, firstBytes: firstBytes(f, 32) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'heic');
  assert.strictEqual(C.sniffImage(firstBytes(f, 32)), 'heic');
});

test('non-image text -> not_image', () => {
  const f = path.join(FIX, 'notimage.txt');
  const r = C.validateReceiptFile({ name: 'notimage.txt', size: fs.statSync(f).size, firstBytes: firstBytes(f, 32) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'not_image');
});

test('corrupt (png signature + garbage) sniffs png -> passes meta, decode handles it', () => {
  const f = path.join(FIX, 'corrupt.jpg');
  const r = C.validateReceiptFile({ name: 'corrupt.jpg', size: fs.statSync(f).size, firstBytes: firstBytes(f, 32) });
  assert.strictEqual(C.sniffImage(firstBytes(f, 32)), 'png');
  // meta passes (decode is the browser's job); corrupt surfaces as 'corrupt' there.
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kind, 'png');
});

test('valid PNG/JPEG pass meta validation', () => {
  const f = path.join(FIX, 'sample-receipt.png');
  const r = C.validateReceiptFile({ name: 'sample-receipt.png', size: fs.statSync(f).size, firstBytes: firstBytes(f, 32) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kind, 'png');

  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
  const rj = C.validateReceiptFile({ name: 'x.jpg', size: 8, firstBytes: jpeg });
  assert.strictEqual(rj.ok, true);
  assert.strictEqual(rj.kind, 'jpeg');
});

test('validateReceiptFile never throws on garbage', () => {
  const junk = new Uint8Array([0, 1, 2, 3, 4, 5]);
  const r = C.validateReceiptFile({ name: 'x', size: 6, firstBytes: junk });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason && r.reason.length > 0);
});

// ---- storage location changes shelf life ----

test('storage table: fridge is the documented baseline', () => {
  assert.strictEqual(C.shelfDaysFor('dairy', 'fridge'), 7);
  assert.strictEqual(C.shelfDaysFor('dairy', 'pantry'), 1);
  assert.strictEqual(C.shelfDaysFor('dairy', 'freezer'), 60);
  assert.strictEqual(C.shelfDaysFor('poultry', 'freezer'), 180);
  // one-arg call still means fridge (backward compatible)
  assert.strictEqual(C.shelfDaysFor('poultry'), C.shelfDaysFor('poultry', 'fridge'));
});

test('unknown storage and category fall back instead of throwing', () => {
  assert.strictEqual(C.shelfDaysFor('dairy', 'basement'), C.shelfDaysFor('dairy', 'fridge'));
  assert.strictEqual(C.shelfDaysFor('banana-bread', 'freezer'), C.shelfDaysFor('other', 'freezer'));
  const p = C.buildPantry([{ name: 'X', category: 'dairy', storage: 'mars', price: 1 }]);
  assert.strictEqual(p[0].storage, 'fridge');
});

test('freezing extends life, pantry shortens it, fridge is unchanged', () => {
  const raw = [{ name: 'Ayam', category: 'poultry', price: 9.8, shelfDays: 2, purchasedDaysAgo: 1 }];
  const fridge = C.buildPantry(raw)[0];
  const frozen = C.buildPantry([{ ...raw[0], storage: 'freezer' }])[0];
  const cupboard = C.buildPantry([{ ...raw[0], storage: 'pantry' }])[0];

  assert.strictEqual(fridge.storage, 'fridge');
  assert.strictEqual(fridge.daysLeft, 1);            // unchanged from before
  assert.ok(frozen.daysLeft > fridge.daysLeft, 'freezer lasts longer');
  assert.ok(cupboard.daysLeft <= fridge.daysLeft, 'pantry lasts no longer than fridge');
  assert.strictEqual(frozen.status, 'fresh');
});

test('setStorage is immutable and recomputes expiry + status', () => {
  const p = C.buildPantry([{ name: 'Ayam', category: 'poultry', price: 9.8, shelfDays: 2, purchasedDaysAgo: 1 }]);
  const id = p[0].id;
  const moved = C.setStorage(p, id, 'freezer');

  assert.strictEqual(p[0].storage, 'fridge');        // original untouched
  assert.strictEqual(p[0].daysLeft, 1);
  assert.strictEqual(moved[0].storage, 'freezer');
  assert.ok(moved[0].daysLeft > 100, 'frozen chicken is not expiring tomorrow');
  assert.strictEqual(moved[0].expiryLabel.indexOf('days left') > -1, true);

  const back = C.setStorage(moved, id, 'fridge');
  assert.strictEqual(back[0].daysLeft, 1, 'round-trip returns the original number');
});

test('moving to freezer reorders the use-first list', () => {
  const p = C.buildPantry([
    { name: 'Ayam', category: 'poultry', price: 9.8, shelfDays: 2, purchasedDaysAgo: 1 },
    { name: 'Beras', category: 'dry', price: 28, shelfDays: 100, purchasedDaysAgo: 0 }
  ]);
  const before = C.useFirstList(p).map(x => x.name);
  assert.deepStrictEqual(before, ['Ayam', 'Beras']);

  const after = C.useFirstList(C.setStorage(p, p[0].id, 'freezer')).map(x => x.name);
  assert.deepStrictEqual(after, ['Beras', 'Ayam'], 'frozen item drops behind the rice');
});

