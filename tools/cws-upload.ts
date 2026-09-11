/**
 * cws-upload — upload (and optionally publish) the packaged extension through the
 * Chrome Web Store API v1.1. Skeleton: it is wired end to end but has never run against
 * a real listing, so keep `--dry-run` in CI until the store item exists.
 *
 *   CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… CWS_REFRESH_TOKEN=… CWS_EXTENSION_ID=… \
 *     pnpm tsx tools/cws-upload.ts --zip artifacts/iublocker-0.1.0.zip [--dry-run]
 *
 * Credentials come from a Google Cloud OAuth client with the Chrome Web Store API
 * enabled; the refresh token is obtained once, by hand, with the
 * https://www.googleapis.com/auth/chromewebstore scope. docs/BUILD-AND-RELEASE.md.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boolFlag, parseArgs, stringFlag } from './lib/args';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = (id: string) => `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${id}?uploadType=media`;
const PUBLISH_URL = (id: string, target: string) => `https://www.googleapis.com/chromewebstore/v1.1/items/${id}/publish?publishTarget=${target}`;
const ITEM_URL = (id: string) => `https://www.googleapis.com/chromewebstore/v1.1/items/${id}?projection=DRAFT`;

const USAGE = `Usage: tsx tools/cws-upload.ts --zip <file> [options]

  --zip <file>        package to upload (required)
  --target <t>        publishTarget: default | trustedTesters (default: default)
  --skip-publish      upload only, leave the item as a draft
  --dry-run           validate inputs and print what would happen, make no API calls
  --help

Environment: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID
`;

export interface CwsCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  extensionId: string;
}

export function readCredentials(env: NodeJS.ProcessEnv = process.env): { creds?: CwsCredentials; missing: string[] } {
  const names = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_EXTENSION_ID'] as const;
  const missing = names.filter((n) => !env[n]);
  if (missing.length > 0) return { missing };
  return {
    missing: [],
    creds: {
      clientId: env.CWS_CLIENT_ID as string,
      clientSecret: env.CWS_CLIENT_SECRET as string,
      refreshToken: env.CWS_REFRESH_TOKEN as string,
      extensionId: env.CWS_EXTENSION_ID as string,
    },
  };
}

async function asError(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => '');
  return new Error(`${what} failed: HTTP ${res.status} ${res.statusText} ${body.slice(0, 500)}`);
}

export async function getAccessToken(creds: CwsCredentials): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw await asError(res, 'token exchange');
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('token exchange returned no access_token');
  return json.access_token;
}

interface CwsItemResponse {
  uploadState?: string;
  status?: string[];
  statusDetail?: string[];
  itemError?: { error_detail?: string }[];
}

export async function uploadPackage(token: string, extensionId: string, zip: Buffer): Promise<CwsItemResponse> {
  const res = await fetch(UPLOAD_URL(extensionId), {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'content-type': 'application/zip' },
    body: new Uint8Array(zip),
  });
  if (!res.ok) throw await asError(res, 'upload');
  const json = (await res.json()) as CwsItemResponse;
  if (json.uploadState && json.uploadState !== 'SUCCESS') {
    throw new Error(`upload rejected: ${json.uploadState} ${JSON.stringify(json.itemError ?? [])}`);
  }
  return json;
}

export async function publishItem(token: string, extensionId: string, target: string): Promise<CwsItemResponse> {
  const res = await fetch(PUBLISH_URL(extensionId, target), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'content-length': '0' },
  });
  if (!res.ok) throw await asError(res, 'publish');
  return (await res.json()) as CwsItemResponse;
}

export async function getItemStatus(token: string, extensionId: string): Promise<CwsItemResponse> {
  const res = await fetch(ITEM_URL(extensionId), {
    headers: { authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
  });
  if (!res.ok) throw await asError(res, 'item status');
  return (await res.json()) as CwsItemResponse;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, { boolean: ['dry-run', 'skip-publish', 'help'] });
  if (boolFlag(args, 'help')) {
    console.log(USAGE);
    return 0;
  }
  const zipArg = stringFlag(args, 'zip');
  if (!zipArg) {
    console.error(USAGE);
    return 1;
  }
  const zipPath = path.resolve(REPO_ROOT, zipArg);
  const target = stringFlag(args, 'target') ?? 'default';
  if (target !== 'default' && target !== 'trustedTesters') {
    console.error(`cws-upload: invalid --target ${target}`);
    return 1;
  }

  let bytes: number;
  try {
    bytes = (await stat(zipPath)).size;
  } catch {
    console.error(`cws-upload: no such package: ${zipPath}`);
    return 1;
  }

  const { creds, missing } = readCredentials();
  const dryRun = boolFlag(args, 'dry-run');
  if (!creds) {
    const message = `cws-upload: missing environment variable(s): ${missing.join(', ')}`;
    if (dryRun) {
      console.warn(`${message} (dry run, continuing)`);
    } else {
      console.error(message);
      return 1;
    }
  }

  console.info(`cws-upload: package ${path.relative(REPO_ROOT, zipPath)} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`);
  console.info(`cws-upload: item ${creds?.extensionId ?? '<unset>'} publishTarget ${target}${boolFlag(args, 'skip-publish') ? ' (upload only)' : ''}`);
  if (dryRun) {
    console.info('cws-upload: dry run — no requests made.');
    return 0;
  }
  if (!creds) return 1;

  const token = await getAccessToken(creds);
  const zip = await readFile(zipPath);
  const uploaded = await uploadPackage(token, creds.extensionId, zip);
  console.info(`cws-upload: uploaded (${uploaded.uploadState ?? 'unknown state'})`);

  if (boolFlag(args, 'skip-publish')) {
    console.info('cws-upload: --skip-publish, item left as a draft.');
    return 0;
  }
  const published = await publishItem(token, creds.extensionId, target);
  console.info(`cws-upload: publish status ${(published.status ?? []).join(', ') || 'unknown'}`);
  for (const detail of published.statusDetail ?? []) console.info(`  ${detail}`);
  const failed = (published.status ?? []).some((s) => s !== 'OK' && s !== 'PUBLISHED_WITH_FRICTION_WARNING');
  return failed ? 1 : 0;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`cws-upload: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
