/** Hostname helpers shared by compiler and runtime. No regex on the hot path. */

/** `a.b.example.com` → ['a.b.example.com', 'b.example.com', 'example.com', 'com'] */
export function hostnameWalk(hostname: string): string[] {
  const out: string[] = [];
  let h = hostname;
  for (;;) {
    out.push(h);
    const i = h.indexOf('.');
    if (i === -1) break;
    h = h.slice(i + 1);
  }
  return out;
}

/** True if `hostname` equals `domain` or is a subdomain of it. */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  if (hostname === domain) return true;
  return hostname.length > domain.length && hostname.endsWith(domain) && hostname[hostname.length - domain.length - 1] === '.';
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i;

export function isValidHostname(h: string): boolean {
  return HOSTNAME_RE.test(h);
}

/** Whether a URL is one the extension can act on (http/https/ws/wss). */
export function isWebUrl(url: string): boolean {
  return /^(https?|wss?):\/\//i.test(url);
}
