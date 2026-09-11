/**
 * Tiny argv parser shared by the tools in this directory.
 *
 * Supports `--flag`, `--key value`, `--key=value` and positionals. A bare `--` is
 * ignored (pnpm forwards it: `pnpm rulesets:fetch -- --snapshot dir`).
 */

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export interface ParseOptions {
  /** Flags that never take a value. */
  boolean?: readonly string[];
}

export function parseArgs(argv: readonly string[], opts: ParseOptions = {}): ParsedArgs {
  const booleans = new Set(opts.boolean ?? []);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || arg === '--') continue;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (booleans.has(body)) {
      flags[body] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && next !== '--' && !next.startsWith('--')) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }

  return { flags, positionals };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === 'true';
}

export function listFlag(args: ParsedArgs, name: string): string[] | undefined {
  const v = stringFlag(args, name);
  if (v === undefined) return undefined;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
