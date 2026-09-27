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

// A FeatureScript exception as Onshape raises it. FsDoc exceptions.html: "An
// exception might be raised for many reasons, including an invalid numeric
// operation like square root of a negative number, a precondition failing, a
// map lookup (. or [] operator) on undefined, a failing operation, evaluation,
// or feature". Only these are caught by `try`, `try silent` and `catch`. Raise
// one only where Onshape itself would raise an exception for the same input;
// everything wonky raises about its own limits stays a plain FeatureScriptError
// or an UnsupportedFeatureError. The name stays 'FeatureScriptError' so reports
// and the corpus classifier see no difference.
export class FeatureScriptException extends FeatureScriptError {}
export const raise = (message, token) => { throw new FeatureScriptException(message, token); };
export const catchable = error => error instanceof FeatureScriptException;

// Missing implementation is not a modeled FeatureScript exception. A try or
// try-silent in the input must never turn an unsupported operation into success.
export class UnsupportedFeatureError extends FeatureScriptError {
  constructor(message, token) { super(message, token); this.name = 'UnsupportedFeatureError'; }
}
export const unsupported = (message, token) => { throw new UnsupportedFeatureError(message, token); };
