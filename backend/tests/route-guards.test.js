/**
 * Route guard coverage, wired into `npm test`.
 *
 * backend/scripts/verify-route-guards.js already does this scan and has done
 * since before this file existed - but only when someone runs
 * `npm run verify:guards` by hand. Nothing in this repository's test suite,
 * CI, or deploy pipeline ran it automatically, so it could go exactly as
 * stale as the bug it exists to catch: a route added tomorrow with no guard
 * is unguarded until someone happens to run the script again.
 *
 * This is the single highest-value test in the suite for the same reason the
 * script's own docblock gives: a permission claim is a claim about EVERY
 * route, and that cannot be maintained by reading diffs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { auditRoutes } from '../scripts/verify-route-guards.js';

test('every mutating route across the portal and HRMS routers is behind an authorization guard', () => {
  const { writes } = auditRoutes();
  assert.deepEqual(
    writes,
    [],
    `${writes.length} unguarded write route(s): ${writes
      .map((w) => `${w.method} ${w.path} (${w.file})`)
      .join(', ')}`,
  );
});

/**
 * The manual script reports unguarded reads separately and does not fail its
 * own exit code on them (an unguarded GET is sometimes correct - a health
 * check, a public careers page - and both are already named in its ALLOWED
 * list). But "view permission decides whether a module is visible at all" is
 * still one of the rules this system is supposed to enforce, so the test
 * suite holds reads to the same bar the script's own doc comment describes,
 * without changing the script's documented CLI contract for anyone invoking
 * it directly.
 */
test('every read route across the portal and HRMS routers is behind an authorization guard', () => {
  const { reads } = auditRoutes();
  assert.deepEqual(
    reads,
    [],
    `${reads.length} unguarded read route(s): ${reads
      .map((w) => `${w.method} ${w.path} (${w.file})`)
      .join(', ')}`,
  );
});
