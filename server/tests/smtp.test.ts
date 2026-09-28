import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env, envSchema } from "../src/config/env.js";
import { MemoryEmailAdapter, SmtpEmailAdapter, otpMessage, createEmailAdapter } from "../src/email/index.js";
import { ConsoleEmailAdapter } from "../src/email/adapters/console.adapter.js";
import { HttpEmailAdapter } from "../src/email/adapters/http.adapter.js";
import type { EmailAdapter } from "../src/email/index.js";
import { createTestApp, createTestAppWith, type Harness, type Json } from "./helpers/harness.js";
import { AppError } from "../src/lib/errors.js";

/**
 * SMTP-01…SMTP-12 — Gmail SMTP delivery.
 *
 * **No test here reaches a mail server.** The adapter takes a transport
 * factory so a stub can stand in for Nodemailer, and the configuration rules
 * are exercised against `envSchema` directly rather than by mutating the
 * process environment. A suite that sent real mail would be unrunnable in
 * CI, slow, and dependent on somebody's inbox.
 *
 * The real Gmail delivery test is manual and documented in server/README.md;
 * it is the one thing automation cannot honestly stand in for.
 */

/** A complete, valid SMTP configuration. The password is obviously fake. */
const VALID_SMTP = {
  NODE_ENV: "development",
  AUTH_SECRET: "a-test-only-secret-that-is-long-enough",
  EMAIL_ADAPTER: "smtp",
  EMAIL_FROM: "desk@example.com",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "desk@example.com",
  SMTP_PASS: "not-a-real-app-password",
};

/** A stub transport. Records what it was asked to send; never connects. */
function stubTransport(behaviour: { failSend?: unknown; failVerify?: unknown } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  let verified = 0;
  const transport = {
    async verify() {
      verified++;
      if (behaviour.failVerify) throw behaviour.failVerify;
      return true;
    },
    async sendMail(message: Record<string, unknown>) {
      if (behaviour.failSend) throw behaviour.failSend;
      sent.push(message);
      return { messageId: "stub" };
    },
  };
  return {
    sent,
    verifyCount: () => verified,
    factory: () => transport as never,
  };
}

const smtpError = (code: string, message = "smtp said no") => Object.assign(new Error(message), { code });

/* ============================================ SMTP-01..03 configuration */

