/**
 * Every mutating API route is behind an authorization guard.
 *
 *   node scripts/verify-route-guards.js
 *
 * ---------------------------------------------------------------------------
 * WHY A SCRIPT AND NOT A CODE REVIEW
 * ---------------------------------------------------------------------------
 *
 * "Permissions must be enforced on the backend so users cannot bypass
 * restrictions through direct API calls" is a claim about EVERY route, and a
 * claim about every route cannot be maintained by reading diffs. The checklist
 * router is the proof: fifteen routes, seven of them writes, all behind one
 * `view_o2d` - and it passed review repeatedly, because each individual line
 * looked fine and the problem was the `router.use` four screens above it.
 *
 * A route added tomorrow with no guard is the same bug. This is what notices.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS GUARDED
 * ---------------------------------------------------------------------------
 *
 * A route is guarded when its own argument list names a guard, or when a
 * `router.use(...)` earlier in the file applies one to everything after it.
 * Guards are the four this codebase has:
 *
 *   authorize(...)         flat permission keys, OR semantics
 *   authorizeModule(...)   a matrix cell - module, sub-module, action
 *   requirePermission(...) HRMS module x action x scope
 *   requireModule(...)     HRMS module entry
 *
 * plus any local const assigned from one of them, which is how most routers
 * spell it (`const canEdit = authorizeModule('work_queue', 'tasks', 'edit')`).
 *
 * `protect` is NOT a guard. It establishes WHO you are, which is a different
 * question from what you may do, and treating it as authorization is most of
 * how this class of bug happens.
 *
 * ---------------------------------------------------------------------------
 * READS ARE REPORTED SEPARATELY, NOT IGNORED
 * ---------------------------------------------------------------------------
 *
 * An unguarded GET is usually less serious than an unguarded DELETE and is
 * sometimes correct - a health check, a public careers page. It is still listed,
 * under its own heading, because "view permission decides whether the module is
 * visible at all" is one of the rules this system is supposed to enforce.
 *
 * Exit code is 1 when any WRITE is unguarded.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MODULES_DIR = join(ROOT, 'modules');

const GUARD_FACTORIES = ['authorize', 'authorizeModule', 'requirePermission', 'requireModule'];

/**
 * Guards that are IMPORTED ready-made rather than built by a call.
 *
 * `hrmsAuthorizationChain` is `[attachHrmsActor, requireHrmsAccess]` - an array
 * the HRMS routers spread into `router.use`. It is a guard by any reasonable
 * reading, and the alias detection below cannot see it because nothing in the
 * consuming file calls a factory.
 */
const GUARD_IDENTIFIERS = ['hrmsAuthorizationChain', 'requireHrmsAccess'];
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/**
 * Routes that are deliberately not behind a permission, each with the reason.
 *
 * An allowlist rather than a silent skip: an exception nobody can see is an
 * exception nobody re-examines. Anything added here should say why in one line,
 * and should be a route that authenticates by some OTHER means or is genuinely
 * public.
 */
const ALLOWED = new Map([
  ['modules/o2d/o2d.routes.js POST /webhooks/zoho', 'HMAC over the raw body; Zoho holds no JWT'],
  ['modules/auth/auth.routes.js POST /login', 'establishes the session'],
  ['modules/auth/auth.routes.js POST /register', 'establishes the session'],
  ['modules/auth/auth.routes.js POST /forgot-password', 'pre-authentication'],
  ['modules/auth/auth.routes.js POST /reset-password', 'pre-authentication, carries its own token'],
  ['modules/auth/auth.routes.js POST /logout', 'ends the session; holding none is the point'],
  ['modules/roles/role.routes.js GET /my-access', 'reports the caller own access; every account needs it'],
  ['modules/hrms/hiring/careers.routes.js', 'the public careers site - candidates hold no account'],
  ['modules/hrms/attendance/biometric.routes.js', 'device callback, authenticated by shared secret'],

  /*
   * MOUNTED UNDER A GUARDED PARENT.
   *
   * This script reads one file at a time, so it cannot see that
   * modules/hrms/hrms.routes.js applies protect + hrmsAuthorizationChain before
   * mounting these. Both routes are additionally authorised PER OBJECT in
   * storage.service.js - `tests/hrms/storage-access.test.js` covers the owner,
   * the stranger and the payroll admin - which is the check that actually
   * matters for a file URL and which no route guard could express.
   */
  ['modules/hrms/storage/storage.routes.js', 'parent applies hrmsAuthorizationChain; per-object rules in storage.service.js'],

  /*
   * SELF-SERVICE. Authorised by IDENTITY, not by permission.
   *
   * These report or change the caller's own account, and a permission check
   * would be the wrong shape: withholding `view` for your own profile means an
   * account that cannot see its own name. `updateMe` refuses email, company,
   * role and category outright, so it cannot be used to escalate.
   */
  ['modules/auth/auth.routes.js GET /me', 'the caller own profile'],
  ['modules/auth/auth.routes.js PATCH /me', 'own display name, avatar, preferences; refuses role and email'],
  ['modules/auth/auth.routes.js PUT /me/password', 'own password, rate limited'],
  ['modules/auth/auth.routes.js POST /refresh', 'carries its own refresh token'],
]);

