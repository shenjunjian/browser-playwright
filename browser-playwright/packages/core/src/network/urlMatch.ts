/**
 * URL matching for page.route — string glob / RegExp / predicate.
 * Capability: in-page only; no CDP network stack.
 */

export type URLMatch =
  | string
  | RegExp
  | ((url: URL) => boolean);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a simple Playwright-style glob (`*` / `**`) to RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp("^" + re + "$");
}

export function urlMatches(
  requestUrl: string,
  match: URLMatch,
  baseURL?: string,
): boolean {
  if (typeof match === "function") {
    try {
      return match(new URL(requestUrl, baseURL));
    } catch {
      return false;
    }
  }
  if (match instanceof RegExp) return match.test(requestUrl);

  // Exact or substring for plain strings without glob chars
  if (!/[*?]/.test(match)) {
    if (requestUrl === match || requestUrl.includes(match)) return true;
    if (baseURL) {
      try {
        const absolute = new URL(match, baseURL).href;
        return requestUrl === absolute || requestUrl.includes(absolute);
      } catch {
        /* ignore */
      }
    }
    return false;
  }
  return globToRegExp(match).test(requestUrl);
}
