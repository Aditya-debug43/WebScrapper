# Mulya server

The backend for the marketplace pricing intelligence platform.

**Phase 2** built the database. **Phase 3** added authentication and the API
foundation. Analysis, competitor and pricing-recommendation services still live
in the frontend and move server-side in a later phase.

Architecture and the reasoning behind the stack:
[`../docs/BACKEND_ARCHITECTURE.md`](../docs/BACKEND_ARCHITECTURE.md).

---

## Quick start

```bash
cd server
cp .env.example .env
# set AUTH_SECRET — the file tells you how to generate one
npm install

npm run db:migrate -- --reset             # create the schema
cd .. && node scripts/export-dataset.mjs  # materialise the legacy dataset
cd server && npm run db:seed              # load 389,534 rows
npm run db:verify                         # 37 integrity checks
npm test                                  # 54 tests
npm run dev                               # http://localhost:4000
```

The default driver is **PGlite** — PostgreSQL 17 compiled to WebAssembly,
in-process, nothing to install. It is the same engine and the same SQL as a
real server, so the migrations you run here are the migrations that run in
production. `NODE_ENV=production` refuses to start with it.

---

## Authentication

### The model

Two different things that are never merged:

| | |
|---|---|
| **`users`** | a person signing in to this product |
| **`sellers`** | a merchant observed on Amazon, Flipkart, Meesho, Myntra, AJIO or Nykaa |

They share no key and no table. `users` is deliberately minimal: email is the
identity, **there is no password column at all**, and there are no roles,
organisations or permissions — none of those exist as product concepts yet, and
a column encoding an unmade decision is worse than no column.

Email uniqueness is enforced by a **functional unique index on `lower(email)`**,
not by the application remembering to normalise. `Ada@x.com` and `ada@x.com`
are one account at the database level.

### The flow

```
email ──▶ POST /auth/request-otp ──▶ challenge stored (hash only) ──▶ email sent
                                                                        │
      ┌─────────────────────────────────────────────────────────────────┘
      ▼
POST /auth/verify-otp ──▶ code checked ──▶ challenge consumed ──▶ user created
                                                                  if first time
                                                                        │
                                                                        ▼
                                                        session token returned
```

The response to `request-otp` is **identical whether or not the account
exists**. Saying "no such user" would make the endpoint a membership oracle,
and there is no product reason to reveal it — the next step works the same
either way.

### How codes are protected

| Control | Setting | Why |
|---|---|---|
| Generation | `crypto.randomInt` | a predictable code is not a second factor |
| Storage | HMAC-SHA256 under `AUTH_SECRET` | six digits is a million possibilities; a bare digest falls to a lookup table the moment the database leaks. The pepper is not in the database |
| Comparison | `timingSafeEqual` | a wrong code cannot be narrowed by timing |
| Expiry | `OTP_TTL_SECONDS` (600) | |
| Single use | `consumed_at`, set by a conditional `UPDATE … WHERE consumed_at IS NULL` | two simultaneous verifications both validate, but only one `UPDATE` matches a row |
| Attempts | `OTP_MAX_ATTEMPTS` (5), counted **before** comparison | a wrong guess always costs something |
| Resend | `OTP_RESEND_COOLDOWN_SECONDS` (60) | |
| Per address | `OTP_MAX_PER_EMAIL_PER_HOUR` (5) | |
| Per caller | `AUTH_RATE_LIMIT_MAX` per IP | one attacker with many addresses and many attackers with one address are different problems and need separate bounds |

Verification targets only the **newest live** challenge, so an older
outstanding code cannot be used after a resend, and a successful verification
consumes every other outstanding code for that address.

### Sessions — why opaque tokens, not JWT

Opaque 256-bit random strings, stored only as an HMAC, sent as
`Authorization: Bearer <token>`.

The decisive reason is **logout**. Revoking a stateless JWT needs a denylist,
which is a session table with extra steps and worse failure modes. A secondary
reason: an opaque token carries no claims, so nothing sensitive can leak from
it by construction — a requirement that is satisfied here by having nothing to
leak rather than by remembering what not to put in.

A bearer header rather than a cookie because the frontend (Vercel) and the API
(Railway) are different registrable domains, where third-party cookie blocking
would make a `SameSite=None` session unreliable in several browsers.