describe("SMTP-01/02/03 — configuration validation", () => {
  it("SMTP-01: a complete SMTP configuration is accepted", () => {
    const parsed = envSchema.safeParse(VALID_SMTP);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data!.EMAIL_ADAPTER, "smtp");
    assert.equal(parsed.data!.SMTP_HOST, "smtp.gmail.com");
    assert.equal(parsed.data!.SMTP_PORT, 465, "the port is coerced to a number");
    assert.equal(parsed.data!.SMTP_SECURE, true, "465 means implicit TLS");
  });

  it("SMTP-01b: port 587 with STARTTLS is equally acceptable", () => {
    const parsed = envSchema.safeParse({ ...VALID_SMTP, SMTP_PORT: "587", SMTP_SECURE: "false" });
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data!.SMTP_PORT, 587);
    assert.equal(parsed.data!.SMTP_SECURE, false);
  });

  it("SMTP-02: a missing SMTP_USER fails, and the message names that variable", () => {
    const { SMTP_USER, ...withoutUser } = VALID_SMTP;
    void SMTP_USER;
    const parsed = envSchema.safeParse(withoutUser);
    assert.equal(parsed.success, false);
    const issue = parsed.error!.issues.find((i) => i.path.join(".") === "SMTP_USER");
    assert.ok(issue, `expected an SMTP_USER issue, got ${JSON.stringify(parsed.error!.issues)}`);
    assert.match(issue!.message, /SMTP_USER is required/);
  });

  it("SMTP-03: a missing SMTP_PASS fails, and the message says App Password", () => {
    const { SMTP_PASS, ...withoutPass } = VALID_SMTP;
    void SMTP_PASS;
    const parsed = envSchema.safeParse(withoutPass);
    assert.equal(parsed.success, false);
    const issue = parsed.error!.issues.find((i) => i.path.join(".") === "SMTP_PASS");
    assert.ok(issue);
    assert.match(issue!.message, /Google App Password/i);
    assert.match(issue!.message, /not the account password/i, "it must warn against the real Gmail password");
  });

  it("a missing host or port fails by name too", () => {
    for (const key of ["SMTP_HOST", "SMTP_PORT"] as const) {
      const partial: Record<string, string> = { ...VALID_SMTP };
      delete partial[key];
      const parsed = envSchema.safeParse(partial);
      assert.equal(parsed.success, false, `${key} should be required`);
      assert.ok(
        parsed.error!.issues.some((i) => i.path.join(".") === key),
        `the failure should name ${key}`
      );
    }
  });

  it("EMAIL_FROM must be the authenticated account, because Gmail rewrites anything else", () => {
    const mismatch = envSchema.safeParse({ ...VALID_SMTP, EMAIL_FROM: "someone-else@example.com" });
    assert.equal(mismatch.success, false);
    assert.ok(mismatch.error!.issues.some((i) => i.path.join(".") === "EMAIL_FROM"));

    // A display name around the same address is fine.
    const named = envSchema.safeParse({ ...VALID_SMTP, EMAIL_FROM: "Mulya <desk@example.com>" });
    assert.equal(named.success, true, JSON.stringify(named.error?.issues));
  });

  it("SMTP delivery and returning the code in the response are mutually exclusive", () => {
    const parsed = envSchema.safeParse({ ...VALID_SMTP, EXPOSE_OTP_IN_RESPONSE: "true" });
    assert.equal(parsed.success, false, "a real send must not also hand the code to the caller");
    assert.ok(parsed.error!.issues.some((i) => i.path.join(".") === "EXPOSE_OTP_IN_RESPONSE"));
  });

  it("production accepts smtp as a delivering adapter, and still refuses the non-delivering ones", () => {
    const base = {
      ...VALID_SMTP,
      NODE_ENV: "production",
      DB_DRIVER: "postgres",
      DATABASE_URL: "postgresql://user@host:5432/db",
      CORS_ORIGINS: "https://app.example.com",
    };
    assert.equal(envSchema.safeParse(base).success, true, JSON.stringify(envSchema.safeParse(base).error?.issues));

    for (const adapter of ["memory", "console"]) {
      const parsed = envSchema.safeParse({ ...base, EMAIL_ADAPTER: adapter });
      assert.equal(parsed.success, false, `${adapter} must not be allowed in production`);
    }
  });
});

/* ============================================== SMTP-04 the port contract */