const isAllowed = (file, method, path) =>
  ALLOWED.has(`${file} ${method.toUpperCase()} ${path}`) || ALLOWED.has(file);

/** Every *.routes.js under modules/, recursively. */
const routeFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry.endsWith('.routes.js')) out.push(full);
  }
  return out;
};

/**
 * The balanced argument text of a call starting at `open` (the index of `(`).
 *
 * Needed because route registrations wrap across lines - a line-based grep
 * reports `router.post(` with its guard on the next line as unguarded, which is
 * a false alarm loud enough that people stop reading the output.
 */
const callArgs = (src, open) => {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
};

const analyse = (file) => {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  // Local aliases: `const canEdit = authorizeModule(...)`, and the arrays some
  // HRMS routers spread (`...hrmsAuthorizationChain`).
  const guardNames = new Set([...GUARD_FACTORIES, ...GUARD_IDENTIFIERS]);
  const aliasRe = new RegExp(
    `const\\s+([A-Za-z0-9_$]+)\\s*=\\s*(?:\\[[^\\]]*)?(?:${GUARD_FACTORIES.join('|')})\\s*\\(`,
    'g',
  );
  for (const m of src.matchAll(aliasRe)) guardNames.add(m[1]);

  // Chains declared as arrays of guards, e.g. hrmsAuthorizationChain.
  for (const m of src.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*\[([^\]]*)\]/g)) {
    if ([...guardNames].some((g) => m[2].includes(g))) guardNames.add(m[1]);
  }

  const mentionsGuard = (text) =>
    [...guardNames].some((g) => new RegExp(`\\b${g}\\b`).test(text));

  // A router-level guard applies to every route registered after it.
  let guardedFrom = Infinity;
  for (const m of src.matchAll(/router\.use\s*\(/g)) {
    const args = callArgs(src, m.index + m[0].length - 1);
    if (mentionsGuard(args)) {
      guardedFrom = Math.min(guardedFrom, m.index);
      break;
    }
  }

  const findings = [];
  const routeRe = /router\.(get|post|put|patch|delete)\s*\(/g;
  for (const m of src.matchAll(routeRe)) {
    const method = m[1];
    const args = callArgs(src, m.index + m[0].length - 1);
    const path = (args.match(/^\s*(['"`])([^'"`]*)\1/) || [])[2] ?? '?';

    if (m.index > guardedFrom) continue;
    if (mentionsGuard(args)) continue;
    if (isAllowed(rel, method, path)) continue;

    findings.push({ file: rel, method: method.toUpperCase(), path, write: WRITE_METHODS.has(method) });
  }
  return findings;
};

/**
 * The scan, importable so a real test (tests/route-guards.test.js) can assert
 * on it directly and run automatically under `npm test`, instead of this only
 * ever running when someone remembers `npm run verify:guards` by hand.
 */
export const auditRoutes = () => {
  const all = routeFiles(MODULES_DIR).flatMap(analyse);
  return { writes: all.filter((f) => f.write), reads: all.filter((f) => !f.write) };
};

const print = (title, rows) => {
  console.log(`\n${title} (${rows.length})`);
  console.log('-'.repeat(title.length + 6));
  if (!rows.length) {
    console.log('  none');
    return;
  }
  for (const r of rows) console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(40)} ${r.file}`);
};

// CLI entry point only - importing this module for `auditRoutes` (as the test
// does) must not also run the report and call process.exit.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const { writes, reads } = auditRoutes();

  console.log('\n============================================================');
  console.log(' Route guard audit');
  console.log('============================================================');
  print('UNGUARDED WRITES', writes);
  print('UNGUARDED READS', reads);

  console.log('\n============================================================');
  if (writes.length) {
    console.log(` FAIL — ${writes.length} mutating route(s) with no authorization guard`);
    console.log('============================================================\n');
    process.exit(1);
  }
  console.log(' PASS — every mutating route is behind a guard');
  console.log('============================================================\n');
}