There is deliberately **no refresh-token rotation**. A 30-day opaque session
that can be revoked server-side is the right amount of machinery for this
product today.

---

## API

Base path `/api/v1`. Every response is JSON. Every error is the same shape:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [ … ] } }
```

`code` is what clients branch on and never changes wording; `message` is for
humans. Nothing else is ever in an error body — no stack, no SQL, no internal
identifiers.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/health` | – | liveness only; discloses nothing about the infrastructure |
| `POST` | `/api/v1/auth/request-otp` | – | 202; neutral message; rate limited |
| `POST` | `/api/v1/auth/verify-otp` | – | 200 with `{ token, expiresAt, isNewUser, user }` |
| `POST` | `/api/v1/auth/logout` | bearer | 204; idempotent |
| `GET` | `/api/v1/auth/me` | bearer | 200 with `{ user }` |
| `GET` | `/api/v1/products` | – | page, pageSize, search, category, productType, brand, marketplace, sort |
| `GET` | `/api/v1/products/:id` | – | identity + specs + variant siblings |
| `GET` | `/api/v1/categories` | – | `?parent=root` for departments, `?level=n` |
| `GET` | `/api/v1/categories/:id` | – | + ancestors, children, product types |
| `GET` | `/api/v1/brands` | – | paginated, searchable |
| `GET` | `/api/v1/marketplaces` | – | all six |

Product **detail deliberately omits** prices, offers, reviews and competitors.
Those are separate resources with their own pagination and their own cost;
folding them in is how a detail endpoint becomes the slowest call in a system.

### Validation

Fastify JSON schema, enforced before a handler runs. Unknown query parameters
and unknown body fields are **rejected**, not ignored — Fastify's AJV defaults
to `removeAdditional: true`, which silently strips them, so that default is
turned off. A typo in a filter name is a client bug and should fail loudly.

A well-formed filter id that does not exist (`?category=cat_nope`) is a **400
with field detail**, not an empty page, for the same reason.

---

## Architecture

```
route (schema validation)
  → controller/handler
    → service          rules, shaping, what a client may see
      → repository     all SQL; nothing above this writes a WHERE clause
        → Drizzle
          → PostgreSQL
```

```
src/
  app.ts               composition root — everything is wired here and nowhere else
  server.ts            listen and shut down; no wiring
  config/env.ts        parsed and validated once; nothing reads process.env directly
  lib/                 errors, email normalisation, OTP, tokens, pagination
  email/               the port + memory / console / http adapters
  plugins/             error handling, auth decorator
  modules/
    auth/              repository · service · routes
    catalogue/         repository · service · routes
  db/                  schema, client
  scripts/             migrate, seed, verify
```

`buildApp()` being the only place that wires anything is what lets a test
construct a complete application against an in-memory database and a capturing
email adapter, with no globals to reset and no network to stub.

---

## Email

The auth service depends on an **`EmailAdapter` port**, never on a provider
SDK. Swapping providers is a new adapter and one environment variable.

| Adapter | Use | Behaviour |
|---|---|---|
| `memory` | tests | captures messages in an array for assertion |
| `console` | development | logs that a message was sent, to a **masked** address. The body — which contains the code — is printed only when `EXPOSE_OTP_IN_RESPONSE` is on |
| `http` | production | posts to any transactional-email API; endpoint and key from the environment |

No credential appears in source. `EMAIL_API_KEY` and `EMAIL_API_URL` are read
from the environment and a test asserts that the adapters contain no literal
key.

---

## CORS and logging

CORS origins come from `CORS_ORIGINS` (comma separated). Production refuses a
wildcard and refuses plain `http` for anything that is not localhost —
credentialed cross-origin requests cannot use `*`.

Logging is structured (pino) with `authorization`, `cookie`, `body.code` and
`body.otp` redacted at the logger. Addresses are **masked** before they are
logged. A one-time code is never written to a log, because a log sink outlives
the ten-minute window the code itself is bounded by.

---

## Tests

```bash
npm test              # 54 tests
npx tsx --test tests/auth.test.ts      # one file
```

Node's built-in test runner via `tsx` — no additional framework. HTTP is
exercised with `app.inject()`, so nothing binds a port.

