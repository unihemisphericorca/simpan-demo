// Benchmark: hostile receipt-file handling + shelf-life engine.
// Produces the real numbers used in the case study. No network, no mocks.
const fs = require('fs');
const path = require('path');
const Core = require('../core.js');

const FIX = path.join(__dirname, '..', 'fixtures');
const files = fs.readdirSync(FIX).sort();

const results = [];
for (const f of files) {
  const full = path.join(FIX, f);
  const st = fs.statSync(full);
  let bytes = null;
  try { bytes = fs.readFileSync(full); } catch (e) { bytes = null; }

  const t0 = process.hrtime.bigint();
  let out;
  try {
    out = Core.validateReceiptFile({
      name: f,
      size: st.size,
      firstBytes: bytes ? bytes.subarray(0, 64) : null
    });
  } catch (e) {
    out = { ok: false, code: 'THREW', reason: String(e && e.message) };
  }
  const t1 = process.hrtime.bigint();
  results.push({
    file: f,
    size: st.size,
    ms: Number(t1 - t0) / 1e6,
    ok: out.ok,
    code: out.code,
    reason: out.reason ? out.reason.slice(0, 70) : null
  });
}

const rejected = results.filter(r => !r.ok);
const threw = results.filter(r => r.code === 'THREW');
const ms = results.map(r => r.ms).sort((a, b) => a - b);
const median = ms[Math.floor(ms.length / 2)];

// Shelf-life engine over the bundled demo receipt
const pantry = Core.buildPantry(Core.DEMO_RECEIPT);
const useFirst = Core.useFirstList(pantry);
const sum = Core.summary(pantry);

const bench = {
  fixtures_total: results.length,
  rejected_with_reason: rejected.length,
  threw: threw.length,
  median_ms: Number(median.toFixed(3)),
  max_ms: Number(Math.max(...ms).toFixed(3)),
  demo_items: pantry.length,
  use_first_items: useFirst.length,
  at_risk_rm: sum.atRiskValue,
  pantry: pantry.map(p => ({
    name: p.name,
    category: p.category,
    days_left: Core.daysLeftOf(p),
    status: Core.statusOf(Core.daysLeftOf(p))
  })),
  results
};

console.log(JSON.stringify(bench, null, 2));
