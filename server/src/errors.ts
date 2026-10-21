/** Every error the API returns has this shape: { "error": { "code", "message", "details"? } }. */
export type ErrorCode =
  | "INVALID_ADDRESS"
  | "INVALID_QUERY"
  | "NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}
