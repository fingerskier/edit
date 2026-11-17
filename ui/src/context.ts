// Context keys and `when` clause evaluation, a subset of VS Code's grammar:
// identifiers, `!`, `&&`, `||`, `==`, `!=`, parentheses, and quoted strings.

export type ContextValue = boolean | string | number | undefined;
export type ContextReader = (key: string) => ContextValue;

type Token = { t: 'id' | 'str' | 'op'; v: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(?:(&&|\|\||==|!=|!|\(|\))|'([^']*)'|"([^"]*)"|([\w.:\-/]+))/gy;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(expr)) !== null) {
    last = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'op', v: m[1] });
    else if (m[2] !== undefined) tokens.push({ t: 'str', v: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: 'str', v: m[3] });
    else tokens.push({ t: 'id', v: m[4] });
  }
  if (expr.slice(last).trim() !== '') throw new Error(`Bad when clause: ${expr}`);
  return tokens;
}

/** Evaluate a `when` clause. An empty or missing clause is always true. */
export function evalWhen(expr: string | undefined, get: ContextReader): boolean {
  if (!expr || expr.trim() === '') return true;
  let tokens: Token[];
  try {
    tokens = tokenize(expr);
  } catch {
    return false; // A clause we cannot parse never matches.
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;

  const operand = (): ContextValue => {
    const tok = tokens[pos++];
    if (!tok) return undefined;
    if (tok.t === 'str') return tok.v;
    if (tok.v === 'true') return true;
    if (tok.v === 'false') return false;
    return get(tok.v);
  };
  const literal = (): string => {
    const tok = tokens[pos++];
    return tok ? tok.v : '';
  };
  const primary = (): boolean => {
    if (isOp('!')) {
      pos++;
      return !primary();
    }
    if (isOp('(')) {
      pos++;
      const v = or();
      if (isOp(')')) pos++;
      return v;
    }
    const left = operand();
    if (isOp('==') || isOp('!=')) {
      const negate = tokens[pos++].v === '!=';
      // The right side of a comparison is a literal, as in VS Code.
      const equal = String(left ?? '') === literal();
      return negate ? !equal : equal;
    }
    return Boolean(left);
  };
  const and = (): boolean => {
    let v = primary();
    while (isOp('&&')) {
      pos++;
      const r = primary();
      v = v && r;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (isOp('||')) {
      pos++;
      const r = and();
      v = v || r;
    }
    return v;
  };
  const result = or();
  return pos >= tokens.length ? result : false;
}

/** The live context key store. Values may be computed on read. */
export class ContextKeys {
  private values = new Map<string, ContextValue | (() => ContextValue)>();

  set(key: string, value: ContextValue | (() => ContextValue)): void {
    this.values.set(key, value);
  }

  get = (key: string): ContextValue => {
    const v = this.values.get(key);
    return typeof v === 'function' ? v() : v;
  };
}
