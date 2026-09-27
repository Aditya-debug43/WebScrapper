import { env } from "../config/env.js";
import type { EmailAdapter } from "./types.js";
import { MemoryEmailAdapter } from "./adapters/memory.adapter.js";
import { ConsoleEmailAdapter } from "./adapters/console.adapter.js";
import { HttpEmailAdapter } from "./adapters/http.adapter.js";

export type { EmailAdapter, OutgoingEmail } from "./types.js";
export { MemoryEmailAdapter } from "./adapters/memory.adapter.js";

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

/** The one-time-code message. Plain text only; nothing to click, nothing to spoof. */
export function otpMessage(to: string, code: string, ttlSeconds: number) {
  const minutes = Math.round(ttlSeconds / 60);
  return {
    to,
    subject: `${code} is your Mulya sign-in code`,
    text: [
      `Your Mulya sign-in code is ${code}.`,
      ``,
      `It expires in ${minutes} minute${minutes === 1 ? "" : "s"} and can be used once.`,
      `If you did not request it, you can ignore this message — no account was changed.`,
    ].join("\n"),
  };
}
