/**
 * The absolute origin an email links back to, e.g. `https://app.shraddhaimpex.net`.
 *
 * A mail is read outside the browser, so its link has to be absolute. A relative
 * `/hrms/inbox` pasted into an email has no host to resolve against and goes
 * nowhere. So when the preferred variable (`APP_BASE_URL`, `EMPLOYEE_PORTAL_URL`)
 * is unset, this falls back to `FRONTEND_URL`, the portal's canonical origin. That
 * is what `.env.example` has always said these variables do.
 *
 * Returns '' when neither is set. Callers then leave the link out instead of
 * sending a broken one. Trailing slashes are trimmed so `${origin}${path}` never
 * produces `//`.
 *
 * Read at call time, not import time, so a deploy's `--update-env` and the tests'
 * env stubs both take effect.
 */
export function portalOrigin(preferred) {
  for (const value of [process.env[preferred], process.env.FRONTEND_URL]) {
    const origin = String(value ?? '').trim().replace(/\/+$/, '');
    if (origin) return origin;
  }
  return '';
}

/** `origin + path`, or null when there is no origin to make it absolute. */
export function portalLink(preferred, path) {
  const origin = portalOrigin(preferred);
  if (!origin || !path) return null;
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}
