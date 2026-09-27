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
  /**
   * Optional startup check: prove the transport is usable before anything
   * depends on it, WITHOUT sending a message.
   *
   * Optional because most adapters have nothing to prove — `memory` and
   * `console` cannot fail, and the HTTP one has no handshake to perform. An
   * adapter that authenticates against a remote server does, and a wrong
   * credential should surface at boot rather than during someone's signup.
   */
  verify?(): Promise<void>;
}
