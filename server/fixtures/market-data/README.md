# Recorded market-data responses

Files here are replayed by `FixtureProvider` through **the production
normaliser** (`normaliseSerpResponse`), so what they test is the code that
actually runs, not a parallel test parser.

## These are hand-authored, not captures

Every file in this directory was written by hand to exercise specific parser
behaviour. **None of them is a real SerpApi response, and no price in them is
a real observed price.** They are named and shaped like real responses because
the parser must treat them identically — not because the numbers mean anything.

A real capture, when one is recorded, should replace these and say so in this
file. Do not cite a number from this directory as market evidence.

## Why fixtures at all

- **Tests** run offline, deterministically, and without spending quota. A
  suite that needs an API key is a suite nobody runs.
- **Development** on matching and persistence costs nothing.
- **Regression**: a response that once broke the parser becomes a permanent
  file, so it cannot break it silently again.

`MARKET_DATA_PROVIDER=fixture` is refused in production — replaying a
recording there would present old prices as the current market.

## Naming

`FixtureProvider.slug()` lowercases a query and hyphenates it:

    "POCO X6 Pro 8GB 256GB"  ->  poco-x6-pro-8gb-256gb.json

A missing file raises `ProviderError(..., "unavailable")` rather than
returning zero offers, because "no recording exists" is not the same claim as
"nobody sells this".

## What each file covers

| File | Exercises |
|---|---|
| `iphone-15-128gb.json` | the happy path, plus a wrong-variant title (256GB) that the matcher must refuse, a discovered store, a refurbished unit, and every delivery-string form |
| `poco-x6-pro-8gb-256gb.json` | a product absent from the catalogue — every offer must end in `rejected_records`, none may be guessed into a neighbouring product |
| `samsung-galaxy-s24-256gb.json` | likewise absent, plus malformed results: no title, no price, no store |
