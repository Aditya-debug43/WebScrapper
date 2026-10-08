# Recorded product responses

One file per **catalogue id**, named `<externalProductId>.json`, holding the
provider's product response verbatim.

Named after the catalogue id rather than a query because that is what the
product endpoint is asked for. The sibling directory holds *search* fixtures,
which are named after the query — the two endpoints answer different
questions and are keyed by different things.

These exist so the competitive-capture path can be exercised offline. It
matters more here than for search: a capture spends one call **per catalogue
id**, four or five per product, so a suite that reached the network would be
the most expensive thing in the repository — and the fan-out is exactly the
part that needs testing.

Add one by capturing a real response and saving it under its id. The parser
that reads it is the production parser (`serpapi.market.ts`), so a fixture
that once broke it cannot break it silently again.