| File | Covers | Tests |
|---|---|---|
| `tests/auth.test.ts` | AUTH-01…AUTH-20 | 18 |
| `tests/email-and-api.test.ts` | EMAIL-01…04, API-01…05 | 11 |
| `tests/catalogue.test.ts` | PROD-01…12, CAT, BRAND, MARKET | 17 |
| `tests/regression.test.ts` | REG-11, REG-12, Phase 2 baseline | 8 |

### Isolation

Every run gets **its own PostgreSQL**: `new PGlite()` with no path is a real
engine held entirely in memory. Tests cannot reach the development database,
which is what makes the destructive authentication tests safe. Each test uses
its own email address and its own source IP, so the suite does not depend on
execution order.

`tests/regression.test.ts` is the exception — it reads the **real** development
database, because "did Phase 3 disturb Phase 2's data?" cannot be answered
against a fixture. It only ever reads, and skips with instructions when the
database has not been seeded.

### What the tests assert

Behaviour and state, not status codes. `request-otp` is checked to create
exactly one challenge row, store a digest rather than the code, invoke the
email port with the right recipient, and keep the code out of the response.
Pagination is checked to return *different records* on page two, not merely a
200.

---

## Deploying to Railway

```
Vercel (frontend)  →  Fastify on Railway  →  PostgreSQL on Railway
```

`railway.json` sets the build, the start command and `/health` as the
healthcheck. Set the service **root directory to `server`**.

Required variables:

```
NODE_ENV=production
DB_DRIVER=postgres
DATABASE_URL=<Railway Postgres connection string>
AUTH_SECRET=<48 random bytes, base64url>
CORS_ORIGINS=https://your-frontend.vercel.app
EMAIL_ADAPTER=http
EMAIL_API_URL=<provider endpoint>
EMAIL_API_KEY=<provider key>
EMAIL_FROM=Mulya <no-reply@yourdomain>
```

Production **refuses to start** if `DB_DRIVER` is not `postgres`, if
`EXPOSE_OTP_IN_RESPONSE` is on, if `EMAIL_ADAPTER` is not `http`, or if
`CORS_ORIGINS` contains a wildcard or a non-localhost `http` origin. These are
startup failures rather than warnings, because a warning in a deploy log is a
warning nobody reads.

Migrations do not run automatically on boot — several replicas starting at once
would race. Run them as a one-off:

```bash
npm run db:migrate:prod     # node dist/scripts/migrate.js, no tsx needed
```

`trustProxy` is on, so `request.ip` is the caller rather than Railway's load
balancer; without it every per-IP limit would be shared by the entire internet.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | watch-mode server |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | run the built server |
| `npm test` | the full suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | regenerate `drizzle/*.sql` from the schema |
| `npm run db:migrate` | apply outstanding migrations (`-- --reset` to drop first) |
| `npm run db:migrate:prod` | same, from `dist/`, without devDependencies |
| `npm run db:seed` | truncate the seeded tables and load from `seed-data/` |
| `npm run db:verify` | 37 integrity checks; non-zero exit on failure |

---

## Defects found by writing this phase

Recorded because each one was invisible until something asserted against it.

**Correlated subqueries silently returned zero.** Interpolating a Drizzle
column inside a raw `sql` subquery renders it **unqualified**, so
`where l.marketplace_id = ${marketplaces.id}` became
`where l.marketplace_id = "id"` — which the inner scope resolves to
`listings.id`. Every `productCount` and `listingCount` in the catalogue was 0.
It passed a shape check (`typeof === "number"`) and only failed once a test
asserted AJIO had listings.

**Pattern injection in search.** Binding a parameter stops SQL injection but
not LIKE-pattern injection: a search for `%` returned the entire catalogue.
Metacharacters are now escaped so user input matches literally.

**Collation-dependent ordering.** `ORDER BY canonical_name` sorted "AGARO"
before "Accu-Chek" under PGlite's collation — and a managed Postgres need not
agree, so dev and production could have ordered differently. Sorting on
`lower(...)` makes it deterministic and matches what a reader expects.

**Fastify strips unknown fields by default.** `additionalProperties: false`
had no effect because AJV's `removeAdditional` was on, so a request carrying a
misspelled field was accepted as if correct.

**A custom rate-limit `errorResponseBuilder` broke the error shape**, turning
every 429 into a 500. The central error handler now renders it, so there is one
place that formats errors rather than two.
