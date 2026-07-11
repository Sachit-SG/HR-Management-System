/**
 * Hub origin for SSO pilot logout redirect.
 * Set NEXT_PUBLIC_HUB_APP_URL on HR Vercel (e.g. https://quicktrackhub.vercel.app).
 */
export function getHubLoginUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_HUB_APP_URL?.trim();
  if (!raw) return null;

  const base = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return null;

  return `${base}/login`;
}

/** Where to send the browser after HR sign-out (Hub login when configured). */
export function getPostSignOutRedirect(fallback = "/login"): string {
  return getHubLoginUrl() ?? fallback;
}

/** Full-page redirect — use when leaving HR for Hub (cross-origin). */
export function redirectAfterSignOut(fallback = "/login"): void {
  const target = getPostSignOutRedirect(fallback);
  if (target.startsWith("http://") || target.startsWith("https://")) {
    window.location.assign(target);
    return;
  }
  window.location.assign(target);
}
