import type { EmailAdapter, OutgoingEmail } from "../types.js";

/**
 * Test adapter: captures messages in memory so tests can assert on the
 * recipient, the subject and the code actually delivered — without a network
 * call, an inbox, or a provider account.
 */
export class MemoryEmailAdapter implements EmailAdapter {
  readonly name = "memory";
  readonly sent: OutgoingEmail[] = [];

  async send(message: OutgoingEmail): Promise<void> {
    this.sent.push(message);
  }

  get last(): OutgoingEmail | undefined {
    return this.sent[this.sent.length - 1];
  }

  /** Messages delivered to one address, oldest first. */
  to(address: string): OutgoingEmail[] {
    return this.sent.filter((m) => m.to.toLowerCase() === address.toLowerCase());
  }

  clear(): void {
    this.sent.length = 0;
  }
}
