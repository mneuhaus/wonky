export class FeatureScriptError extends Error {
  constructor(message, token) {
    super(message);
    this.name = 'FeatureScriptError';
    this.line = token?.line;
    this.column = token?.column;
  }
  format(filename = '<input>') {
    return `${filename}${this.line ? `:${this.line}:${this.column}` : ''}: ${this.message}`;
  }
}
// wonky cannot continue: a resource limit, a kernel self-audit, malformed
// input outside the language. Not a FeatureScript exception, so a `try` in the
// input never catches it.
export const fail = (message, token) => { throw new FeatureScriptError(message, token); };
// A frontend rejection with a stable machine-readable `code` (for example
// 'fs/reserved-identifier') and a `hint` naming the fix. The CLI reports both.
export const failNamed = (code, message, hint, token) => {
  const error = new FeatureScriptError(message, token);
  error.code = code; error.hint = hint;
  throw error;
};

// A FeatureScript exception as Onshape raises it. FsDoc exceptions.html: "An
// exception might be raised for many reasons, including an invalid numeric
// operation like square root of a negative number, a precondition failing, a
// map lookup (. or [] operator) on undefined, a failing operation, evaluation,
// or feature". Only these are caught by `try`, `try silent` and `catch`. Raise
// one only where Onshape itself would raise an exception for the same input;
// everything wonky raises about its own limits stays a plain FeatureScriptError
// or an UnsupportedFeatureError. The name stays 'FeatureScriptError' so reports
// and the corpus classifier see no difference.
export class FeatureScriptException extends FeatureScriptError {
  constructor(message, token, code = 'fs/exception', hint = 'Inspect the throw or regenError at this location and the values supplied by its caller.') {
    super(message, token);
    this.code = code;
    this.hint = hint;
  }
}
// Name genuine language failures at their owner, not by guessing from message
// text or turning internal JS errors/capability gaps into catchable exceptions.
export const raiseNamed = (code, message, hint, token) => {
  throw new FeatureScriptException(message, token, code, hint);
};
export const raise = (message, token) => raiseNamed('fs/invalid-argument', message,
  'Check the argument values, types and units required by this function; the message identifies the failing requirement.', token);
export const catchable = error => error instanceof FeatureScriptException;

// Missing implementation is not a modeled FeatureScript exception. A try or
// try-silent in the input must never turn an unsupported operation into success.
export class UnsupportedFeatureError extends FeatureScriptError {
  constructor(message, token) { super(message, token); this.name = 'UnsupportedFeatureError'; }
}
export const unsupported = (message, token) => { throw new UnsupportedFeatureError(message, token); };

// A refusal with a stable, named code (`reason`, lower-case slash form) and a
// hint that says what to write instead. Like every unsupported operation it is
// never caught by FeatureScript `try`.
export class NamedRefusal extends UnsupportedFeatureError {
  constructor(builtin, reason, message, hint, token) {
    super(`${builtin}: ${message}`, token);
    this.name = 'NamedRefusal';
    Object.assign(this, { builtin, reason, hint });
  }
}
export const refuseNamed = (builtin, reason, message, hint, token) => { throw new NamedRefusal(builtin, reason, message, hint, token); };

const NAMED_CODE = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
// The stable code the wonky CLI reports for an error (bin/wonky.mjs). An
// unnamed CLI_ERROR is a bug: every refusal names itself through `reason` or
// `refusalCategory`.
export function errorCode(error) {
  const category = error?.reason ?? error?.refusalCategory;
  if (typeof category === 'string' && NAMED_CODE.test(category)) return category;
  if (error?.refusalCategory) return 'GEOMETRY_REFUSAL';
  if (error instanceof UnsupportedFeatureError) return 'CAPABILITY_UNAVAILABLE';
  // Source-trace operation metadata must not erase a named validation failure.
  if (error?.code) return error.code;
  if (error instanceof FeatureScriptError && (error.operation || error.operationUnderTest)) return 'GEOMETRY_REFUSAL';
  return 'CLI_ERROR';
}