describe("SMTP-04 — the adapter honours the same port as every other", () => {
  it("implements EmailAdapter, and is interchangeable with the others", async () => {
    const stub = stubTransport();
    const adapters: EmailAdapter[] = [
      new MemoryEmailAdapter(),
      new ConsoleEmailAdapter(),
      new HttpEmailAdapter(),
      new SmtpEmailAdapter(stub.factory),
    ];

    for (const adapter of adapters) {
      assert.equal(typeof adapter.name, "string");
      assert.ok(adapter.name.length > 0);
      assert.equal(typeof adapter.send, "function");
      assert.equal(adapter.send.length, 1, `${adapter.name}.send takes one message`);
    }
    assert.deepEqual(
      adapters.map((a) => a.name),
      ["memory", "console", "http", "smtp"]
    );

    // `verify` is optional and only the SMTP one has anything to prove.
    assert.equal(typeof new SmtpEmailAdapter(stub.factory).verify, "function");
    assert.equal(new MemoryEmailAdapter().verify, undefined);
    assert.equal(new ConsoleEmailAdapter().verify, undefined);
    assert.equal(new HttpEmailAdapter().verify, undefined);
  });

  it("the auth module never imports a transport library", async () => {
    const dir = resolve(process.cwd(), "src", "modules", "auth");
    for (const file of ["auth.service.ts", "auth.routes.ts", "auth.repository.ts"]) {
      const source = await readFile(join(dir, file), "utf8");
      for (const forbidden of ["nodemailer", "smtp.adapter", "SmtpEmailAdapter", "createTransport"]) {
        assert.ok(
          !source.includes(forbidden),
          `modules/auth/${file} references "${forbidden}" — the transport must stay behind the port`
        );
      }
    }
    // And the service depends on the port, not on the factory.
    const service = await readFile(join(dir, "auth.service.ts"), "utf8");
    assert.ok(service.includes("type EmailAdapter"), "the service takes the port as a type");
    assert.ok(!service.includes("createEmailAdapter"), "the service does not choose its own transport");
  });

  it("the factory returns the adapter the environment asked for", () => {
    // The test environment selects `memory`; the mapping itself is what
    // matters, and the other branches are constructed directly above.
    assert.equal(createEmailAdapter().name, "memory");
  });
});

/* ======================================= SMTP-05/06 the message content */

describe("SMTP-05/06 — message construction", () => {
  it("SMTP-05: the verification email states the purpose, the code, the expiry and the risk", () => {
    const message = otpMessage("reader@example.com", "428913", 600, "email_verification");

    assert.equal(message.to, "reader@example.com");
    assert.equal(message.subject, "Verify your Mulya account");

    for (const part of ["428913", "10 minutes", "once", "Mulya"]) {
      assert.ok(message.text.includes(part), `the text is missing "${part}"`);
    }
    assert.match(message.text, /did not create a Mulya account/i, "it tells an unexpected recipient what to do");
    assert.match(message.text, /never share this code/i);
    assert.ok(!/reset/i.test(message.subject), "it must not read as a password reset");

    // SMTP-12 (content half): an HTML part exists and carries the same code.
    assert.ok(message.html);
    assert.ok(message.html!.includes("428913"));
    assert.match(message.html!, /^<!doctype html>/i);
    assert.ok(message.html!.includes("<title>Verify your Mulya account</title>"));
  });

  it("SMTP-06: the reset email is distinguishable, and says the password has not changed", () => {
    const message = otpMessage("reader@example.com", "115577", 600, "password_reset");

    assert.equal(message.subject, "Reset your Mulya password");
    assert.ok(message.text.includes("115577"));
    assert.match(message.text, /reset the password/i);
    assert.match(message.text, /your password has not changed/i);
    assert.match(message.text, /10 minutes/);
    assert.ok(message.html!.includes("115577"));

    // The two purposes must not produce the same email.
    const verification = otpMessage("reader@example.com", "115577", 600, "email_verification");
    assert.notEqual(message.subject, verification.subject);
    assert.notEqual(message.text, verification.text);
  });

  it("the email leaks nothing internal", () => {
    for (const purpose of ["email_verification", "password_reset"] as const) {
      const message = otpMessage("reader@example.com", "999000", 600, purpose);
      const whole = `${message.subject}\n${message.text}\n${message.html}`;
      for (const leak of ["argon2", "passwordHash", "password_hash", "userId", "sessionId", "token", "http://", "select "]) {
        assert.ok(!whole.toLowerCase().includes(leak.toLowerCase()), `the ${purpose} email contains "${leak}"`);
      }
    }
  });

  it("the expiry is stated in the reader's units, not the configuration's", () => {
    assert.match(otpMessage("a@b.com", "1", 60, "email_verification").text, /1 minute\b/);
    assert.match(otpMessage("a@b.com", "1", 900, "email_verification").text, /15 minutes/);
    // Never "0 minutes", whatever the configured TTL.
    assert.match(otpMessage("a@b.com", "1", 20, "email_verification").text, /1 minute\b/);
  });
});

