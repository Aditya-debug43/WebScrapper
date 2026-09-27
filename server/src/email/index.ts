import { env } from "../config/env.js";
import type { EmailAdapter } from "./types.js";
import { MemoryEmailAdapter } from "./adapters/memory.adapter.js";
import { ConsoleEmailAdapter } from "./adapters/console.adapter.js";
import { HttpEmailAdapter } from "./adapters/http.adapter.js";

export type { EmailAdapter, OutgoingEmail } from "./types.js";
export { MemoryEmailAdapter } from "./adapters/memory.adapter.js";

export type OtpPurposeLabel = "email_verification" | "password_reset";

export function createEmailAdapter(): EmailAdapter {
  switch (env.EMAIL_ADAPTER) {
    case "memory":
      return new MemoryEmailAdapter();
    case "http":
      return new HttpEmailAdapter();
    case "console":
    default:
      return new ConsoleEmailAdapter();
  }
}

/**
 * The one-time-code message. Plain text only: nothing to click, so nothing to
 * spoof, and a code typed by hand cannot be consumed by a link scanner.
 *
 * The wording differs by purpose because the two mean different things to
 * someone who did not ask for them — an unexpected verification code is
 * noise, an unexpected reset code is a warning worth acting on.
 */
export function otpMessage(to: string, code: string, ttlSeconds: number, purpose: OtpPurposeLabel) {
  const minutes = Math.round(ttlSeconds / 60);
  const plural = minutes === 1 ? "" : "s";
  const isReset = purpose === "password_reset";

  return {
    to,
    subject: isReset
      ? `${code} is your Mulya password reset code`
      : `${code} is your Mulya verification code`,
    text: [
      isReset
        ? `Use ${code} to reset your Mulya password.`
        : `Use ${code} to verify your email address for Mulya.`,
      ``,
      `It expires in ${minutes} minute${plural} and can be used once.`,
      isReset
        ? `If you did not request a password reset, ignore this message — your password has not changed.`
        : `If you did not create an account, you can ignore this message.`,
    ].join("\n"),
  };
}
