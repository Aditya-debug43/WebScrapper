import { env } from "../config/env.js";
import type { EmailAdapter } from "./types.js";
import { MemoryEmailAdapter } from "./adapters/memory.adapter.js";
import { ConsoleEmailAdapter } from "./adapters/console.adapter.js";
import { HttpEmailAdapter } from "./adapters/http.adapter.js";
import { SmtpEmailAdapter } from "./adapters/smtp.adapter.js";

export type { EmailAdapter, OutgoingEmail } from "./types.js";
export { MemoryEmailAdapter } from "./adapters/memory.adapter.js";
export { SmtpEmailAdapter } from "./adapters/smtp.adapter.js";

export type OtpPurposeLabel = "email_verification" | "password_reset";

/**
 * Which transport this deployment uses.
 *
 *   memory   tests — captured in an array, asserted against
 *   console  development without a mailbox — prints the message
 *   http     a transactional-email API
 *   smtp     a real mail server, e.g. Gmail for local development
 *
 * The auth service never sees this choice. It holds an `EmailAdapter` and
 * calls `send`; everything below is an operational decision.
 */
export function createEmailAdapter(): EmailAdapter {
  switch (env.EMAIL_ADAPTER) {
    case "memory":
      return new MemoryEmailAdapter();
    case "http":
      return new HttpEmailAdapter();
    case "smtp":
      return new SmtpEmailAdapter();
    case "console":
    default:
      return new ConsoleEmailAdapter();
  }
}

/**
 * The one-time-code message, in plain text and HTML.
 *
 * Nothing in it is a link. A code typed by hand cannot be consumed by a
 * corporate link scanner, cannot be forwarded into a working session, and
 * gives a phishing lookalike nothing to imitate.
 *
 * It also carries no identifiers — no user id, no session, no request id.
 * An email is the least trustworthy place a system's internals can end up,
 * and none of that would help the person reading it.
 *
 * The wording differs by purpose because the two mean different things to
 * someone who did not ask for them: an unexpected verification code is
 * noise, an unexpected reset code is a warning worth acting on.
 */
export function otpMessage(to: string, code: string, ttlSeconds: number, purpose: OtpPurposeLabel) {
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));
  const lifetime = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const isReset = purpose === "password_reset";

  const subject = isReset ? "Reset your Mulya password" : "Verify your Mulya account";
  const lead = isReset
    ? "We received a request to reset the password on your Mulya account. Use this code to continue."
    : "Use this code to confirm your email address and finish setting up your Mulya account.";
  const warning = isReset
    ? "If you did not request this, ignore this email. Your password has not changed, and it cannot be changed without this code."
    : "If you did not create a Mulya account, you can ignore this email. Nothing happens without this code.";

  return {
    to,
    subject,
    text: [
      lead,
      ``,
      `    ${code}`,
      ``,
      `This code expires in ${lifetime} and can be used once.`,
      ``,
      warning,
      `Never share this code with anyone. Mulya will never ask you for it.`,
      ``,
      `— Mulya · Marketplace Pricing Intelligence`,
    ].join("\n"),
    html: otpHtml({ code, lead, lifetime, warning, subject }),
  };
}

/**
 * Deliberately plain HTML.
 *
 * Inline styles only, a single-column table, system fonts and no images:
 * Gmail strips `<style>` blocks and web fonts, Outlook ignores most modern
 * layout, and images are blocked by default — so anything clever here
 * degrades into something worse than this. The code is the one element
 * given size, because finding it is the only job this email has.
 */
function otpHtml(v: { code: string; lead: string; lifetime: string; warning: string; subject: string }) {
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const mono = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(v.subject)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#edeeeb;font-family:${font};">
  <!-- Hidden from view, shown in the inbox list next to the subject. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code is ${escapeHtml(
    v.code
  )} and expires in ${escapeHtml(v.lifetime)}.</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d7dad6;border-radius:8px;">
    <tr>
      <td style="padding:28px 28px 0 28px;">
        <div style="font-size:15px;font-weight:600;letter-spacing:0.02em;color:#14161a;">Mulya</div>
        <div style="font-size:11px;letter-spacing:0.13em;text-transform:uppercase;color:#646a73;padding-top:3px;">Marketplace Pricing Intelligence</div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 28px 0 28px;font-size:15px;line-height:1.55;color:#383e46;">
        ${escapeHtml(v.lead)}
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 0 28px;">
        <div style="background:#f6f7f5;border:1px solid #d7dad6;border-radius:6px;padding:18px 20px;text-align:center;font-family:${mono};font-size:30px;font-weight:600;letter-spacing:0.28em;text-indent:0.28em;color:#14161a;">${escapeHtml(
          v.code
        )}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px 0 28px;font-size:13px;line-height:1.55;color:#545a63;">
        This code expires in ${escapeHtml(v.lifetime)} and can be used once.
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 0 28px;">
        <div style="border-top:1px solid #e4e6e2;padding-top:16px;font-size:12px;line-height:1.6;color:#646a73;">
          ${escapeHtml(v.warning)}<br>
          Never share this code with anyone. Mulya will never ask you for it.
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 26px 28px;font-size:11px;color:#8e949c;">
        Mulya · Marketplace Pricing Intelligence
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
