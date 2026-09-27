/**
 * One error shape for the whole API:
 *
 *   { "error": { "code": "SNAKE_CASE", "message": "human readable", "details"?: [...] } }
 *
 * `code` is what clients branch on and never changes wording; `message` is for
 * humans and may. Nothing else is ever in the body — no stack, no SQL, no
 * internal identifiers.
 */

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_ALREADY_USED"
  | "OTP_TOO_MANY_ATTEMPTS"
  | "OTP_COOLDOWN"
  | "ACCOUNT_INACTIVE"
  | "EMAIL_SEND_FAILED"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  OTP_INVALID: 400,
  OTP_EXPIRED: 410,
  OTP_ALREADY_USED: 409,
  OTP_TOO_MANY_ATTEMPTS: 429,
  OTP_COOLDOWN: 429,
  ACCOUNT_INACTIVE: 403,
  EMAIL_SEND_FAILED: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  /** Extra context for the log only. Never serialised to the client. */
  readonly logContext?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { details?: unknown; logContext?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = opts.details;
    this.logContext = opts.logContext;
  }
}

export function errorBody(code: ErrorCode, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
