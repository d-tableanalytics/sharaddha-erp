/**
 * Where the API lives, resolved once for every service that talks to it.
 *
 * ---------------------------------------------------------------------------
 * THREE CASES, AND THE MIDDLE ONE IS THE POINT
 * ---------------------------------------------------------------------------
 *
 *   VITE_API_URL unset        → http://localhost:5000, the dev default. The
 *                               Vite dev server and the API are separate
 *                               processes on separate ports, so a relative URL
 *                               would hit the dev server and 404.
 *
 *   VITE_API_URL = ""         → SAME ORIGIN. The bundle carries no hostname at
 *                               all and calls `/api/v1/...` relative to
 *                               whatever it was served from.
 *
 *   VITE_API_URL = "https://…" → that origin, trailing slashes trimmed.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EMPTY CASE HAD TO BE ADDED
 * ---------------------------------------------------------------------------
 *
 * `VITE_API_URL || 'http://localhost:5000'` treated "" as "unset", so there was
 * no way to ask for a relative base — every production build baked an absolute
 * origin into the JavaScript.
 *
 * That is fine until the origin moves, which it does exactly once and at the
 * worst moment: a deployment reachable at `http://<ip>:8080` today and at
 * `https://erp.example.com` the day DNS lands. A baked-in origin means the
 * bundle must be rebuilt and redeployed at cutover, and if anyone forgets, the
 * SPA keeps calling the old address and every request fails CORS — which reads
 * as "the server is down", not as "the frontend is stale".
 *
 * Behind a reverse proxy that serves the SPA and proxies `/api/` on one origin,
 * relative is also simply correct: it cannot disagree with where the page came
 * from, and it removes CORS from the picture entirely rather than configuring
 * around it.
 */

const DEV_FALLBACK = "http://localhost:5000";

const raw = import.meta.env.VITE_API_URL;

/**
 * The origin, or "" for same-origin.
 *
 * `undefined` is "nobody configured this" and `""` is "configured, as
 * same-origin" — a distinction `||` cannot make, which is why this is an
 * explicit check rather than a default parameter.
 */
export const API_ORIGIN =
  raw === undefined || raw === null ? DEV_FALLBACK : String(raw).trim().replace(/\/+$/, "");

/** What axios should be given as `baseURL`. Relative when same-origin. */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

export default API_BASE_URL;
