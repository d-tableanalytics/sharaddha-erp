/**
 * Employee Portal -> HRMS employee synchronisation.
 *
 * ===========================================================================
 * THE PROBLEM THIS SOLVES
 * ===========================================================================
 * HRMS could already create a portal login: `createEmployee` writes a `User`
 * and an `Employee` in one transaction, and the import pipeline does the same
 * through `linkOrCreateUser`. The other direction did not exist. An
 * administrator who added a salesperson in Admin -> User Management got an
 * account that could sign in, hold permissions and raise a PO - and no employee
 * record at all. HR then typed the same person in again, from the HRMS side,
 * and the two records agreed only for as long as nobody edited either.
 *
 * This module is that missing direction. Every portal write path that creates
 * or changes a staff account calls `syncUserSafely`, and the HRMS record
 * appears, updates or suspends to match.
 *
 * ===========================================================================
 * THE SINGLE SOURCE OF TRUTH
 * ===========================================================================
 * `User._id` <-> `Employee.userId` is the mapping, and it is the ONLY one. It
 * is already enforced in the database by the partial unique index on
 * `Employee.userId` (see models/hrms/Employee.js), so "one account resolves to
 * exactly one employee" is a fact the database guarantees rather than a rule
 * this service hopes to uphold. Duplicate prevention is therefore not a search
 * for look-alike names: it is a lookup on `userId`, and the index is what makes
 * a race between two concurrent syncs end in a duplicate-key error rather than
 * in two employees.
 *
 * `employeeCode` remains HRMS's own natural key (AD-11). An auto-created
 * record gets a generated one; an imported record keeps the code the business
 * already uses.
 *
 * Which system owns which field:
 *
 *   LOGIN EMAIL    `User.email`, held once. `Employee` does not copy it, so
 *                  there is nothing to keep in step - changing it is
 *                  `changeWorkEmail`, and both sides see the change at once.
 *   NAME           two faces of one thing. HRMS -> portal already existed
 *                  (`updateEmployee` writes `User.user`); this adds portal ->
 *                  HRMS. Last write wins, deliberately, because both screens
 *                  are editing the same person's name.
 *   STATUS         mapped both ways, through the tables below. The mappings
 *                  are deliberately NOT total inverses - see them for why.
 *   EVERYTHING     HRMS owns. Date of birth, addresses, department, manager,
 *   ELSE           compensation and the rest are only ever seeded at creation
 *                  and never overwritten afterwards, because the portal does
 *                  not collect them and an empty portal field must not erase an
 *                  HR one.
 *
 * ===========================================================================
 * WHY IT NEVER THROWS AT THE CALL SITE
 * ===========================================================================
 * `syncUserSafely` catches everything and leaves an `EmployeeSyncJob` row.
 * Same reasoning as the Academy rule engine in `employee.service.js`: the
 * account is already written and audited, and a sync failure must not fail - or
 * worse, half-fail - the request that caused it. The backlog is drained by
 * `retryFailedSyncs` and backfilled by `reconcileEmployeeRecords`, both wired
 * into server.js.
 */

import mongoose from 'mongoose';

import Employee from '../../../models/hrms/Employee.js';
import User from '../../../models/User.js';
import ArchivedUser from '../../../models/ArchivedUser.js';
import EmployeeSyncJob from '../../../models/hrms/EmployeeSyncJob.js';
import { recordAudit, recordSystemAudit } from '../../../utils/auditLog.js';
import { isDuplicateKeyError, isTransactionUnsupported } from '../../../utils/mongoSession.js';
import { isPortalOnlyRole, assertHrmsRolesAssignable } from '../../../utils/hrmsRoleGuard.js';
import { HRMS_ROLES, isHrmsRoleKey } from '../../../shared/permissions/constants.js';

// ---------------------------------------------------------------------------
// Audit actions
// ---------------------------------------------------------------------------

