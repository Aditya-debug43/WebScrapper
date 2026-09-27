# Mulya server

The backend for the marketplace pricing intelligence platform.

**Phase 2** built the database. **Phase 3** added authentication and the API
foundation. A follow-up change replaced the credential with **email +
password**, leaving one-time codes to verify an address and authorise a
reset. Analysis, competitor and pricing-recommendation services still live in
the frontend and move server-side in a later phase.

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

They share no key and no table. Merging them would turn "which of my
competitors is also a customer" into a schema question instead of a product
one.

**The credential is email + password.** A one-time code is never a way to log
in; it does exactly two jobs, and the database enforces the difference:

| `otp_challenges.purpose` | what it authorises |
|---|---|
| `email_verification` | proving the address at signup |
| `password_reset` | replacing a forgotten password |

A `CHECK` constraint admits those two values and nothing else — `login` was
removed in `0003_password_auth.sql`. The code hash is additionally salted by
purpose, so even if the two ever met, the digest would not match.

Email uniqueness is enforced by a **functional unique index on `lower(email)`**,
not by the application remembering to normalise. `Ada@x.com` and `ada@x.com`
are one account at the database level.

### Passwords

`argon2id` via the `argon2` package, at the library defaults — 64 MiB, 3
iterations, 4 lanes — which sit on OWASP's recommendation for new
applications. They are restated explicitly in `lib/password.ts` so that
raising the cost is a visible diff rather than an inherited surprise.

Nothing is hand-rolled: the library owns the salt, the encoding and the
verification, and the digest string carries its own parameters, so the cost
can be raised later without invalidating existing hashes.

The policy is deliberately short — length 8–128, no leading or trailing
space, and a small common-password denylist:

- **No character-class rules.** They reliably produce `Password1!`. Length is
  the requirement that actually correlates with strength.
- **No confirm-password field.** It is a second chance to make the same typo,
  and it is why people pick passwords they can type twice rather than ones
  they can remember. The reveal toggle does the same job honestly.
- The 128 ceiling is **not** a strength rule. It stops a multi-megabyte
  request body becoming a memory-hard hashing job.

`password_hash` is nullable for one reason only: accounts predating password
authentication have none. `login` refuses a null digest outright and sends
those users through reset. It is **never** returned by any endpoint, and
`/auth/me` is asserted against that in the test suite.

### The flows

```
REGISTER          POST /auth/register        → 201, account created UNVERIFIED,
                                                no session, verification code sent
                  POST /auth/verify-email    → 200 { token, expiresAt, user }

SIGN IN           POST /auth/login           → 200 { token, expiresAt, user }

RESET             POST /auth/forgot-password → 202, always the same answer
                  POST /auth/verify-reset-otp→ 200 { resetToken, expiresAt }
                  POST /auth/reset-password  → 200, every session revoked
```

Registering **does not sign anybody in**: the account exists with
`email_verified_at` null and is inert until the address is proven. Verifying
does sign the user in, because reaching that point required the password
*and* control of the mailbox, which is strictly more than a login
establishes.

Re-registering an address that exists but was **never verified** replaces the
password and resends a code. It is a corrected signup, not an error, and it
does not create a second row. A *verified* address is a hard 409.

### Not telling an attacker who has an account

Two places would otherwise become membership oracles, and both are closed:

| Endpoint | What it does |
|---|---|
| `POST /auth/login` | An unknown address and a wrong password return the **same code and the same message** (`INVALID_CREDENTIALS`, 401). The unknown path still pays for a decoy Argon2id verification, because otherwise the response *time* enumerates accounts however careful the wording is. |
| `POST /auth/forgot-password` | Always 202, always the same sentence. No work is done at all when there is no account. |

`EMAIL_NOT_VERIFIED` is checked **after** the password, deliberately.
Announcing it to anyone who types an address would leak which addresses have
accounts; announcing it to someone who has already proved they know the
password leaks nothing they did not know, and they are the only person who
can act on it.

`POST /auth/resend-verification` answers identically whether the account is
missing, already verified, or genuinely waiting.

### Reset: two calls, one code

`verify-reset-otp` issues a short-lived token and **does not consume the
challenge**; `reset-password` consumes it. That keeps "one code, one password
change" true across a two-step flow, makes the token single-use and revocable
for free, and lets an abandoned reset expire on its own. The token is stored
hashed on the challenge row — a stateless signed token would need its own
invalidation story.

A completed reset **revokes every session on the account**. A reset is a
recovery action: the person performing it may not be the person signed in,
and if the account was compromised, the attacker's session is exactly what
must not survive.

### How codes are protected

