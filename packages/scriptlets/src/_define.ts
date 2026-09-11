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