/**
 * Deliberately NOT added to `shared/constants/hrms.js#AUDIT_ACTIONS`.
 *
 * `shared/` is mirrored into the Customer Portal and verified by
 * `verify:contract`; these labels are an Employee Portal concern only, and the
 * employee controller already writes its own literals (`'hrms.employee.created'`)
 * rather than going through that enum.
 */
export const SYNC_AUDIT = Object.freeze({
  CREATED: 'hrms.employee.sync.created',
  UPDATED: 'hrms.employee.sync.updated',
  FAILED: 'hrms.employee.sync.failed',
  SWEEP: 'hrms.employee.sync.sweep',
});

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * The prefix for codes this module generates.
 *
 * Configurable because `employeeCode` is a business identifier: a client who
 * already numbers people `SI-0001` should not end up with two schemes. It is
 * only ever used for records the portal invents; an imported employee keeps the
 * code the business gave it.
 */
const CODE_PREFIX = String(process.env.HRMS_EMPLOYEE_CODE_PREFIX || 'EMP').trim().toUpperCase();
const CODE_WIDTH = 4;

/** Up to this many fresh codes are tried before a create gives up and requeues. */
const CODE_ATTEMPTS = 5;

/** Backoff: 1, 2, 4, 8 ... minutes, capped. Never gives up - see the model. */
const BACKOFF_BASE_MINUTES = 1;
const MAX_BACKOFF_MINUTES = 360;

/**
 * A new employee needs a `lastName`, and one-word display names are ordinary
 * ("Priya", an account called "Warehouse"). This is what goes in the field so
 * the record can be written at all, and it is visibly a placeholder so HR
 * corrects it rather than believing it.
 *
 * It is written on CREATE only. An update never replaces a real surname with
 * this - see `nameUpdateFor`.
 */
const PLACEHOLDER_LAST_NAME = '-';

/** Used when neither the display name nor the email yields anything usable. */
const PLACEHOLDER_FIRST_NAME = 'Unnamed';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const idStr = (v) => (v === null || v === undefined ? null : String(v));

const plain = (doc) => {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
};

const titleCase = (word) => word.charAt(0).toUpperCase() + word.slice(1);

const clamp = (value, max) => String(value ?? '').trim().slice(0, max);