| Control | Setting | Why |
|---|---|---|
| Generation | `crypto.randomInt` | a predictable code is not a second factor |
| Storage | HMAC-SHA256 under `AUTH_SECRET`, salted with `purpose:email` | six digits is a million possibilities; a bare digest falls to a lookup table the moment the database leaks. The pepper is not in the database, and the salt stops a hash being replayed for the other purpose |
| Comparison | `timingSafeEqual` | a wrong code cannot be narrowed by timing |
| Expiry | `OTP_TTL_SECONDS` (600) | |
| Single use | `consumed_at`, set by a conditional `UPDATE … WHERE consumed_at IS NULL` | two simultaneous verifications both validate, but only one `UPDATE` matches a row |
| Attempts | `OTP_MAX_ATTEMPTS` (5), counted **before** comparison | a wrong guess always costs something |
| Resend | `OTP_RESEND_COOLDOWN_SECONDS` (60) | |
| Per address | `OTP_MAX_PER_EMAIL_PER_HOUR` (5) | |
| Per caller | `AUTH_RATE_LIMIT_MAX` per IP | one attacker with many addresses and many attackers with one address are different problems and need separate bounds |
| Reset token | `RESET_TOKEN_TTL_SECONDS` (900), stored hashed | only has to cover "type a new password" |

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
| `POST` | `/api/v1/auth/register` | – | 201; creates an UNVERIFIED account and sends a code; no session |
| `POST` | `/api/v1/auth/resend-verification` | – | 202; neutral whether the account exists or is already verified |
| `POST` | `/api/v1/auth/verify-email` | – | 200 with `{ token, expiresAt, user }` — verifies and signs in |
| `POST` | `/api/v1/auth/login` | – | 200 with `{ token, expiresAt, user }`; 401 `INVALID_CREDENTIALS`; 403 `EMAIL_NOT_VERIFIED` |
| `POST` | `/api/v1/auth/forgot-password` | – | 202; always the same answer |
| `POST` | `/api/v1/auth/verify-reset-otp` | – | 200 with `{ resetToken, expiresAt }`; does not consume the code |
| `POST` | `/api/v1/auth/reset-password` | – | 200 with `{ sessionsRevoked }`; spends the code, revokes every session |
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
  lib/                 errors, email normalisation, OTP, passwords, tokens, pagination
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
SDK. It cannot tell where a message went, which is why adding SMTP changed no
authentication code — the only auth-side change was the failure path, because
delivery could not fail before.

```
AuthService ──▶ EmailAdapter ──┬── memory   tests
                               ├── console  development, no mailbox
                               ├── http     a transactional-email API
                               └── smtp     a real mail server (Gmail)
```

| Adapter | Use | Behaviour |
|---|---|---|
| `memory` | tests | captures messages in an array for assertion |
| `console` | development | logs that a message was sent, to a **masked** address. The body — which contains the code — is printed only when `EXPOSE_OTP_IN_RESPONSE` is on |
| `http` | production | posts to any transactional-email API; endpoint and key from the environment |
| `smtp` | local development, or production | Nodemailer over TLS. Verifies its connection at startup and sends real mail |

`memory` and `console` deliver nothing, so production refuses both. `http` and
`smtp` both deliver, and choosing between them is operational.

No credential appears in source. Every provider setting is read from the
environment, and tests assert that the adapters contain no literal key and
that `SMTP_PASS` is referenced exactly once — in the transport's auth block.

### Gmail SMTP for local development

Set this up once and real verification and reset codes arrive in your own
inbox, which is the only way to see the whole flow work.

**1 — Use a Gmail account you are willing to send application mail from.**
A separate account is better if you have one: an App Password grants SMTP
send on whichever account issues it.

**2 — Turn on 2-Step Verification.**
Google Account → Security → 2-Step Verification. App passwords do not exist
without it.

**3 — Create an App Password.**
Google Account → Security → 2-Step Verification → App passwords. Name it
something like `Mulya local`. Google shows a 16-character value once.

> **`SMTP_PASS` must contain a Google App Password, not your normal Gmail
> account password.** Gmail refuses the account password over SMTP anyway,
> and putting it in a file would expose the entire Google account instead of
> one credential you can revoke on its own.

**4 — Put it in `server/.env`** — never in `.env.example`, and never in a
commit:

```
EMAIL_ADAPTER=smtp
EMAIL_FROM=your-address@gmail.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-address@gmail.com
SMTP_PASS=your-16-character-app-password

EXPOSE_OTP_IN_RESPONSE=false
```

**5 — Check it before relying on it.**

```bash
npm run email:check -- you@gmail.com
```

This verifies the transport and sends one real message with a placeholder
code, printing the adapter, host, masked account and delivery time. It prints
no credential. If the message does not arrive, look in spam — a brand-new
sending account is often filtered on its first message.

**6 — Start the server.** `npm run dev`. If the credential is wrong it says so
immediately, rather than at somebody's signup.

