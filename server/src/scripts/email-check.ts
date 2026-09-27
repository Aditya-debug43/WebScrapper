import { env } from "../config/env.js";
import { createEmailAdapter, otpMessage } from "../email/index.js";
import { maskEmail } from "../lib/email.js";

/**
 * Send one real email, and say exactly what happened.
 *
 * The automated tests prove the adapter speaks SMTP; they cannot prove that
 * *your* Gmail account accepts *your* App Password, because no test may hold
 * a real credential. This is the step that closes that gap, and it exists as
 * a script so it is one command rather than a walk through the whole signup
 * flow every time a setting changes.
 *
 *   npm run email:check -- you@gmail.com
 *
 * It reads the same configuration the server does, so if this works the
 * application will too. It prints no credential.
 */

const recipient = process.argv[2];

if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error(
    [
      "",
      "Usage:  npm run email:check -- you@example.com",
      "",
      "Sends one test message using the configured EMAIL_ADAPTER, so you can",
      "confirm delivery before relying on it during signup.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const adapter = createEmailAdapter();

console.log("");
console.log(`  adapter   ${adapter.name}`);
if (adapter.name === "smtp") {
  console.log(`  host      ${env.SMTP_HOST}:${env.SMTP_PORT}  (${env.SMTP_SECURE ? "implicit TLS" : "STARTTLS"})`);
  console.log(`  account   ${maskEmail(env.SMTP_USER ?? "")}`);
}
console.log(`  from      ${env.EMAIL_FROM}`);
console.log(`  to        ${recipient}`);
console.log("");

if (adapter.verify) {
  process.stdout.write("  verifying the transport… ");
  try {
    await adapter.verify();
    console.log("ok");
  } catch (error) {
    console.log("FAILED\n");
    console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

/**
 * A real verification message with an obviously fake code. Sending the true
 * message shape is the point — it is what proves the subject, the HTML part
 * and the plain-text fallback all survive the provider.
 */
const message = otpMessage(recipient, "000000", env.OTP_TTL_SECONDS, "email_verification");

process.stdout.write("  sending… ");
const started = Date.now();
try {
  await adapter.send(message);
} catch (error) {
  console.log("FAILED\n");
  console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

console.log(`delivered in ${Date.now() - started} ms\n`);
console.log(`  Subject:  ${message.subject}`);
console.log(`  Code:     000000  (a placeholder — this is not a real challenge)`);
console.log("");
console.log("  Check the inbox. If it is not there, look in spam: a brand-new");
console.log("  sending account is often filtered on its first message.");
console.log("");
