/**
 * Error type for every expected failure (bad input, rule violations, storage
 * problems). Tool handlers turn it into an MCP result with `isError: true`.
 */
export class RoundtableError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RoundtableError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new RoundtableError(code, message);
}