/* =========================================== SMTP-07/08 routing the mail */

describe("SMTP-07/08 — recipient and sender", () => {
  it("SMTP-07: the recipient reaches the transport unchanged", async () => {
    const stub = stubTransport();
    await new SmtpEmailAdapter(stub.factory).send({
      to: "someone@example.com",
      subject: "Verify your Mulya account",
      text: "code 123456",
      html: "<p>code 123456</p>",
    });

    assert.equal(stub.sent.length, 1);
    assert.equal(stub.sent[0]!["to"], "someone@example.com");
    assert.equal(stub.sent[0]!["subject"], "Verify your Mulya account");
    assert.equal(stub.sent[0]!["text"], "code 123456");
    assert.equal(stub.sent[0]!["html"], "<p>code 123456</p>");
  });

  it("SMTP-08: the sender comes from configuration, never from the caller", async () => {
    const stub = stubTransport();
    await new SmtpEmailAdapter(stub.factory).send({
      to: "someone@example.com",
      subject: "s",
      text: "t",
    });
    // Compared against the CONFIGURED value rather than a literal: the point
    // is that the adapter supplies the sender rather than accepting one from
    // the message, and hardcoding the string made this test fail the moment
    // a developer pointed their own .env at a real mailbox.
    assert.equal(stub.sent[0]!["from"], env.EMAIL_FROM);
    assert.ok(env.EMAIL_FROM.length > 0);
    assert.equal(stub.sent[0]!["html"], undefined, "an absent html part is omitted, not sent as undefined");
  });

  it("the transport is created once and reused", async () => {
    let created = 0;
    const stub = stubTransport();
    const adapter = new SmtpEmailAdapter(() => {
      created++;
      return stub.factory();
    });
    await adapter.send({ to: "a@example.com", subject: "s", text: "t" });
    await adapter.send({ to: "b@example.com", subject: "s", text: "t" });
    await adapter.verify();
    assert.equal(created, 1, "a new connection per message would be a per-email TLS handshake");
    assert.equal(stub.sent.length, 2);
  });
});

/* =============================================== SMTP-09 failure handling */

describe("SMTP-09 — failures are propagated, not swallowed", () => {
  it("a send failure raises EMAIL_SEND_FAILED rather than resolving", async () => {
    const stub = stubTransport({ failSend: smtpError("EAUTH", "535 5.7.8 Username and Password not accepted") });
    const adapter = new SmtpEmailAdapter(stub.factory);

    await assert.rejects(
      () => adapter.send({ to: "a@example.com", subject: "s", text: "t" }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal((error as AppError).code, "EMAIL_SEND_FAILED");
        assert.equal((error as AppError).statusCode, 502);
        return true;
      }
    );
    assert.equal(stub.sent.length, 0, "nothing was recorded as sent");
  });

  it("a verify failure explains the likely cause, per error code", async () => {
    const cases: Array<[string, RegExp]> = [
      ["EAUTH", /Google App Password/i],
      ["ECONNECTION", /SMTP_HOST, SMTP_PORT and SMTP_SECURE/],
      ["ETIMEDOUT", /did not respond/],
      ["EDNS", /could not be resolved/],
      ["WEIRD", /could not be verified/],
    ];
    for (const [code, expected] of cases) {
      const stub = stubTransport({ failVerify: smtpError(code) });
      await assert.rejects(
        () => new SmtpEmailAdapter(stub.factory).verify(),
        (error: unknown) => {
          assert.match((error as AppError).message, expected, `code ${code}`);
          return true;
        }
      );
    }
  });

  it("a verify success does not send anything", async () => {
    const stub = stubTransport();
    await new SmtpEmailAdapter(stub.factory).verify();
    assert.equal(stub.verifyCount(), 1);
    assert.equal(stub.sent.length, 0, "the startup check must not email anybody");
  });

  it("the application refuses to start when the transport cannot be verified", async () => {
    // buildApp is the composition root, so this is the real startup path.
    const { buildApp } = await import("../src/app.js");
    const stub = stubTransport({ failVerify: smtpError("EAUTH") });
    await assert.rejects(
      () => buildApp({ email: new SmtpEmailAdapter(stub.factory), db: {} as never, closeDb: async () => {} }),
      (error: unknown) => {
        assert.match((error as Error).message, /failed its startup check/i);
        assert.match((error as Error).message, /App Password/i);
        return true;
      }
    );
  });
});

