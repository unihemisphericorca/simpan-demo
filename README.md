# Simpan — receipt to pantry

Offline-first demo: photograph a receipt, get a pantry sorted by what expires first, with
shelf life that changes depending on whether food is in the pantry, the fridge or the freezer.

- **Live demo:** https://unihemisphericorca.github.io/simpan-demo/
- **No framework, no build step, no network calls.**

## Run the tests

```bash
node --test tests/regression.test.js    # 19 tests
node tools/bench.js                     # hostile-file + shelf-life benchmark
```

## Files

| File | What it holds |
|---|---|
| `core.js` | All logic: shelf-life table, ordering, ledger, receipt validation |
| `index.html` | The UI |
| `style.css` | Styling |
| `tests/regression.test.js` | 19 tests, including the storage-location behaviour |
| `tools/bench.js` | Benchmark over malformed receipt files |
| `fixtures/` | Deliberately broken receipt files used by the tests |