/**
 * Run `fn` in a transaction, falling back to no session on a standalone mongod.
 *
 * A local copy rather than an import of `employee.service.js#withTransaction`,
 * on purpose. This module is called from `user.controller.js`, which is on the
 * portal's hot path; importing the employee service from there would pull the
 * whole HRMS service graph - crypto, references, RBAC - into a request that
 * only needs two models. The body is four lines and the duplication is cheaper
 * than the coupling.
 */
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } catch (err) {
    if (!isTransactionUnsupported(err)) throw err;
    // Standalone deployment: re-run unsessioned. Nothing was committed.
    return fn(null);
  } finally {
    await session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Mapping: portal account -> employee fields
// ---------------------------------------------------------------------------

/**
 * Split a portal display name into the two fields the employee record has.
 *
 * `User.user` is one free-text box ("Contact name"), and `Employee` wants a
 * first and a last name, so something has to decide where the boundary is.
 * First token / the rest is the convention the rest of the system already uses
 * in reverse - `updateEmployee` joins them back with a single space.
 *
 * When there is no display name at all the email local part is used:
 * `priya.sharma@` becomes "Priya Sharma", which is right often enough to be
 * worth doing and is corrected in one edit when it is not.
 *
 * `lastName` comes back NULL when the source yields only one word. The callers
 * differ on what to do about that, which is the whole reason it is reported
 * rather than filled in here.
 */
export function splitDisplayName(displayName, email) {
  const raw = String(displayName ?? '').replace(/\s+/g, ' ').trim();
  if (raw) {
    const parts = raw.split(' ');
    return {
      firstName: clamp(parts[0], 80),
      lastName: parts.length > 1 ? clamp(parts.slice(1).join(' '), 80) : null,
    };
  }

  const local = String(email ?? '').split('@')[0] ?? '';
  const words = local
    .split(/[._\-+]+/)
    .map((w) => w.replace(/\d+$/, ''))
    .filter(Boolean)
    .map(titleCase);

  if (words.length === 0) return { firstName: null, lastName: null };
  return {
    firstName: clamp(words[0], 80),
    lastName: words.length > 1 ? clamp(words.slice(1).join(' '), 80) : null,
  };
}

/**
 * Portal status -> employee status, for a record being CREATED.
 *
 *   Active     -> active     they are working here
 *   Inactive   -> invited    the account exists but has not been handed over.
 *                            This is the exact inverse of `createEmployee`,
 *                            which writes `status: 'Inactive'` for an employee
 *                            created as `invited`, so a record that round-trips
 *                            through both directions does not drift.
 *   Suspended  -> suspended
 */
function createStatusFor(portalStatus) {
  if (portalStatus === 'Suspended') return 'suspended';
  if (portalStatus === 'Inactive') return 'invited';
  return 'active';
}

/**
 * Portal status -> employee status, for a record that ALREADY EXISTS.
 *
 * Deliberately not the same table as `createStatusFor`, and deliberately not
 * total. The employee status carries distinctions the portal has no words for -
 * `probation`, `notice` and `exited` are all just "can sign in" or "cannot" as
 * far as a login is concerned - so a naive mapping would quietly end someone's
 * notice period because an administrator ticked a box on a different screen.
 *
 * The rule is: the portal may say WHETHER someone has access, never WHAT STAGE
 * of employment they are at.
 *
 *   Active, employee suspended or invited             -> active
 *   Active, employee anything else                    -> left alone
 *   Inactive / Suspended, employee invited or exited  -> left alone
 *   Inactive / Suspended, anything else               -> suspended
 *
 * Returns null when nothing should change.
 */
function updateStatusFor(portalStatus, currentStatus) {
  const hasAccess = portalStatus !== 'Inactive' && portalStatus !== 'Suspended';

  if (hasAccess) {
    return currentStatus === 'suspended' || currentStatus === 'invited' ? 'active' : null;
  }
  if (currentStatus === 'invited' || currentStatus === 'exited') return null;
  return currentStatus === 'suspended' ? null : 'suspended';
}

/**
 * Employee status -> portal status. The reverse direction, used by
 * `updateEmployee` so HR suspending someone in HRMS also stops them signing in.
 *
 * Returns null for the statuses a login has no opinion about.
 */
export function portalStatusForEmployeeStatus(employeeStatus) {
  if (employeeStatus === 'suspended' || employeeStatus === 'exited') return 'Suspended';
  if (employeeStatus === 'invited') return 'Inactive';
  if (['active', 'probation', 'notice'].includes(employeeStatus)) return 'Active';
  return null;
}

/**
 * Does this account need an employee record at all?
 *
 * AD-4 in its widened form: an account fenced into the CUSTOMER portal may hold
 * no HRMS role, so it certainly may not be an employee. Everybody else - Admin,
 * Sales, Management, Inventory Manager, a role a Super Admin invents next week -
 * is staff, and staff are employees.
 *
 * Asked of `isPortalOnlyRole`, which consults the compiled-in list AND the
 * `portalOnly` flag on the live `Role` document, so a role invented and fenced
 * after this was written is excluded without a code change.
 */
export function needsEmployeeRecord(user) {
  if (!user?._id) return false;
  return !isPortalOnlyRole(user.role);
}

// ---------------------------------------------------------------------------
// Employee code generation
// ---------------------------------------------------------------------------

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The next free `<PREFIX><n>` code.
 *
 * Scans the codes this module's own scheme would have produced and takes the
 * highest + 1, rather than counting rows: codes are never reused and an erased
 * employee keeps its number out of circulation only if we look at codes, so a
 * count would start handing out collisions the first time anyone was deleted.
 *
 * The regex is anchored at the start, so MongoDB can serve it from the unique
 * index on `employeeCode` rather than scanning the collection. Codes that do
 * not match the scheme - everything an import brought in - are invisible to
 * this and are left entirely alone.
 *
 * It can still lose a race, which is why the caller retries: the unique index
 * is the authority, not this function.
 */
export async function nextEmployeeCode(session = null) {
  const pattern = new RegExp(`^${escapeRegex(CODE_PREFIX)}\\d+$`);
  const query = Employee.find({ employeeCode: pattern }).select('employeeCode').lean();
  if (session) query.session(session);
  const rows = await query;

  let highest = 0;
  for (const row of rows) {
    const n = Number(String(row.employeeCode).slice(CODE_PREFIX.length));
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  return `${CODE_PREFIX}${String(highest + 1).padStart(CODE_WIDTH, '0')}`;
}

// ---------------------------------------------------------------------------
// The sync itself
// ---------------------------------------------------------------------------

/**
 * Give this account the HRMS role that makes its employee record usable.
 *
 * An employee whose login holds no `hrms_*` key has a record in the directory
 * and no way to open it: `requireHrmsAccess` refuses the whole module. Adding
 * `hrms_employee` is what `linkOrCreateUser` already does for an imported
 * employee, for the same reason, and it is purely additive - the portal role
 * (`Sales`, `Admin`) is untouched, so every existing permission check is
 * unaffected.
 *
 * `assertHrmsRolesAssignable` is called first even though `needsEmployeeRecord`
 * has already excluded portal-only roles: AD-4 has one implementation, and a
 * second path that writes `hrms_*` keys without consulting it is how a fence
 * develops a hole.
 */
async function ensureHrmsRole(user, session) {
  const current = user.roles ?? [];
  if (current.includes(HRMS_ROLES.EMPLOYEE)) return false;

  const roles = [...new Set([...current, HRMS_ROLES.EMPLOYEE])];
  assertHrmsRolesAssignable(user.role, roles);
  await User.updateOne(
    { _id: user._id },
    { $set: { roles } },
    session ? { session } : {},
  );
  return true;
}

/**
 * The name change an UPDATE should make, or null for "leave it alone".
 *
 * Two refusals, both deliberate:
 *
 *   - a display name that yields no surname never overwrites a real one.
 *     Somebody shortening "Priya Sharma" to "Priya" in their profile must not
 *     turn the employee record into "Priya -".
 *   - a name that already matches is not written, so the sync is a no-op rather
 *     than a stream of identical audit entries.
 */
function nameUpdateFor(user, employee) {
  const { firstName, lastName } = splitDisplayName(user.user, user.email);
  if (!firstName || !lastName) return null;
  if (firstName === employee.firstName && lastName === employee.lastName) return null;
  return { firstName, lastName };
}

/**
 * Create or update the HRMS employee behind one portal account.
 *
 * THROWS on failure. Almost every caller wants `syncUserSafely` instead; this
 * is exported for the backfill script, which reports failures to an operator
 * rather than queueing them, and for tests.
 *
 * @returns {Promise<{action: string, reason?: string, employeeId?: string,
 *                    employeeCode?: string, changed?: string[]}>}
 */
export async function syncUserToEmployee(userDoc, { actorUserId = null } = {}) {
  const user = plain(userDoc);
  if (!user?._id) return { action: 'skipped', reason: 'no-account' };

  if (!needsEmployeeRecord(user)) {
    return { action: 'skipped', reason: 'portal-only-role' };
  }

  /**
   * Soft-deleted rows are looked at, not filtered out.
   *
   * `Employee.alive()` would hide a deactivated employee, and the create below
   * would then fail on the unique index - which excludes nothing for
   * `deletedAt`. Worse, if it somehow succeeded it would RESURRECT someone HR
   * had deliberately off-boarded, every time their old account was touched.
   *
   * A deactivated employee is therefore the documented way to say "this account
   * is not a person": deactivate the record once, and the portal stops
   * recreating it. Service accounts and integration logins live here.
   */
  const existing = await Employee.findOne({ userId: user._id }).lean();

  if (existing?.deletedAt) {
    return {
      action: 'skipped',
      reason: 'employee-deactivated',
      employeeId: idStr(existing._id),
      employeeCode: existing.employeeCode,
    };
  }

  return existing
    ? updateExistingEmployee(user, existing, actorUserId)
    : createEmployeeForUser(user, actorUserId);
}

async function updateExistingEmployee(user, existing, actorUserId) {
  const $set = {};
  const changed = [];

  const name = nameUpdateFor(user, existing);
  if (name) {
    Object.assign($set, name);
    changed.push('name');
  }

  const status = updateStatusFor(user.status, existing.status);
  if (status && status !== existing.status) {
    $set.status = status;
    changed.push('status');
  }

  return withTransaction(async (session) => {
    const roleAdded = await ensureHrmsRole(user, session);
    if (roleAdded) changed.push('hrmsRole');

    if (Object.keys($set).length === 0) {
      return {
        action: changed.length ? 'updated' : 'noop',
        employeeId: idStr(existing._id),
        employeeCode: existing.employeeCode,
        changed,
      };
    }

    $set.updatedById = actorUserId ?? existing.updatedById ?? null;
    await Employee.updateOne(
      { _id: existing._id, deletedAt: null },
      { $set },
      session ? { session } : {},
    );

    return {
      action: 'updated',
      employeeId: idStr(existing._id),
      employeeCode: existing.employeeCode,
      changed,
    };
  });
}

async function createEmployeeForUser(user, actorUserId) {
  const split = splitDisplayName(user.user, user.email);
  const firstName = split.firstName || PLACEHOLDER_FIRST_NAME;
  const lastName = split.lastName || PLACEHOLDER_LAST_NAME;

  /**
   * Joined when the account was opened, not today.
   *
   * `dateOfJoining` is required and feeds probation windows, leave accrual and
   * tenure reports. For an account created a year ago and only now reconciled,
   * `new Date()` would say they started today and would be wrong in every one
   * of those places. `createdAt` is the best evidence the portal holds.
   */
  const dateOfJoining = user.createdAt ? new Date(user.createdAt) : new Date();

  let lastError = null;

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    try {
      /* eslint-disable no-await-in-loop -- each attempt depends on the last failing */
      const created = await withTransaction(async (session) => {
        const opts = session ? { session } : {};
        const employeeCode = await nextEmployeeCode(session);

        await ensureHrmsRole(user, session);

        const [employee] = await Employee.create(
          [
            {
              userId: user._id,
              employeeCode,
              firstName,
              lastName,
              // `User.phone` exists for customer master data and is normally
              // null on a staff account. Copied when it is there, because it is
              // the only contact detail the portal collects.
              phone: user.phone ?? null,
              dateOfJoining,
              status: createStatusFor(user.status),
              // Seeded, never derived. The portal has no concept of a
              // department, a location, a manager or an employment type, and
              // guessing one would put fiction in the org chart. HR fills them
              // in; nothing here overwrites them afterwards.
              employmentType: 'full_time',
              managerChain: [],
              createdById: actorUserId ?? null,
              updatedById: actorUserId ?? null,
            },
          ],
          opts,
        );

        return employee.toObject();
      });
      /* eslint-enable no-await-in-loop */

      return {
        action: 'created',
        employeeId: idStr(created._id),
        employeeCode: created.employeeCode,
        placeholderName: !split.firstName || !split.lastName,
      };
    } catch (err) {
      /**
       * A duplicate key here is one of two races, told apart by WHICH index
       * complained:
       *
       *   employeeCode - two syncs picked the same number. Retry; the next
       *                  scan sees the winner's row and picks the one after.
       *   userId       - another writer created this employee while we were
       *                  working. That is the invariant holding, not a failure:
       *                  the record exists, which is all the caller wanted.
       */
      if (!isDuplicateKeyError(err)) throw err;

      const onUserId = Object.keys(err.keyPattern ?? {}).includes('userId')
        || String(err.message ?? '').includes('userId');
      if (onUserId) {
        // eslint-disable-next-line no-await-in-loop
        const winner = await Employee.findOne({ userId: user._id }).select('employeeCode').lean();
        return {
          action: 'noop',
          reason: 'already-created-concurrently',
          employeeId: idStr(winner?._id),
          employeeCode: winner?.employeeCode ?? null,
        };
      }
      lastError = err;
    }
  }

  throw lastError ?? new Error('Could not allocate an employee code.');
}

// ---------------------------------------------------------------------------
// The safe wrapper, the queue, and the sweeps
// ---------------------------------------------------------------------------

const backoffFor = (attempts) => {
  const minutes = Math.min(
    BACKOFF_BASE_MINUTES * 2 ** Math.max(0, attempts - 1),
    MAX_BACKOFF_MINUTES,
  );
  return new Date(Date.now() + minutes * 60_000);
};

/**
 * Record that this account still needs an HRMS record.
 *
 * Upsert on `userId`, so a third failed attempt updates the existing row rather
 * than adding a second entry for the same person.
 */
async function enqueue(user, reason, error, actorUserId) {
  try {
    const existing = await EmployeeSyncJob.findOne({ userId: user._id }).select('attempts').lean();
    const attempts = (existing?.attempts ?? 0) + 1;

    await EmployeeSyncJob.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          email: user.email ?? null,
          displayName: user.user ?? null,
          reason,
          attempts,
          lastError: String(error?.message ?? error).slice(0, 500),
          lastAttemptAt: new Date(),
          nextAttemptAt: backoffFor(attempts),
          actorUserId: actorUserId ?? null,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (queueError) {
    // The queue is the safety net; a broken safety net must still not break the
    // request. Logged loudly because a sync backlog that cannot be recorded is
    // the one failure this module cannot recover from on its own.
    console.error('[hrms:sync] could not enqueue a failed sync:', queueError?.message ?? queueError);
  }
}

const dequeue = (userId) => EmployeeSyncJob.deleteOne({ userId }).catch(() => {});

/**
 * Sync one account, reporting rather than throwing.
 *
 * THIS IS THE FUNCTION PORTAL CODE CALLS. It is safe to `await` on a request
 * path and safe to call twice; the only thing it will not do is fail the
 * operation that triggered it.
 *
 * @param {object} userDoc            the account, as a document or a lean object
 * @param {object} [options]
 * @param {object} [options.actor]    the portal user performing the action
 * @param {object} [options.req]      Express request, for the audit trail
 * @param {string} [options.reason]   what triggered this - 'user.created', etc.
 */
export async function syncUserSafely(
  userDoc,
  { actor = null, req = null, reason = 'portal.sync' } = {},
) {
  const user = plain(userDoc);
  if (!user?._id) return { action: 'skipped', reason: 'no-account' };

  try {
    const result = await syncUserToEmployee(user, { actorUserId: actor?._id ?? null });

    // Whatever the outcome, this account no longer needs chasing: either it has
    // its record, or it is one of the kinds that should not have one.
    await dequeue(user._id);

    if (result.action === 'created') {
      await recordAudit(
        actor,
        SYNC_AUDIT.CREATED,
        `HRMS employee ${result.employeeCode} created automatically for ${user.email}`,
        req,
        {
          meta: {
            userId: idStr(user._id),
            employeeId: result.employeeId,
            employeeCode: result.employeeCode,
            trigger: reason,
            // Worth surfacing: a record carrying a placeholder surname is one
            // HR has to finish, and this is the only moment it is cheap to say.
            placeholderName: result.placeholderName ?? false,
          },
        },
      );
    } else if (result.action === 'updated' && (result.changed ?? []).length > 0) {
      await recordAudit(
        actor,
        SYNC_AUDIT.UPDATED,
        `HRMS employee ${result.employeeCode} updated from the portal (${result.changed.join(', ')})`,
        req,
        {
          meta: {
            userId: idStr(user._id),
            employeeId: result.employeeId,
            employeeCode: result.employeeCode,
            fields: result.changed,
            trigger: reason,
          },
        },
      );
    }

    return result;
  } catch (error) {
    await enqueue(user, reason, error, actor?._id ?? null);
    await recordAudit(
      actor,
      SYNC_AUDIT.FAILED,
      `HRMS employee sync failed for ${user.email}: ${error?.message ?? error}`,
      req,
      { meta: { userId: idStr(user._id), trigger: reason, error: String(error?.message ?? error) } },
    );
    console.error(`[hrms:sync] ${user.email}: ${error?.message ?? error}`);
    return { action: 'failed', reason: String(error?.message ?? error) };
  }
}

/**
 * Drain the backlog.
 *
 * Reads the account FRESH rather than trusting the queued row: by the time a
 * retry runs the account may have been renamed, suspended or deleted, and
 * syncing the state it had when it failed would write something that was never
 * true.
 *
 * An account that has vanished entirely - hard-deleted, or erased through
 * `employeeErasure` - drops out of the queue rather than retrying forever.
 */
export async function retryFailedSyncs({ limit = 50, now = new Date() } = {}) {
  const jobs = await EmployeeSyncJob.find({ nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .lean();

  const summary = {
    attempted: 0, succeeded: 0, stillFailing: 0, abandoned: 0,
  };

  for (const job of jobs) {
    summary.attempted += 1;
    /* eslint-disable no-await-in-loop -- a backlog drain is deliberately serial */
    const user = await User.findById(job.userId).lean()
      || await ArchivedUser.findById(job.userId).lean();

    if (!user) {
      await EmployeeSyncJob.deleteOne({ _id: job._id });
      summary.abandoned += 1;
      continue;
    }

    const result = await syncUserSafely(user, { reason: job.reason ?? 'sync.retry' });
    if (result.action === 'failed') summary.stillFailing += 1;
    else summary.succeeded += 1;
    /* eslint-enable no-await-in-loop */
  }

  return summary;
}

/**
 * The backstop: every staff account that has no employee record gets one.
 *
 * This is what makes the guarantee hold for accounts this module never saw -
 * everybody who existed before it was written, anyone created by a script or a
 * migration, and anyone whose sync failed so long ago that the queue row was
 * lost. "HRMS stays updated whenever an employee is added ANYWHERE in the
 * Employee Portal" is a claim about paths that do not exist yet, and only a
 * sweep over the data can keep it.
 *
 * Archived (suspended) accounts are included. A staff member suspended before
 * their record was ever created is still an employee, and leaving them out
 * would make suspension a way to disappear from the HRMS.
 *
 * @param {object}  [options]
 * @param {number}  [options.limit]   ceiling on accounts examined in one run
 * @param {boolean} [options.dryRun]  report what would change, write nothing
 */
export async function reconcileEmployeeRecords({ limit = 2000, dryRun = false } = {}) {
  const summary = {
    examined: 0, created: 0, updated: 0, skipped: 0, failed: 0, wouldCreate: [],
  };

  // Which accounts already have one. Cheaper than a lookup per user, and the
  // sweep is expected to find nothing on almost every run.
  const linked = new Set(
    (await Employee.find({ userId: { $ne: null } }).select('userId').lean())
      .map((e) => idStr(e.userId)),
  );

  const scan = async (Model) => {
    const users = await Model.find({})
      .select('_id email user role roles status phone createdAt')
      .limit(limit)
      .lean();

    for (const user of users) {
      if (summary.examined >= limit) break;
      summary.examined += 1;

      if (!needsEmployeeRecord(user) || linked.has(idStr(user._id))) {
        summary.skipped += 1;
        continue;
      }

      if (dryRun) {
        summary.wouldCreate.push({ id: idStr(user._id), email: user.email, name: user.user });
        summary.created += 1;
        continue;
      }

      /* eslint-disable-next-line no-await-in-loop -- a reconciliation is serial by design */
      const result = await syncUserSafely(user, { reason: 'sync.reconcile' });
      if (result.action === 'created') summary.created += 1;
      else if (result.action === 'updated') summary.updated += 1;
      else if (result.action === 'failed') summary.failed += 1;
      else summary.skipped += 1;
    }
  };

  await scan(User);
  await scan(ArchivedUser);

  if (!dryRun && (summary.created > 0 || summary.failed > 0)) {
    await recordSystemAudit(
      SYNC_AUDIT.SWEEP,
      `Employee sync reconciliation: ${summary.created} created, ${summary.failed} failed `
        + `(of ${summary.examined} accounts examined).`,
      summary,
    );
  }

  return summary;
}

/**
 * What should happen when a portal role change would fence an account into the
 * customer portal while it still holds HRMS roles.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FUNCTION HAD TO EXIST
 * ---------------------------------------------------------------------------
 * Auto-sync grants `hrms_employee` to every staff account, because an employee
 * record whose login holds no HRMS key is a record nobody can open. That has a
 * consequence worth naming rather than discovering: AD-4 refuses a portal-only
 * role on an account holding `hrms_*` keys, so demoting a salesperson to
 * Customer - which used to be an ordinary edit - would now 409 on every staff
 * account in the system, with a message about role keys that the administrator
 * has no screen to act on.
 *
 * So the demotion is answered properly instead:
 *
 *   A LIVE EMPLOYEE RECORD  ->  refuse, and say what to do. "This person is an
 *                               employee" is a real objection to turning them
 *                               into a customer, and deactivating the record is
 *                               the deliberate act that settles it.
 *   NO EMPLOYEE RECORD, or   ->  clear the HRMS roles as part of the same
 *   a deactivated one            change. There is nothing left for them to
 *                               reach, so holding the key is residue.
 *
 * Returns `{ action: 'none' | 'refuse' | 'clear-roles' }`.
 */
export async function resolvePortalOnlyDemotion(user, newRole) {
  const holdsHrms = (user?.roles ?? []).some(isHrmsRoleKey);
  if (!holdsHrms || !isPortalOnlyRole(newRole)) return { action: 'none' };

  const live = await Employee.findOne({ userId: user._id, deletedAt: null })
    .select('employeeCode')
    .lean();

  if (!live) return { action: 'clear-roles' };

  return {
    action: 'refuse',
    employeeCode: live.employeeCode,
    code: 'EMPLOYEE_RECORD_EXISTS',
    message:
      `This account is HRMS employee ${live.employeeCode}. An employee and a `
      + `${newRole} are mutually exclusive (AD-4), so deactivate the employee record in `
      + 'HRMS first, then change the role.',
  };
}

/** The current backlog, for the admin screen and the operator script. */
export async function listSyncFailures({ limit = 100 } = {}) {
  return EmployeeSyncJob.find({})
    .sort({ attempts: -1, updatedAt: -1 })
    .limit(limit)
    .lean();
}

export default {
  syncUserSafely,
  syncUserToEmployee,
  retryFailedSyncs,
  reconcileEmployeeRecords,
  listSyncFailures,
  needsEmployeeRecord,
  resolvePortalOnlyDemotion,
  splitDisplayName,
  nextEmployeeCode,
  portalStatusForEmployeeStatus,
  SYNC_AUDIT,
};