### What is enforced, and why

| Rule | Reason |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` are each required, **by name** | "SMTP configuration is incomplete" sends you reading your own `.env` line by line |
| `EMAIL_FROM` must equal `SMTP_USER` | Gmail will not send as an address the authenticated account does not own. It rewrites the header silently, so the mail arrives looking wrong and nothing reports an error |
| `EXPOSE_OTP_IN_RESPONSE` must be `false` | Returning the code as well as mailing it would hide a broken send completely |
| The transport is **verified at startup** | A handshake and an AUTH exchange, sending nothing, costing a few hundred milliseconds. A wrong App Password becomes a refusal to start, not a stranded user |
| A failed send **deletes its own challenge** | The resend cooldown is measured from the newest challenge. Without this, a failed delivery answers the user's retry with "please wait 47 seconds" for an email that never left |

Port `465` with `SMTP_SECURE=true` is implicit TLS and is the simplest thing
that works. Port `587` with `SMTP_SECURE=false` upgrades through STARTTLS and
is the fallback when 465 is blocked. Both encrypt before authenticating.

**Startup verification is not part of `/health`.** That endpoint is
unauthenticated and deliberately discloses nothing about the infrastructure;
adding an SMTP probe would both advertise the transport and make liveness
depend on a third party. Configuration is proven once, at boot, where a
failure can still stop the rollout.

### One honest trade-off

`forgot-password` normally answers `202` whether or not the account exists. If
SMTP is down it answers `502` — but only for addresses that *do* have an
account, since no send is attempted for the others. During a mail outage that
is a narrow membership oracle.

It is deliberate. The alternative is swallowing delivery failures and telling
every user a code is on its way when none is, which is a worse failure and one
nobody would notice. The window is the length of the outage, and the fix for
it is fixing the outage.

### Message content

Plain text and HTML, no links and no images. A code typed by hand cannot be
consumed by a corporate link scanner and gives a phishing lookalike nothing to
imitate. The HTML is a single-column table with inline styles and system
fonts, because Gmail strips `<style>` blocks and web fonts.

Nothing internal appears in either part — no user id, no session, no request
id. An email is the least trustworthy place a system's internals can end up.

| Purpose | Subject |
|---|---|
| `email_verification` | Verify your Mulya account |
| `password_reset` | Reset your Mulya password |

---

## CORS and logging

CORS origins come from `CORS_ORIGINS` (comma separated). Production refuses a
wildcard and refuses plain `http` for anything that is not localhost —
credentialed cross-origin requests cannot use `*`.

Logging is structured (pino) with `authorization`, `cookie`, `body.code`,
`body.otp`, `body.password`, `body.newPassword`, `body.currentPassword`,
`body.passwordHash` and `body.resetToken` redacted at the logger. Addresses are **masked** before they are
logged. A one-time code is never written to a log, because a log sink outlives
the ten-minute window the code itself is bounded by.

---

## Tests

```bash
npm test              # 109 tests
npx tsx --test tests/auth.test.ts      # one file
```

Node's built-in test runner via `tsx` — no additional framework. HTTP is
exercised with `app.inject()`, so nothing binds a port.

| File | Covers | Tests |
|---|---|---|
| `tests/auth.test.ts` | AUTH-REG, AUTH-VER, AUTH-LOGIN, AUTH-RESET, AUTH-SEC | 34 |
| `tests/email-and-api.test.ts` | EMAIL-01…04, API-01…05 | 11 |
| `tests/catalogue.test.ts` | PROD-01…12, CAT, BRAND, MARKET | 17 |
| `tests/regression.test.ts` | REG-11, REG-12, Phase 2 baseline | 9 |
| `tests/smtp.test.ts` | SMTP-01…SMTP-12 (stubbed transport) | 32 |
| `tests/smtp-socket.test.ts` | SMTP-13 — a real SMTP conversation | 6 |

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

Behaviour and state, not status codes.

Registration is checked to create exactly one challenge row, store a digest
rather than the code, invoke the email port with the right recipient, and
write a credential matching `/^$argon2id$/` that does not contain the
password. A reset is checked to produce a *different* digest from the one
before it, to make the old password stop working and the new one start, and
to leave the pre-reset session token rejected by `/auth/me`. A wrong password
and an unknown address are compared with `deepEqual`, so a difference in
wording would fail. Pagination is checked to return *different records* on
page two, not merely a 200.

Two checks are about the source rather than a response: that the logger's
redact list names the credential fields, and that no module under `src/`
(outside the email adapters, which *are* the delivery channel) hands a
credential to the logger. Both were mutation-tested — a deliberately planted
`request.log.info({ userId, password })` made them fail before it was
reverted.

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
| `npm run email:check -- you@example.com` | verify the transport and send one real test message |

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
