/**
 * Email normalisation.
 *
 * Applied on every path that reads or writes an address, so "  Ada@Example.COM "
 * and "ada@example.com" are one account. The database backs this up with a
 * unique index on `lower(email)` — normalisation that relies on every caller
 * remembering to normalise is not a guarantee.
 *
 * Deliberately NOT doing provider-specific canonicalisation (stripping dots or
 * +tags from Gmail). Those rules differ per provider, change without notice,
 * and silently merging two addresses the user believes are distinct is worse
 * than keeping them apart.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Masked form for logs: never write a full address to disk. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 2);
  return `${head}${local.length > 2 ? "***" : ""}@${domain}`;
}