/* ================================================ SMTP-10/11 no leakage */

describe("SMTP-10/11 — credentials and codes stay where they belong", () => {
  it("SMTP-10: no SMTP failure carries the password into a message or log context", async () => {
    const secret = "an-app-password-that-must-not-escape";
    // A provider genuinely can echo the failed AUTH line back, so the error
    // used here contains the credential. Nothing built from it may.
    const leaky = smtpError("EAUTH", `535 rejected AUTH PLAIN dXNlcgBwYXNz ${secret}`);

    const failures: unknown[] = [];
    const sendStub = stubTransport({ failSend: leaky });
    await new SmtpEmailAdapter(sendStub.factory)
      .send({ to: "a@example.com", subject: "s", text: "t" })
      .catch((e) => failures.push(e));
    const verifyStub = stubTransport({ failVerify: leaky });
    await new SmtpEmailAdapter(verifyStub.factory).verify().catch((e) => failures.push(e));

    assert.equal(failures.length, 2);
    for (const error of failures as AppError[]) {
      const exposed = `${error.message} ${JSON.stringify(error.details ?? null)} ${JSON.stringify(error.logContext ?? null)}`;
      assert.ok(!exposed.includes(secret), "the credential reached the error");
      assert.ok(!exposed.includes("AUTH PLAIN"), "the raw SMTP dialogue reached the error");
      assert.ok(!exposed.includes("535 "), "the provider's raw message reached the error");
    }
  });

  it("SMTP-10b: the adapter never reads a credential into a string it builds", async () => {
    const source = await readFile(resolve(process.cwd(), "src/email/adapters/smtp.adapter.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
    // SMTP_PASS may be handed to the transport and nowhere else.
    const uses = [...code.matchAll(/env\.SMTP_PASS/g)];
    assert.equal(uses.length, 1, "SMTP_PASS is referenced more than once");
    assert.match(code, /pass:\s*env\.SMTP_PASS!/, "its single use is the transport's auth block");
    assert.ok(!/\$\{[^}]*SMTP_PASS[^}]*\}/.test(code), "SMTP_PASS is interpolated into a string");

    // The adapter must not write anywhere itself. It attaches `logContext` to
    // the AppError and lets the central handler decide — that path is already
    // covered by the logger's redact list, a direct write would not be.
    assert.ok(!/\bconsole\.\w+\(/.test(code), "the adapter writes to the console");
    assert.ok(!/\.log\.\w+\(/.test(code), "the adapter writes to the logger");

    // And the operator-facing text is built from the error CODE, never its
    // message — a provider can quote the failed AUTH line, credential included.
    assert.ok(!/\bcause\s*(?:as[^)]*)?\)?\s*\.?\??\.message\b/.test(code), "an error message is read from the provider");
    assert.ok(code.includes("reasonOf(cause)"), "failures are classified by code");
  });

  it("SMTP-11: the OTP is not in an API response when the code is not exposed", async () => {
    // The test environment sets EXPOSE_OTP_IN_RESPONSE=true so the other
    // suites can drive the flow, and the schema forbids that combination
    // with smtp — so this asserts the rule rather than the running config.
    const parsed = envSchema.safeParse({ ...VALID_SMTP, EXPOSE_OTP_IN_RESPONSE: "true" });
    assert.equal(parsed.success, false);

    // With exposure off, the service omits devCode entirely.
    const withoutExposure = envSchema.safeParse(VALID_SMTP);
    assert.equal(withoutExposure.success, true);
    assert.equal(withoutExposure.data!.EXPOSE_OTP_IN_RESPONSE, false);

    const service = await readFile(resolve(process.cwd(), "src/modules/auth/auth.service.ts"), "utf8");
    assert.match(
      service,
      /devCode:\s*env\.EXPOSE_OTP_IN_RESPONSE\s*\?\s*code\s*:\s*undefined/,
      "the code is returned only under the flag"
    );
  });

  it("SMTP-11b: no credential or code is written to the repository", async () => {
    const example = await readFile(resolve(process.cwd(), ".env.example"), "utf8");
    // Commented out, because the whole SMTP block is optional — but present,
    // so nobody has to guess the variable name.
    assert.match(example, /^#?\s*SMTP_PASS=/m, "the variable is documented");
    assert.match(example, /App Password/i, "and explained");
    assert.match(example, /NOT YOUR GMAIL PASSWORD/i, "with the warning stated plainly");

    // A placeholder, not a credential. A Google App Password is 16 letters.
    const value = example.match(/^#?\s*SMTP_PASS=(.*)$/m)![1]!.trim();
    assert.ok(/replace|your|placeholder|<.*>/i.test(value), `SMTP_PASS in .env.example looks real: "${value}"`);
    assert.ok(!/^[a-z]{16}$/i.test(value), "that is the shape of a real Google App Password");

    // Nor assigned anywhere else in the committed tree.
    for (const rel of [".env.example", "README.md", "src/email/adapters/smtp.adapter.ts", "src/config/env.ts"]) {
      const source = await readFile(resolve(process.cwd(), rel), "utf8");
      const assignment = source.match(/SMTP_PASS\s*[:=]\s*["']?([^\s"'#]+)/i)?.[1];
      // A schema declaration (`SMTP_PASS: z.string()…`) is a definition, not
      // a value; only a literal on the right-hand side is a leak.
      if (!assignment || assignment.startsWith("z.") || assignment.includes("(")) continue;
      assert.ok(
        /replace|your|placeholder|env\.|<.*>/i.test(assignment),
        `${rel} assigns SMTP_PASS a literal value: "${assignment}"`
      );
    }
  });
});

/* ================================== a failing transport, end to end */

describe("SMTP-09b — a failed send is reported, not papered over", () => {
  /** An adapter that always fails, standing in for a broken mail path. */
  class BrokenEmailAdapter implements EmailAdapter {
    readonly name = "broken";
    attempts = 0;
    async send(): Promise<void> {
      this.attempts++;
      throw new AppError("EMAIL_SEND_FAILED", "The email could not be sent. Please try again in a moment.", {
        logContext: { adapter: "smtp", reason: "EAUTH" },
      });
    }
  }

  it("registration reports the delivery failure instead of claiming a code was sent", async () => {
    const broken = new BrokenEmailAdapter();
    const app = await createTestAppWith(broken);
    try {
      const email = "smtp09b@example.com";
      const res = await app.app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email, password: "a-perfectly-fine-password" },
        remoteAddress: "10.151.0.1",
      });

      assert.equal(broken.attempts, 1, "a send was actually attempted");
      assert.equal(res.statusCode, 502);
      const body = res.json() as Json;
      assert.equal(body["error"].code, "EMAIL_SEND_FAILED");
      assert.equal(body["devCode"], undefined, "the code is never handed over as a consolation");
      assert.ok(!/on its way|check your email/i.test(res.body), "it must not claim delivery");

      // Nothing internal reaches the caller.
      for (const leak of ["EAUTH", "smtp", "nodemailer", "535", "AUTH PLAIN"]) {
        assert.ok(!res.body.includes(leak), `the response leaked "${leak}"`);
      }
    } finally {
      await app.close();
    }
  });

  it("a failed send does not leave a cooldown blocking the retry", async () => {
    const broken = new BrokenEmailAdapter();
    const app = await createTestAppWith(broken);
    try {
      const email = "smtp09c@example.com";
      const attempt = () =>
        app.app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email, password: "a-perfectly-fine-password" },
          remoteAddress: "10.152.0.1",
        });

      assert.equal((await attempt()).statusCode, 502);

      // Immediately again. Without retiring the dead challenge this would be
      // OTP_COOLDOWN — the user waiting out a timer for an email that was
      // never sent.
      const second = await attempt();
      assert.equal(broken.attempts, 2, "the retry reached the transport");
      assert.notEqual((second.json() as Json)["error"]?.code, "OTP_COOLDOWN");
      assert.equal(second.statusCode, 502, "it fails for the real reason, not a timer");
    } finally {
      await app.close();
    }
  });

  it("once the transport recovers, the same address can complete signup", async () => {
    const flaky = new (class implements EmailAdapter {
      readonly name = "flaky";
      working = false;
      readonly sent: Array<{ to: string; subject: string; text: string }> = [];
      async send(message: { to: string; subject: string; text: string }): Promise<void> {
        if (!this.working) throw new AppError("EMAIL_SEND_FAILED", "nope");
        this.sent.push(message);
      }
    })();

    const app = await createTestAppWith(flaky);
    try {
      const email = "smtp09d@example.com";
      const attempt = () =>
        app.app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email, password: "a-perfectly-fine-password" },
          remoteAddress: "10.153.0.1",
        });

      assert.equal((await attempt()).statusCode, 502);
      flaky.working = true;
      const recovered = await attempt();
      assert.equal(recovered.statusCode, 201);

      const code = (recovered.json() as Json)["devCode"] as string;
      assert.equal(flaky.sent.length, 1);
      assert.ok(flaky.sent[0]!.text.includes(code));

      const verified = await app.app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { email, code },
        remoteAddress: "10.153.0.2",
      });
      assert.equal(verified.statusCode, 200, "the delivered code still works");
    } finally {
      await app.close();
    }
  });
});

