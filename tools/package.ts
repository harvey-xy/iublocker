/**
 * package — zip a build output into `artifacts/` with a pure-Node ZIP writer.
 *
 *   pnpm package                                     packages/extension/dist → artifacts/iublocker-<version>.zip
 *   pnpm package -- --dir packages/extension/rulesets --out artifacts/rulesets.zip --no-check
 *
 * docs/BUILD-AND-RELEASE.md. Archives are reproducible: entries are sorted by path and
 * timestamps are fixed, so the same tree always yields the same bytes.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boolFlag, parseArgs, stringFlag } from './lib/args';
import { ZipWriter } from './lib/zip';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Path for logs: relative to the repo when inside it, absolute otherwise. */
function display(target: string): string {
  const rel = path.relative(REPO_ROOT, target);
  return rel.startsWith('..') ? target : rel;
}

const USAGE = `Usage: tsx tools/package.ts [options]

  --dir <dir>      directory to zip (default packages/extension/dist)
  --out <file>     output zip (default artifacts/iublocker-<version>.zip)
  --version <v>    version for the default name (default: root package.json version)
  --no-check       do not require <dir>/manifest.json
  --help
`;

/** All files under `dir`, relative + POSIX separators, sorted for reproducibility. */
export async function walk(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

export async function zipDirectory(dir: string): Promise<{ buffer: Buffer; files: string[] }> {
  const files = await walk(dir);
  const zip = new ZipWriter();
  for (const file of files) zip.add(file, await readFile(path.join(dir, file)));
  return { buffer: zip.toBuffer(), files };
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, { boolean: ['no-check', 'help'] });
  if (boolFlag(args, 'help')) {
    console.log(USAGE);
    return 0;
  }

  const dir = path.resolve(REPO_ROOT, stringFlag(args, 'dir') ?? 'packages/extension/dist');
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`package: ${display(dir)} does not exist — run \`pnpm build\` first.`);
    return 1;
  }

  if (!boolFlag(args, 'no-check')) {
    try {
      await stat(path.join(dir, 'manifest.json'));
    } catch {
      console.error(`package: ${display(dir)}/manifest.json is missing — the build did not complete.`);
      return 1;
    }
  }

  let version = stringFlag(args, 'version');
  if (!version) {
    const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    version = pkg.version ?? '0.0.0';
  }

  const out = path.resolve(
    REPO_ROOT,
    stringFlag(args, 'out') ?? path.join('artifacts', `iublocker-${version}.zip`),
  );
  const { buffer, files } = await zipDirectory(dir);
  if (files.length === 0) {
    console.error(`package: ${display(dir)} is empty`);
    return 1;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, buffer);

  console.info(`package: ${display(out)} — ${files.length} file(s), ${human(buffer.length)}`);
  if (buffer.length > 100 * 1024 * 1024)
    console.warn('package: over the Chrome Web Store 100 MiB upload limit');
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`package: ${err instanceof Error ? err.stack : String(err)}`);
      process.exitCode = 1;
    },
  );
}
