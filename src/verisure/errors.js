// -----------------------------------------------------------------------------
// Errors of the Verisure clients.
//
// The integration reacts differently to each family, so they are classes and
// not messages to parse:
//   - MfaRequiredError: the account needs a code sent by SMS/e-mail; the user
//     finishes the login from the Configuration screen (actions send_code and
//     validate_code). Retrying the password on a loop would only lock the
//     account.
//   - AuthenticationError: credentials refused. Same: no retry until the
//     configuration changes.
//   - RateLimitError: Verisure (or its WAF) throttles us. Back off, never
//     insist.
//   - VerisureError: anything else (network, unexpected answer); retried at
//     the next refresh.
// -----------------------------------------------------------------------------

export class VerisureError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VerisureError';
    this.status = status;
    this.code = code;
  }
}

export class AuthenticationError extends VerisureError {
  constructor(message, options) {
    super(message, options);
    this.name = 'AuthenticationError';
  }
}

export class MfaRequiredError extends VerisureError {
  constructor(message = 'A verification code is required', options) {
    super(message, options);
    this.name = 'MfaRequiredError';
  }
}

export class RateLimitError extends VerisureError {
  constructor(message = 'Too many requests', options) {
    super(message, options);
    this.name = 'RateLimitError';
  }
}

/**
 * The panel refused to change mode, typically a door or window left open. Not a
 * transport failure: `allowForcing` tells whether a forced arming may succeed.
 */
export class ArmingRefusedError extends VerisureError {
  constructor(message, { allowForcing = false, details = [], ...options } = {}) {
    super(message, options);
    this.name = 'ArmingRefusedError';
    this.allowForcing = allowForcing;
    this.details = details;
  }
}

/** True for the errors that need the user, not a retry. */
export function needsUser(error) {
  return error instanceof MfaRequiredError || error instanceof AuthenticationError;
}
