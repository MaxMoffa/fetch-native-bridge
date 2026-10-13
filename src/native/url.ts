/**
 * Minimal URL parsing for allow-list checks. React Native's built-in `URL` polyfill does not
 * implement `origin`/`hostname`/`pathname` on older versions, so we parse by hand.
 */

export type UrlPattern = string | RegExp;
export type UrlMatcher = ReadonlyArray<UrlPattern> | ((url: string) => boolean);

interface ParsedUrl {
  origin: string;
  path: string;
}

const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443' };
const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;

/** Resolves "." / ".." segments the way fetch will, so "/v1/../admin" can't escape a prefix. */
function normalizePath(path: string): string {
  const segments = path.replace(/\\/g, '/').replace(/%2e/gi, '.').split('/');
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '..') out.pop();
    else if (segment !== '.') out.push(segment);
    const isLast = i === segments.length - 1;
    if (isLast && (segment === '.' || segment === '..')) out.push('');
  }
  return `/${out.join('/')}`;
}

export function parseUrl(url: string): ParsedUrl | null {
  const match = URL_RE.exec(url.trim().replace(/\\/g, '/'));
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  // Strip credentials: "https://user:pass@host" must not be compared on the userinfo part.
  let host = match[2].slice(match[2].lastIndexOf('@') + 1).toLowerCase();
  const portMatch = /:(\d+)$/.exec(host);
  if (portMatch && DEFAULT_PORTS[scheme] === portMatch[1]) host = host.slice(0, -portMatch[0].length);
  if (!host) return null;
  return { origin: `${scheme}://${host}`, path: normalizePath(match[3] || '/') };
}

function matchesString(url: ParsedUrl, pattern: string): boolean {
  const p = parseUrl(pattern);
  if (!p || p.origin !== url.origin) return false;
  if (p.path === '/' || p.path === '') return true;
  // "https://api.example.com/v1" allows "/v1" and "/v1/…", not "/v10".
  const base = p.path.endsWith('/') ? p.path : `${p.path}/`;
  return url.path === p.path || url.path.startsWith(base);
}

/**
 * String patterns match by origin and path prefix (on segment boundaries);
 * RegExp patterns are tested against the full URL.
 */
export function matchesUrl(url: string, matcher: UrlMatcher): boolean {
  if (typeof matcher === 'function') return matcher(url) === true;
  const parsed = parseUrl(url);
  for (const pattern of matcher) {
    if (typeof pattern === 'string') {
      if (parsed && matchesString(parsed, pattern)) return true;
    } else {
      pattern.lastIndex = 0;
      if (pattern.test(url)) return true;
    }
  }
  return false;
}

/** Without an explicit allow-list only plain http(s) URLs may be fetched. */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^/?#]/i.test(url.trim());
}
