import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import nodemailer from "nodemailer";
import { SmtpEmailAdapter } from "../src/email/index.js";
import { otpMessage } from "../src/email/index.js";
import { AppError } from "../src/lib/errors.js";

/**
 * SMTP-13 — the adapter over a real socket.
 *
 * The stubbed tests in `smtp.test.ts` prove the adapter's logic. They do not
 * prove it can speak SMTP, because nothing there opens a connection.
 *
 * This runs a real SMTP server in-process and points the real Nodemailer
 * transport at it. The handshake, the AUTH exchange, the DATA phase and the
 * MIME encoding are all genuine. What it deliberately does NOT prove is
 * anything Gmail-specific — their TLS, their credential policy, their
 * acceptance rules. That is what the manual test in server/README.md is for,
 * and no automated test can honestly stand in for it.
 *
 * Nothing here reaches the internet, and no real credential exists in it.
 */

const USER = "desk@example.com";
const PASS = "a-local-test-password";

let server: SMTPServer;
let port: number;
/** Everything the server received, as raw RFC 5322 text. */
const inbox: Array<{ from: string; to: string[]; raw: string }> = [];
let rejectAuth = false;

before(async () => {
  server = new SMTPServer({
    // STARTTLS is skipped because there is no certificate to present on
    // localhost; the AUTH exchange and the message path are unaffected, and
    // TLS itself is the transport library's concern, not this adapter's.
    authOptional: false,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, callback) {
      if (rejectAuth || auth.username !== USER || auth.password !== PASS) {
        return callback(new Error("Invalid username or password"));
      }
      callback(null, { user: auth.username });
    },
    onData(stream, session, callback) {
      let raw = "";
      stream.on("data", (chunk) => (raw += chunk.toString()));
      stream.on("end", () => {
        inbox.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
        });
        callback();
      });
    },
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.server.address() as AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * The real adapter, with the real Nodemailer transport, pointed at the local
 * server. Only the host and port differ from production.
 */
function adapterUnderTest(overrides: { pass?: string } = {}) {
  return new SmtpEmailAdapter(() =>
    nodemailer.createTransport({
      host: "127.0.0.1",
      port,
      secure: false,
      ignoreTLS: true,
      auth: { user: USER, pass: overrides.pass ?? PASS },
      connectionTimeout: 5_000,
    })
  );
}

/** Undo quoted-printable soft line breaks so assertions see the real text. */
const unfold = (raw: string) => raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=");

describe("SMTP-13 — a real SMTP conversation", () => {
  it("verify() authenticates against a live server and sends nothing", async () => {
    const before = inbox.length;
    await adapterUnderTest().verify();
    assert.equal(inbox.length, before, "the startup check must not deliver a message");
  });

  it("verify() fails against a rejected credential, with the App Password hint", async () => {
    await assert.rejects(
      () => adapterUnderTest({ pass: "the-wrong-password" }).verify(),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal((error as AppError).code, "EMAIL_SEND_FAILED");
        assert.match((error as AppError).message, /Google App Password/i);
        // The rejected credential must not travel with the error.
        const exposed = `${(error as AppError).message} ${JSON.stringify((error as AppError).logContext)}`;
        assert.ok(!exposed.includes("the-wrong-password"));
        return true;
      }
    );
  });

  it("a verification email arrives intact over the wire", async () => {
    const before = inbox.length;
    const message = otpMessage("recipient@example.com", "314159", 600, "email_verification");
    await adapterUnderTest().send(message);

    assert.equal(inbox.length, before + 1, "exactly one message was delivered");
    const received = inbox.at(-1)!;
    const body = unfold(received.raw);

    // Envelope.
    assert.deepEqual(received.to, ["recipient@example.com"]);
    assert.ok(received.from.length > 0, "an envelope sender was set");

    // Headers, as the recipient's client will read them.
    assert.match(body, /^Subject: Verify your Mulya account\s*$/m);
    assert.match(body, /^To: recipient@example\.com\s*$/m);
    assert.match(body, /Content-Type: multipart\/alternative/i, "both a text and an HTML part were sent");

    // Content — the only thing the email exists to carry.
    assert.ok(body.includes("314159"), "the code survived transport");
    assert.ok(body.includes("10 minutes"));
    assert.match(body, /did not create a Mulya account/i);
    assert.match(body, /Marketplace Pricing Intelligence/);

    // And nothing internal rode along.
    for (const leak of ["argon2", "password_hash", "AUTH PLAIN", PASS]) {
      assert.ok(!body.includes(leak), `the delivered message contains "${leak}"`);
    }
  });

  it("a reset email is distinguishable on the wire", async () => {
    await adapterUnderTest().send(otpMessage("recipient@example.com", "271828", 600, "password_reset"));
    const body = unfold(inbox.at(-1)!.raw);
    assert.match(body, /^Subject: Reset your Mulya password\s*$/m);
    assert.ok(body.includes("271828"));
    assert.match(body, /your password has not changed/i);
  });

  it("a server-side rejection surfaces as EMAIL_SEND_FAILED, not a silent success", async () => {
    rejectAuth = true;
    try {
      const before = inbox.length;
      await assert.rejects(
        () => adapterUnderTest().send(otpMessage("recipient@example.com", "000000", 600, "email_verification")),
        (error: unknown) => {
          assert.equal((error as AppError).code, "EMAIL_SEND_FAILED");
          assert.equal((error as AppError).statusCode, 502);
          return true;
        }
      );
      assert.equal(inbox.length, before, "nothing was delivered");
    } finally {
      rejectAuth = false;
    }
  });

  it("an unreachable server is reported as a connection failure, not a hang", async () => {
    const adapter = new SmtpEmailAdapter(() =>
      nodemailer.createTransport({
        host: "127.0.0.1",
        // Nothing listens here.
        port: 1,
        secure: false,
        connectionTimeout: 2_000,
        auth: { user: USER, pass: PASS },
      })
    );
    await assert.rejects(
      () => adapter.verify(),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.match((error as AppError).message, /SMTP|connection|respond/i);
        return true;
      }
    );
  });
});
