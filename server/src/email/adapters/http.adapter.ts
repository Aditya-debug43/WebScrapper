import type { EmailAdapter, OutgoingEmail } from "../types.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";

/**
 * Production adapter: a generic transactional-email HTTP API.
 *
 * Deliberately provider-agnostic — the request body below is the shape Resend,
 * Postmark and most others accept, and the endpoint plus key come from the
 * environment. No credential appears in this file, and none is logged: the
 * error carries only the status code.
 */
export class HttpEmailAdapter implements EmailAdapter {
  readonly name = "http";

  async send(message: OutgoingEmail): Promise<void> {
    const res = await fetch(env.EMAIL_API_URL!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.EMAIL_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!res.ok) {
      throw new AppError("EMAIL_SEND_FAILED", "The verification email could not be sent. Please try again.", {
        logContext: { status: res.status },
      });
    }
  }
}
