/**
 * The email port.
 *
 * Auth depends on THIS, never on a provider SDK. Swapping Resend for SES or
 * SMTP is a new adapter and one environment variable; no service changes.
 */
export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface EmailAdapter {
  readonly name: string;
  send(message: OutgoingEmail): Promise<void>;
}
