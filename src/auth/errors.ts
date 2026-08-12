/** No session cookie, or it failed verification (missing/expired/tampered). Maps to HTTP 401. */
export class UnauthorizedError extends Error {}

/** A valid session exists, but its role isn't allowed to perform this action. Maps to HTTP 403. */
export class ForbiddenError extends Error {}
