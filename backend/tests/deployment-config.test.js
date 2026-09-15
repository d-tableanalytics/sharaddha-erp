/**
 * The two settings a split-host deployment gets wrong, and how.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE DESERVE TESTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * Both failures are SILENT. Neither throws, neither logs an error, and both
 * present to the user as something other than what they are:
 *
 *   a `SameSite=Strict` cookie on a cross-site deployment is never sent, and
 *     the symptom is "the app signs me out every fifteen minutes" — the API
 *     only ever sees a request with no cookie on it;
 *
 *   an origin missing from the CORS list is refused by the browser, not by the
 *     server, so the server log said nothing at all until the refusal was made
 *     to log itself.
 *
 * A test that boots the app and asserts the resulting header is the only thing
 * that catches either before a deploy does.
 */

import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { once } from 'node:events';

import { refreshCookieOptions, clearRefreshCookieOptions } from '../utils/tokens.js';

// ---------------------------------------------------------------------------
// The refresh cookie
// ---------------------------------------------------------------------------

const ENV_KEYS = ['NODE_ENV', 'CROSS_SITE_COOKIES'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Set exactly the vars under test, clearing the rest. */
const withEnv = (env) => {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
};

describe('refresh cookie across deployment shapes', () => {
  test('same-site stays Strict — the split-host flag changes nothing by default', () => {
    withEnv({ NODE_ENV: 'production' });
    const options = refreshCookieOptions();

    // The AD-14 arrangement is still the default and still the better one.
    assert.equal(options.sameSite, 'strict');
    assert.equal(options.secure, true);
  });

  test('development is Strict and not Secure, so http://localhost still works', () => {
    withEnv({});
    const options = refreshCookieOptions();

    assert.equal(options.sameSite, 'strict');
    assert.equal(options.secure, false);
  });

  test('cross-site switches to None, which is what makes Vercel + Render work', () => {
    withEnv({ NODE_ENV: 'production', CROSS_SITE_COOKIES: 'true' });
    const options = refreshCookieOptions();

    assert.equal(options.sameSite, 'none');
  });

  test('None is ALWAYS paired with Secure, even outside production', () => {
    /*
     * The invariant that matters most. Browsers reject `SameSite=None` without
     * `Secure` outright — the cookie is not stored at all — so the half-right
     * combination is strictly worse than either whole one. `secure` is
     * therefore derived from the flag, not only from NODE_ENV.
     */
    withEnv({ CROSS_SITE_COOKIES: 'true' });
    const options = refreshCookieOptions();

    assert.equal(options.sameSite, 'none');
    assert.equal(options.secure, true, 'SameSite=None without Secure is silently discarded');
  });

  test('only the exact string "true" turns it on', () => {
    // A stray "1", "yes" or "false" must not half-enable a security-relevant
    // change — it falls back to the safer setting.
    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      withEnv({ NODE_ENV: 'production', CROSS_SITE_COOKIES: value });
      assert.equal(
        refreshCookieOptions().sameSite, 'strict',
        `CROSS_SITE_COOKIES=${JSON.stringify(value)} must not enable cross-site cookies`,
      );
    }
  });

  test('the clear options still match the set options, or the cookie cannot be deleted', () => {
    withEnv({ NODE_ENV: 'production', CROSS_SITE_COOKIES: 'true' });
    const { maxAge, ...set } = refreshCookieOptions();
    void maxAge;

    // A cookie is removed only by a Set-Cookie whose attributes match. If
    // sameSite/secure/path drift apart, logout leaves the cookie in place.
    assert.deepEqual(clearRefreshCookieOptions(), set);
  });
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/**
 * The origin resolver from app.js, rebuilt over a given environment.
 *
 * Duplicated rather than imported because `app.js` reads the environment once
 * at module load and pulls in every route, model and cron in the process. This
 * keeps the LOGIC under test — the parsing and the refusal mode — without
 * booting the application eleven times.
 *
 * It is kept honest by `mirrors app.js` below, which fails if the two drift.
 */
function buildOrigins(env) {
  const allowed = [
    ...String(env.CORS_ORIGINS ?? '').split(','),
    env.FRONTEND_URL ?? '',
  ]
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (allowed.length === 0) allowed.push('http://localhost:5174');
  return allowed;
}

/** Start a throwaway app with just the CORS middleware mounted. */
async function serveWith(env) {
  const allowed = buildOrigins(env);
  const app = express();
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowed.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }));
  app.get('/health', (req, res) => res.status(200).json({ ok: true }));

  const server = app.listen(0);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/health`;
  return {
    url,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const ask = async (env, origin) => {
  const { url, close } = await serveWith(env);
  try {
    const res = await fetch(url, origin ? { headers: { Origin: origin } } : undefined);
    return {
      status: res.status,
      allowOrigin: res.headers.get('access-control-allow-origin'),
      credentials: res.headers.get('access-control-allow-credentials'),
    };
  } finally {
    await close();
  }
};

describe('CORS origins', () => {
  test('the configured frontend is allowed, with credentials', async () => {
    const res = await ask({ FRONTEND_URL: 'https://app.vercel.app' }, 'https://app.vercel.app');

    assert.equal(res.allowOrigin, 'https://app.vercel.app');
    // Without this the browser discards the response of any credentialed call.
    assert.equal(res.credentials, 'true');
  });

  test('a second origin can be added without losing the first', async () => {
    // The Vercel preview / custom-domain case: more than one origin is real.
    const env = {
      FRONTEND_URL: 'https://app.vercel.app',
      CORS_ORIGINS: 'https://portal.example.com, https://preview-xyz.vercel.app',
    };

    for (const origin of [
      'https://app.vercel.app',
      'https://portal.example.com',
      'https://preview-xyz.vercel.app',
    ]) {
      assert.equal((await ask(env, origin)).allowOrigin, origin, `${origin} must be allowed`);
    }
  });

  test('a trailing slash in configuration still matches', async () => {
    // `Origin` headers never carry one, so a pasted URL with a slash would
    // otherwise match nothing — and the resulting CORS error names an origin
    // that looks identical to the one configured.
    const res = await ask({ FRONTEND_URL: 'https://app.vercel.app/' }, 'https://app.vercel.app');
    assert.equal(res.allowOrigin, 'https://app.vercel.app');
  });

  test('an unknown origin is refused by OMITTING the header, not by a 500', async () => {
    /*
     * The regression this guards: the old code passed an Error to the cors
     * callback, which reached the global error handler and turned every
     * cross-origin probe into a 500. That is a misleading status for the caller
     * and noise in the logs that reads like the API is broken.
     */
    const res = await ask({ FRONTEND_URL: 'https://app.vercel.app' }, 'https://evil.example.com');

    assert.equal(res.status, 200, 'the request itself is fine; the BROWSER blocks the read');
    assert.equal(res.allowOrigin, null, 'no allow-origin header means no cross-origin read');
  });

  test('a request with no Origin is allowed — health checks are not browsers', async () => {
    // Render probes /health with no Origin header. Refusing those would fail
    // every deploy.
    const res = await ask({ FRONTEND_URL: 'https://app.vercel.app' }, null);
    assert.equal(res.status, 200);
  });

  test('configuring an origin does not silently also trust localhost', async () => {
    const res = await ask({ FRONTEND_URL: 'https://app.vercel.app' }, 'http://localhost:5174');
    assert.equal(res.allowOrigin, null);
  });

  test('with nothing configured, development localhost still works', async () => {
    const res = await ask({}, 'http://localhost:5174');
    assert.equal(res.allowOrigin, 'http://localhost:5174');
  });

  test('mirrors app.js — the parsing under test is the parsing that ships', async () => {
    /*
     * `buildOrigins` above is a copy, and a copy is a promise to keep two things
     * in step by hand. This reads the real file and asserts the distinctive
     * parts are still there, so a change to app.js that this file does not
     * follow fails here rather than passing against a stale duplicate.
     */
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

    assert.match(source, /process\.env\.CORS_ORIGINS/, 'app.js must read CORS_ORIGINS');
    assert.match(source, /replace\(\/\\\/\+\$\/, ''\)/, 'app.js must strip trailing slashes');
    assert.match(source, /callback\(null, false\)/, 'app.js must refuse without throwing');
    assert.doesNotMatch(
      source,
      /callback\(new Error\('Not allowed by CORS'\)\)/,
      'passing an Error turns a cross-origin probe into a 500',
    );
  });
});