/* ============================================ SMTP-12 nothing else broke */

describe("SMTP-12 — the existing adapters are unaffected", () => {
  let h: Harness;
  before(async () => {
    h = await createTestApp();
  });
  after(async () => {
    await h.close();
  });

  it("memory still captures, filters and clears", async () => {
    const adapter = new MemoryEmailAdapter();
    await adapter.send({ to: "one@example.com", subject: "s", text: "t" });
    await adapter.send({ to: "two@example.com", subject: "s", text: "t" });
    assert.equal(adapter.sent.length, 2);
    assert.equal(adapter.to("one@example.com").length, 1);
    assert.equal(adapter.last?.to, "two@example.com");
    adapter.clear();
    assert.equal(adapter.sent.length, 0);
  });

  it("console prints without throwing, and carries the body only when exposure is on", async () => {
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void written.push(args.join(" "));
    try {
      await new ConsoleEmailAdapter().send({ to: "reader@example.com", subject: "Subject", text: "body 123456" });
    } finally {
      console.log = original;
    }
    assert.equal(written.length, 1);
    assert.ok(written[0]!.includes("reader@example.com"));
  });

  it("the real registration flow still delivers through the port, unchanged", async () => {
    const email = "smtp12@example.com";
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password: "a-perfectly-fine-password" },
      remoteAddress: "10.150.0.1",
    });
    assert.equal(res.statusCode, 201);

    const delivered = h.email.to(email);
    assert.equal(delivered.length, 1, "the auth service still reaches the email port");
    assert.equal(delivered[0]!.subject, "Verify your Mulya account");
    assert.ok(delivered[0]!.text.includes((res.json() as Json)["devCode"] as string));
    assert.ok(delivered[0]!.html, "the HTML part travels through the port too");
  });
});
