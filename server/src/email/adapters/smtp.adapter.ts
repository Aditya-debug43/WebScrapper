import nodemailer, { type Transporter } from "nodemailer";
import type { EmailAdapter, OutgoingEmail } from "../types.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";

/**
 * SMTP delivery, via Nodemailer.
 *
 * This is the ONLY file in the server that knows SMTP exists. The auth
 * service talks to the `EmailAdapter` port and cannot tell whether a message
 * went to an inbox, an HTTP provider, a console or an array — which is the
 * point of the port, and the reason adding this adapter changed no
 * authentication code at all.
 *
 * Intended for local development against Gmail, where receiving a real code
 * in a real inbox is the only way to know the flow works end to end. It is
 * permitted in production too: it delivers, and which delivering adapter is
 * right is an operational choice.
 *
 * ── Credentials ──────────────────────────────────────────────────────────
 * Every value comes from the environment and none is logged. `SMTP_PASS` is
 * expected to be a provider **app password** — for Gmail, one issued under
 * 2-Step Verification, which is scoped and revocable. A normal account
 * password is refused by Gmail anyway, and would put the whole account in an
 * env file rather than one credential that can be withdrawn.
 */

/** A connection that has been opened and authenticated at least once. */
type TransportFactory = () => Transporter;

export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = "smtp";
  private transport: Transporter | null = null;
  private readonly createTransport: TransportFactory;

  /**
   * The factory is injectable so tests can drive this class with a stub
   * transport. Nothing in production passes one, and no test ever reaches a
   * real mail server.
   */
  constructor(createTransport?: TransportFactory) {
    this.createTransport =
      createTransport ??
      (() =>
        nodemailer.createTransport({
          host: env.SMTP_HOST!,
          port: env.SMTP_PORT!,
          // 465 wraps the whole session in TLS; 587 starts plain and upgrades
          // with STARTTLS. Nodemailer infers the upgrade from `secure: false`,
          // so one flag covers both and neither sends credentials in clear.
          secure: env.SMTP_SECURE,
          auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
          // A wrong App Password otherwise hangs the request until the
          // platform's own timeout, which reads as "the app is broken"
          // rather than "the credential is wrong".
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        }));
  }

  private get connection(): Transporter {
    this.transport ??= this.createTransport();
    return this.transport;
  }

  /**
   * Prove the configuration before the first user depends on it.
   *
   * This performs the handshake and the AUTH exchange and then stops — no
   * message is sent, nobody receives anything, and it costs a few hundred
   * milliseconds once at boot. It is what turns "a wrong App Password" from
   * a failed signup three days later into a refusal to start now.
   */
  async verify(): Promise<void> {
    try {
      await this.connection.verify();
    } catch (cause) {
      throw new AppError("EMAIL_SEND_FAILED", describe(cause), {
        logContext: { adapter: "smtp", host: env.SMTP_HOST, port: env.SMTP_PORT, stage: "verify" },
      });
    }
  }

  async send(message: OutgoingEmail): Promise<void> {
    try {
      await this.connection.sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    } catch (cause) {
      /**
       * The caller gets the standard envelope and nothing else. A raw
       * Nodemailer error carries the host, the port, the SMTP dialogue and
       * sometimes the username; none of that belongs in an HTTP response,
       * and the response is read by whoever typed the address, who can do
       * nothing about any of it.
       */
      throw new AppError("EMAIL_SEND_FAILED", "The email could not be sent. Please try again in a moment.", {
        logContext: { adapter: "smtp", host: env.SMTP_HOST, port: env.SMTP_PORT, reason: reasonOf(cause) },
      });
    }
  }
}

/**
 * Turn an SMTP failure into something the operator can act on.
 *
 * Only ever built from the error's *code*, never from its message: a
 * provider's message can quote the failed AUTH line back at you, and that
 * line contains the credential.
 */
function describe(cause: unknown): string {
  switch (reasonOf(cause)) {
    case "EAUTH":
      return (
        "SMTP authentication was rejected. For Gmail, SMTP_PASS must be a Google App Password " +
        "(Google Account → Security → 2-Step Verification → App passwords), not the account password."
      );
    case "ECONNECTION":
    case "ESOCKET":
      return `Could not open an SMTP connection to ${env.SMTP_HOST}:${env.SMTP_PORT}. Check SMTP_HOST, SMTP_PORT and SMTP_SECURE (465 → true, 587 → false).`;
    case "ETIMEDOUT":
      return `The SMTP server at ${env.SMTP_HOST}:${env.SMTP_PORT} did not respond. Check the host and port, and whether outbound SMTP is blocked here.`;
    case "EDNS":
      return `SMTP_HOST "${env.SMTP_HOST}" could not be resolved.`;
    default:
      return `The SMTP transport could not be verified (${reasonOf(cause)}). Check the SMTP_* settings in your environment.`;
  }
}

/** The provider's error code, or a stable placeholder. Never the message. */
function reasonOf(cause: unknown): string {
  const code = (cause as { code?: unknown })?.code;
  return typeof code === "string" && code ? code : "UNKNOWN";
}
