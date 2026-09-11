/**
 * defineScriptlet — the single way to declare a MAIN-world scriptlet.
 *
 * The `fn` of every definition is serialised with `Function.prototype.toString()` and
 * injected into the page as `(fn)(...args)`. It therefore MUST be self-contained:
 * no reference to imports, module-level constants or helpers declared outside its own
 * body. Helpers are duplicated inside each function on purpose (see docs/SCRIPTLETS.md §1).
 */
import type { ScriptletArgSpec, ScriptletMeta } from '@iublocker/shared';

export interface ScriptletDefinition extends ScriptletMeta {
  /** Self-contained function (docs/SCRIPTLETS.md §1). Serialised with toString() for bundles. */
  fn: (...args: string[]) => void;
}

export interface ScriptletSpec {
  name: string;
  aliases?: string[];
  args: ScriptletArgSpec[];
  /** Defaults to true when the name starts with `trusted-`. */
  trusted?: boolean;
  /** File under packages/extension/public/resources/ serving the same code as a $redirect. */
  redirectResource?: string;
  fn: (...args: any[]) => void;
}

export function defineScriptlet(spec: ScriptletSpec): ScriptletDefinition {
  const aliases = new Set<string>(spec.aliases ?? []);
  // uBO writes surrogate names with a `.js` suffix; both spellings must resolve.
  for (const a of [spec.name, ...aliases]) {
    if (a.endsWith('.js')) aliases.add(a.slice(0, -3));
  }
  aliases.delete(spec.name);
  const def: ScriptletDefinition = {
    name: spec.name,
    aliases: [...aliases],
    args: spec.args,
    trusted: spec.trusted ?? spec.name.startsWith('trusted-'),
    fn: spec.fn as (...args: string[]) => void,
  };
  if (spec.redirectResource !== undefined) def.redirectResource = spec.redirectResource;
  return def;
}

/**
 * Serialise a scriptlet for injection.
 *
 * `fn.toString()` is almost enough, but a transpiler may rewrite named inner functions
 * into `__name(fn, "fn")` calls (esbuild's `keepNames`, which `tsx` turns on). That helper
 * lives in module scope, so the serialised body would stop being self-contained. Splice a
 * local no-op shim into the body when — and only when — the transpiler did that, and refuse
 * to emit anything that still depends on some other helper we do not know about.
 */
export function serializeScriptletFn(fn: (...args: any[]) => void, name = 'scriptlet'): string {
  const source = fn.toString();
  const open = source.indexOf('{');
  if (open === -1) throw new Error(`scriptlets: cannot serialise "${name}": no function body`);
  const needsName = /\b__name\s*\(/.test(source);
  const shim = needsName ? 'var __name=function(f){return f};' : '';
  const out = source.slice(0, open + 1) + shim + source.slice(open + 1);
  const leftover = /\b__(?!name\b)[A-Za-z$_][\w$]*\s*\(/.exec(out);
  if (leftover !== null) {
    throw new Error(`scriptlets: "${name}" depends on transpiler helper ${leftover[0]}; rewrite it`);
  }
  return out;
}
