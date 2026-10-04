# Recorded market-data responses

Files here are replayed by `FixtureProvider` through **the production
normaliser** (`normaliseSerpResponse`), so what they test is the code that
actually runs, not a parallel test parser.

There are two kinds, and the difference matters.

## 1. Real captures

| File | Query | Results |
|---|---|---|
| `iphone-15-128gb.json` | `iPhone 15 128GB` | 40 |
| `samsung-galaxy-s24-256gb.json` | `Samsung Galaxy S24 256GB` | 40 (2 unreadable) |
| `poco-x6-pro-8gb-256gb.json` | `POCO X6 Pro 8GB 256GB` | 17 |

Genuine SerpApi Google Shopping responses for the Indian market, recorded
live. **These prices were really quoted by those stores at capture time** —
but they are a snapshot, not current data, and nothing should cite them as
today's market.

The `search_metadata` endpoint fields are `[redacted]`, exactly as the adapter
redacts them before writing to `raw_documents`: each embedded an access token
granting a reader the vendor's stored copy of that search, and a token in a
provenance record is a token in every backup. Result-level `source_icon` URLs
are left intact — their path carries the search id, not the token.

### What the real data showed

Worth reading before trusting any match rate:

- **The major marketplaces are often absent.** `iPhone 15 128GB` returned no
  Amazon.in, no Flipkart, no Croma — it returned myG, Cashify (14 of 40
  results), ubuy, desertcart.com.sa and similar. `POCO X6 Pro` did reach
  Amazon.in and Flipkart; `Galaxy S24` reached Reliance Digital and JioMart.
  Coverage varies sharply by query.
- **Many results are the wrong model.** The S24 query returned mostly S25
  Ultra and S26; the POCO query returned X7 Pro and X8 Pro; the iPhone query
  returned iPhone 16.
- **Refurbished and grey-market listings dominate some queries**, and foreign
  stores appear with converted prices (`alternative_price` in SAR).
- **No `old_price`, no `extensions`, no `snippet` anywhere**, so MRP and stock
  are simply unavailable from this source. They travel as null.

These captures found two matcher defects the engineered fixtures could not,
both of which needed a real catalogue neighbour to expose. See the
`real SerpApi captures` block in `tests/ingestion.test.ts`.

## 2. Synthetic fixtures

| File | Exercises |
|---|---|
| `synthetic-edge-cases.json` | `old_price`, every delivery-string form, an explicit out-of-stock marker, a refurbished unit, a discovered store, and a wrong-variant title |
| `synthetic-malformed-results.json` | results with no title, no price, no store |
| `synthetic-absent-product.json` | a product the catalogue does not carry |

**Hand-authored. No price in these is a real observed price.** They exist
because the real captures happen not to contain these cases — real responses
carried no list price, no stock marker and no malformed rows — and dropping
them would leave those paths untested. Engineered coverage and real-world
fidelity are different jobs; both are needed.

## Why fixtures at all

- **Tests** run offline, deterministically, and without spending quota. A
  suite that needs an API key is a suite nobody runs.
- **Development** on matching and persistence costs nothing.
- **Regression**: a response that once broke the parser is kept as a file, so
  it cannot break it silently again.

`MARKET_DATA_PROVIDER=fixture` is refused in production — replaying a
recording there would present old prices as the current market.

## Naming

`FixtureProvider.slug()` lowercases a query and hyphenates it:

    "POCO X6 Pro 8GB 256GB"  ->  poco-x6-pro-8gb-256gb.json

A missing file raises `ProviderError(..., "unavailable")` rather than
returning zero offers, because "no recording exists" is not the same claim as
"nobody sells this".
