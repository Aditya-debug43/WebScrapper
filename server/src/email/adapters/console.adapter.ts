import type { EmailAdapter, OutgoingEmail } from "../types.js";
import { maskEmail } from "../../lib/email.js";
import { env } from "../../config/env.js";

/**
 * Development adapter. Prints that a message was sent, to a masked address.
 *
 * The body — which contains the one-time code — is printed ONLY when
 * EXPOSE_OTP_IN_RESPONSE is on, which the environment schema forbids in
 * production. Logging a live credential to stdout, where it lands in a log
 * aggregator that outlives the code's ten-minute window, is the exact thing
 * the brief rules out.
 */
export class ConsoleEmailAdapter implements EmailAdapter {
  readonly name = "console";

  async send(message: OutgoingEmail): Promise<void> {
    if (env.EXPOSE_OTP_IN_RESPONSE) {
      console.log(`[email:console] → ${message.to} · ${message.subject}\n${message.text}`);
    } else {
      console.log(`[email:console] → ${maskEmail(message.to)} · ${message.subject} (body withheld)`);
    }
  }
}
