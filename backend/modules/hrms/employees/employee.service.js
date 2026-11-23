/**
 * Employee Master business logic.
 *
 * Ported from the reference's `employees.service.ts`, rule for rule. Where a
 * rule changed, the reason is stated at the point of change rather than in a
 * summary somewhere else.
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';

import Employee from '../../../models/hrms/Employee.js';
import EmployeeCustomField from '../../../models/hrms/EmployeeCustomField.js';
import Department from '../../../models/hrms/Department.js';
import Location from '../../../models/hrms/Location.js';
import User from '../../../models/User.js';
import ArchivedUser from '../../../models/ArchivedUser.js';
import Delegation from '../../../models/Delegation.js';
import { hashPassword } from '../../../utils/password.js';
import { isDuplicateKeyError, isTransactionUnsupported } from '../../../utils/mongoSession.js';
import { hasHrmsPermission } from '../../../shared/permissions/has-permission.js';
import { assertHrmsRolesAssignable } from '../../../utils/hrmsRoleGuard.js';
import {
  customRoleKeysForUser,
  resolveCustomRoleKeys,
  setCustomRolesForUser,
} from '../rbac/customRole.service.js';
import { requiresOptions } from '../../../shared/schemas/employee.js';
// The status mapping lives with the rest of the portal <-> HRMS translation,
// so the two directions cannot disagree about what `suspended` means.
import { portalStatusForEmployeeStatus } from './employeeSync.service.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
  HRMS_ROLES as R,
  isHrmsRoleKey,
  HRMS_ROLE_LIST,
} from '../../../shared/permissions/constants.js';
import {
  decryptField,
  maskSensitiveValue,
  sanitiseCustomFields,
} from '../../../utils/hrms/crypto/index.js';
import { SENSITIVE_EMPLOYEE_FIELD_LIST } from '../../../shared/security/sensitive-fields.js';
import { encPath } from '../../../models/hrms/plugins/sensitiveFields.js';
import { buildSensitiveUpdate } from './sensitiveUpdate.js';
import { describe as describeReferences, resolveDepartment, resolveLocation } from '../references/reference.service.js';
import {
  assertNoCycle,
  computeManagerChain,
  rebuildDescendantChains,
} from './managerChain.js';
import {
  HrmsConflictError,
  HrmsForbiddenError,
  HrmsNotFoundError,
  HrmsNotImplementedError,
  HrmsValidationError,
} from '../hrms.errors.js';
import { actOnAccountProblem, keysBeyond, isUnrestricted } from '../../../utils/accessGuard.js';
import { resolveUserPermissions } from '../../../utils/roleResolver.js';

const idStr = (v) => (v === null || v === undefined ? null : String(v));
const toDate = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
const toDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Add N calendar months, matching the reference's `addMonths`. */
const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

/**
 * Run `fn` in a transaction, falling back to no session on a standalone mongod.
 *
 * The portal's established pattern — see `utils/mongoSession.js`. Employee
 * creation writes a User AND an Employee, so a partial failure would otherwise
 * leave an orphaned login with no employee record.
 *
 * Exported for employeeErasure.js, which deletes across the same two
 * collections and many more.
 */
export async function withTransaction(fn) {
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
// Serialization
// ---------------------------------------------------------------------------

/**
 * The wire shape of an employee.
 *
 * Sensitive fields are reported as PRESENCE only — `true` when a value is on
 * file, `null` when it is not. Never the value, never the ciphertext, never the
 * blind index. Revealing one is a separate, audited call.
 */
export function toEmployeeDto(row, { user, manager, department, location } = {}) {
  const sensitive = Object.fromEntries(
    SENSITIVE_EMPLOYEE_FIELD_LIST.map((f) => [f, row[encPath(f)] ? true : null]),
  );

  return {
    id: idStr(row._id),
    userId: idStr(row.userId),
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
    email: user?.email ?? null,
    personalEmail: row.personalEmail ?? null,
    phone: row.phone ?? null,
    phone2: row.phone2 ?? null,
    dateOfBirth: toDay(row.dateOfBirth),
    dateOfJoining: toDay(row.dateOfJoining),
    employmentType: row.employmentType,
    designation: row.designation ?? null,
    status: row.status,
    probationMonths: row.probationMonths ?? null,
    probationStartDate: toDay(row.probationStartDate),
    probationEndDate: toDay(row.probationEndDate),
    confirmedAt: row.confirmedAt ? new Date(row.confirmedAt).toISOString() : null,
    noticeStartDate: toDay(row.noticeStartDate),
    noticeMonths: row.noticeMonths ?? null,
    noticeEndDate: toDay(row.noticeEndDate),
    departmentId: idStr(row.departmentId),
    /**
     * Resolved SERVER-side, and deliberately not left to the browser.
     *
     * The reference's profile loads the whole department catalogue and does
     * `departments.data?.find(d => d.id === data.departmentId)` to get a name -
     * one extra round trip per profile view, and a display name the client
     * supplies rather than one the server vouches for.
     *
     * A retired department still resolves here. An employee assigned to one
     * before it was retired is still assigned to it, and rendering a blank
     * where a name used to be reads as a bug rather than as history.
     */
    departmentName: department?.name ?? null,
    locationId: idStr(row.locationId),
    locationName: location?.name ?? null,
    reportingManagerId: idStr(row.reportingManagerId),
    reportingManagerName: manager
      ? `${manager.firstName ?? ''} ${manager.lastName ?? ''}`.trim()
      : null,
    fatherName: row.fatherName ?? null,
    motherName: row.motherName ?? null,
    permanentAddress: row.permanentAddress ?? null,
    temporaryAddress: row.temporaryAddress ?? null,
    emergencyContacts: row.emergencyContacts ?? [],
    dependents: row.dependents ?? [],
    customFieldValues: row.customFieldValues ?? {},
    ...sensitive,
    // Derived, exposed read-only so the UI can show a reporting line.
    managerChain: (row.managerChain ?? []).map(idStr),
  };
}

/** Batch-load the users and managers a page of rows needs. Avoids N+1. */
async function hydrate(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const userIds = list.map((r) => r.userId).filter(Boolean);
  const managerIds = list.map((r) => r.reportingManagerId).filter(Boolean);
  const departmentIds = list.map((r) => r.departmentId).filter(Boolean);
  const locationIds = list.map((r) => r.locationId).filter(Boolean);

  // Four batched lookups for a whole page, not four per row. The catalogue
  // queries carry no `deletedAt` filter on purpose: this resolves names for
  // DISPLAY, and an employee assigned to a since-retired department still needs
  // that department's name. Validation is a different question, and
  // `assertReferencesResolve` answers it through the providers, which are
  // strictly live.
  const [users, managers, departments, locations] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } }).select('email user').lean()
      : [],
    managerIds.length
      ? Employee.find({ _id: { $in: managerIds } }).select('firstName lastName').lean()
      : [],
    departmentIds.length
      ? Department.find({ _id: { $in: departmentIds } }).select('name').lean()
      : [],
    locationIds.length
      ? Location.find({ _id: { $in: locationIds } }).select('name').lean()
      : [],
  ]);

  const userById = new Map(users.map((u) => [idStr(u._id), u]));
  const managerById = new Map(managers.map((m) => [idStr(m._id), m]));
  const departmentById = new Map(departments.map((d) => [idStr(d._id), d]));
  const locationById = new Map(locations.map((l) => [idStr(l._id), l]));

  return list.map((row) =>
    toEmployeeDto(row, {
      user: userById.get(idStr(row.userId)),
      manager: managerById.get(idStr(row.reportingManagerId)),
      department: departmentById.get(idStr(row.departmentId)),
      location: locationById.get(idStr(row.locationId)),
    }),
  );
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * The scope filter for a list read.
 *
 * Applied as a QUERY condition rather than filtering after the fetch, so the
 * index does the work and pagination counts what the actor can actually see.
 * Filtering post-fetch would also make `total` a lie.
 */
function buildScopeFilter(actor) {
  if (hasHrmsPermission(actor, M.EMPLOYEES, A.VIEW, S.ORG)) return {};

  if (hasHrmsPermission(actor, M.EMPLOYEES, A.VIEW, S.TEAM)) {
    // In the actor's team means the actor is anywhere in the employee's chain —
    // which is exactly what the denormalised array is for.
    if (!actor.employeeId) return { _id: null }; // matches nothing
    const me = new mongoose.Types.ObjectId(String(actor.employeeId));
    return { $or: [{ _id: me }, { managerChain: me }] };
  }

  if (hasHrmsPermission(actor, M.EMPLOYEES, A.VIEW, S.SELF)) {
    if (!actor.employeeId) return { _id: null };
    return { _id: new mongoose.Types.ObjectId(String(actor.employeeId)) };
  }

  throw new HrmsForbiddenError('No permission to list employees.');
}

const resourceOf = (row) => ({
  ownerUserId: idStr(row.userId),
  ownerEmployeeId: idStr(row._id),
  ownerDepartmentId: idStr(row.departmentId) ?? undefined,
  ownerManagerChain: (row.managerChain ?? []).map(idStr),
});

function assertCanView(actor, row) {
  const ctx = resourceOf(row);
  const ok =
    hasHrmsPermission(actor, M.EMPLOYEES, A.VIEW, S.ORG) ||
    hasHrmsPermission(actor, M.EMPLOYEES, A.VIEW, S.TEAM, ctx) ||
    hasHrmsPermission(actor, M.EMPLOYEES, A.VIEW, S.SELF, ctx);
  if (!ok) throw new HrmsForbiddenError('Cannot view this employee.');
}

function assertCanEdit(actor, row) {
  const ctx = resourceOf(row);
  const ok =
    hasHrmsPermission(actor, M.EMPLOYEES, A.EDIT, S.ORG) ||
    hasHrmsPermission(actor, M.EMPLOYEES, A.EDIT, S.SELF, ctx);
  if (!ok) throw new HrmsForbiddenError('Cannot edit this employee.');
}

// ---------------------------------------------------------------------------
// Reference validation (AD-2 removed the foreign keys)
// ---------------------------------------------------------------------------

/**
 * Verify department and location ids resolve.
 *
 * When Org Structure is not built, supplying one of these is REFUSED with a 503
 * rather than stored unvalidated. There are no foreign keys, so an unchecked id
 * becomes a dangling reference nothing will ever catch — and "the module does
 * not exist yet" is a far more useful answer than a broken link discovered
 * months later. Leaving them null is always fine.
 */
async function assertReferencesResolve({ departmentId, locationId }) {
  const wired = describeReferences();

  if (departmentId) {
    if (!wired.department) {
      throw new HrmsNotImplementedError(
        'Assigning a department',
        'Org Structure is not built yet, so a department cannot be validated. Leave it empty for now.',
      );
    }
    if (!(await resolveDepartment(departmentId))) {
      throw new HrmsValidationError('departmentId does not exist.');
    }
  }

  if (locationId) {
    if (!wired.location) {
      throw new HrmsNotImplementedError(
        'Assigning a location',
        'Org Structure is not built yet, so a location cannot be validated. Leave it empty for now.',
      );
    }
    if (!(await resolveLocation(locationId))) {
      throw new HrmsValidationError('locationId does not exist.');
    }
  }
}

async function assertManagerExists(reportingManagerId) {
  if (!reportingManagerId) return;
  const mgr = await Employee.findOne({ _id: reportingManagerId, deletedAt: null })
    .select('_id')
    .lean();
  if (!mgr) throw new HrmsValidationError('reportingManagerId does not exist.');
}


// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listEmployees(actor, query) {
  const scope = buildScopeFilter(actor);

  const filter = {
    deletedAt: null,
    ...scope,
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.managerId ? { reportingManagerId: query.managerId } : {}),
  };

  if (query.search) {
    // Anchored regex on the fields the reference searches. Escaped, because an
    // unescaped user string is both a correctness bug and a ReDoS risk.
    const safe = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    const matchingUsers = await User.find({ email: rx }).select('_id').lean();
    filter.$and = [
      {
        $or: [
          { firstName: rx },
          { lastName: rx },
          { employeeCode: rx },
          ...(matchingUsers.length
            ? [{ userId: { $in: matchingUsers.map((u) => u._id) } }]
            : []),
        ],
      },
    ];
  }

  if (query.roleKey) {
    const users = await User.find({ roles: query.roleKey }).select('_id').lean();
    filter.userId = { $in: users.map((u) => u._id) };
  }

  // The reference orders by status then first name; an explicit sort overrides.
  const sort = query.sortBy
    ? { [query.sortBy]: query.sortDir === 'desc' ? -1 : 1 }
    : { status: 1, firstName: 1 };

  const skip = (query.page - 1) * query.pageSize;

  const [rows, total] = await Promise.all([
    Employee.find(filter).sort(sort).skip(skip).limit(query.pageSize).lean(),
    Employee.countDocuments(filter),
  ]);

  return {
    data: await hydrate(rows),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getEmployee(id, actor) {
  const row = await Employee.findOne({ _id: id, deletedAt: null }).lean();
  if (!row) throw new HrmsNotFoundError('Employee');

  // Second line of defence. The route guard checks scope too, but a direct
  // service call from a job or a test must not slip past.
  assertCanView(actor, row);

  const [dto] = await hydrate([row]);
  return dto;
}

/**
 * Reveal ONE sensitive value in full.
 *
 * Deliberately separate from the read, deliberately one field at a time, and
 * deliberately audited by the caller. Requires `employees:compensation:view:org`
 * — the narrowest permission that fits, and one only payroll admin and super
 * admin hold.
 */
export async function revealSensitiveField(id, field, actor) {
  if (!hasHrmsPermission(actor, M.EMPLOYEES_COMPENSATION, A.VIEW, S.ORG)) {
    throw new HrmsForbiddenError(
      'Viewing a full PAN, bank account or government identifier requires compensation access.',
    );
  }
  if (!SENSITIVE_EMPLOYEE_FIELD_LIST.includes(field)) {
    throw new HrmsValidationError(`"${field}" is not a sensitive employee field.`);
  }

  const row = await Employee.findOne({ _id: id, deletedAt: null })
    .select(`employeeCode ${encPath(field)}`)
    .lean();
  if (!row) throw new HrmsNotFoundError('Employee');

  const envelope = row[encPath(field)];
  if (!envelope) return { field, value: null, masked: null };

  const value = await decryptField(envelope);
  return { field, value, masked: maskSensitiveValue(value) };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create an employee, its login, and its HRMS roles.
 *
 * Returns the record plus a one-time temporary password, exactly as the
 * reference does, so an administrator can hand it over. It is never stored in
 * plaintext and never logged.
 */
export async function createEmployee(dto, actor) {
  if (!hasHrmsPermission(actor, M.EMPLOYEES, A.CREATE, S.ORG)) {
    throw new HrmsForbiddenError('Cannot create employees.');
  }

  // AD-4: an employee's login is never a Customer account.
  const roleKeys = dto.initialRoleKeys?.length ? dto.initialRoleKeys : ['hrms_employee'];
  const unknown = roleKeys.filter((k) => !HRMS_ROLE_LIST.includes(k));
  if (unknown.length > 0) {
    throw new HrmsValidationError(`Unknown HRMS role key(s): ${unknown.join(', ')}`);
  }
  if (!roleKeys.every(isHrmsRoleKey)) {
    throw new HrmsValidationError('Only HRMS roles can be granted here.');
  }

  await assertReferencesResolve(dto);
  await assertManagerExists(dto.reportingManagerId);

  // AD-10 / AD-11: strip reserved keys out of the blob IN MEMORY, before
  // anything is assembled for persistence. A later cleanup would leave the
  // plaintext in the oplog, on every replica, and in any backup taken between.
  const { clean: customFieldValues, extracted } = sanitiseCustomFields(dto.customFieldValues);
  const sensitiveInput = { ...extracted, ...pickSensitive(dto) };
  assertCanWriteSensitive(actor, sensitiveInput); // HA1

  const tempPassword = crypto.randomBytes(9).toString('base64url'); // ~12 chars
  const passwordHash = await hashPassword(tempPassword);

  const joining = toDate(dto.dateOfJoining);
  const probationStart = toDate(dto.probationStartDate) ?? joining;
  const probationMonths = dto.probationMonths ?? 3;

  const created = await withTransaction(async (session) => {
    const opts = session ? { session } : {};

    const [user] = await User.create(
      [
        {
          email: dto.email,
          password: passwordHash,
          user: `${dto.firstName} ${dto.lastName}`,
          // A portal role is required by the schema; staff are not Customers,
          // and this is the neutral non-Customer value (AD-4).
          role: 'Management',
          roles: roleKeys,
          status: dto.status === 'invited' ? 'Inactive' : 'Active',
        },
      ],
      opts,
    ).catch((err) => {
      if (isDuplicateKeyError(err)) {
        throw new HrmsConflictError('That email address is already in use.', {
          code: 'EMAIL_IN_USE',
        });
      }
      throw err;
    });

    const managerChain = await computeManagerChain(dto.reportingManagerId ?? null);
    const sensitive = await buildSensitiveUpdate(sensitiveInput);

    const [employee] = await Employee.create(
      [
        {
          userId: user._id,
          employeeCode: dto.employeeCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          personalEmail: dto.personalEmail ?? null,
          phone: dto.phone ?? null,
          phone2: dto.phone2 ?? null,
          dateOfBirth: toDate(dto.dateOfBirth),
          dateOfJoining: joining,
          employmentType: dto.employmentType,
          designation: dto.designation ?? null,
          status: dto.status,
          probationMonths,
          probationStartDate: probationStart,
          probationEndDate:
            toDate(dto.probationEndDate) ?? addMonths(probationStart, probationMonths),
          departmentId: dto.departmentId ?? null,
          locationId: dto.locationId ?? null,
          reportingManagerId: dto.reportingManagerId ?? null,
          managerChain,
          noticeStartDate: toDate(dto.noticeStartDate),
          noticeMonths: dto.noticeMonths ?? null,
          noticeEndDate: toDate(dto.noticeEndDate),
          fatherName: dto.fatherName ?? null,
          motherName: dto.motherName ?? null,
          permanentAddress: dto.permanentAddress ?? null,
          temporaryAddress: dto.temporaryAddress ?? null,
          emergencyContacts: dto.emergencyContacts ?? [],
          dependents: dto.dependents ?? [],
          customFieldValues,
          createdById: actor.userId,
          updatedById: actor.userId,
          ...sensitive,
        },
      ],
      opts,
    ).catch(async (err) => {
      if (isDuplicateKeyError(err)) {
        throw new HrmsConflictError('That employee code is already in use.', {
          code: 'EMPLOYEE_CODE_IN_USE',
        });
      }
      throw err;
    });

    return employee.toObject();
  });

  const [employee] = await hydrate([created]);

  /**
   * ---------------------------------------------------------------------------
   * SI ACADEMY: automatic learning-path assignment
   * ---------------------------------------------------------------------------
   * The new employee's attributes are matched against the Academy assignment
   * rules, and every rule that matches assigns its learning path. Nothing about
   * a department or a designation is hardcoded - rules store department IDS and
   * enum values chosen from the live catalogues, so this works for IT, Sales,
   * HR and anything created next week without a code change.
   *
   * AFTER the transaction, and NEVER able to fail it. `runRulesForEmployee`
   * catches everything and reports it in its return value, for the same reason
   * `notifier.service.js` swallows a failed notification: the employee record
   * is a fact that has already been written and audited, and a training
   * assignment is a consequence of it. A misconfigured rule must not be why an
   * HR administrator cannot create an employee - especially since the request
   * would fail with the employee already created, leaving them to wonder
   * whether to try again.
   *
   * A missing assignment is visible and repairable from the Academy
   * Assignments screen. A half-created employee is neither.
   *
   * Imported lazily so that importing the employee service from a script or a
   * test does not pull in the whole Academy module - the same reason
   * hrms.bootstrap.js registers behaviour explicitly rather than as an import
   * side effect.
   */
  let academy = null;
  try {
    const { runRulesForEmployee } = await import('../academy/rule.service.js');
    academy = await runRulesForEmployee(created, {
      actorUserId: actor.userId ?? null,
    });
    if (academy.errors.length > 0) {
      console.error(
        '[hrms:academy] assignment rules reported errors for a new employee:',
        academy.errors,
      );
    }
  } catch (error) {
    // Belt and braces: runRulesForEmployee already catches, so reaching here
    // means the module itself failed to load. Still not the employee's problem.
    console.error('[hrms:academy] rule engine unavailable:', error?.message ?? error);
  }

  return { employee, tempPassword, academy };
}

/**
 * HA1: writing a sensitive identifier or bank field needs the same authority
 * that writes compensation (employees:compensation:edit:org, the gate payroll
 * uses for /compensation writes). There is no approval flow for bank changes,
 * so an employee cannot change their own bank details directly either.
 *
 * Exported for the import persistence port, which writes the same fields.
 */
export function assertCanWriteSensitive(actor, sensitiveInput, { isSelf = false } = {}) {
  const fields = Object.keys(sensitiveInput ?? {}).filter((f) =>
    SENSITIVE_EMPLOYEE_FIELD_LIST.includes(f),
  );
  if (fields.length === 0) return;
  if (hasHrmsPermission(actor, M.EMPLOYEES_COMPENSATION, A.EDIT, S.ORG)) return;
  throw new HrmsForbiddenError(
    isSelf
      ? `Your ${fields.join(', ')} cannot be changed from your profile. Ask payroll to update it.`
      : `Changing ${fields.join(', ')} needs compensation (payroll) authority.`,
    { code: 'SENSITIVE_WRITE_FORBIDDEN' },
  );
}

/** The sensitive values present on a payload, without touching the others. */
function pickSensitive(dto) {
  const out = {};
  for (const f of SENSITIVE_EMPLOYEE_FIELD_LIST) {
    if (f in dto) out[f] = dto[f];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** Job fields a regular employee may not change on their own record. */
const JOB_FIELDS = [
  'employmentType',
  'designation',
  'departmentId',
  'locationId',
  'reportingManagerId',
  'status',
];

export async function updateEmployee(id, dto, actor) {
  const existing = await Employee.findOne({ _id: id, deletedAt: null }).lean();
  if (!existing) throw new HrmsNotFoundError('Employee');

  assertCanEdit(actor, existing);

  const isSelf = idStr(existing._id) === idStr(actor.employeeId);
  const hasOrgEdit = hasHrmsPermission(actor, M.EMPLOYEES, A.EDIT, S.ORG);

  // Nobody signs off their own probation. HR holds employees:edit:org, so
  // without this they could quietly extend or end their own probation window.
  const touchingProbation =
    dto.probationMonths !== undefined ||
    dto.probationStartDate !== undefined ||
    dto.probationEndDate !== undefined;
  if (touchingProbation && isSelf && !actor.roleKeys.includes(R.SUPER_ADMIN)) {
    throw new HrmsForbiddenError('Only a super admin can change your own probation window.');
  }

  // An employee editing their own profile may change personal details only.
  // employees:edit:self is in the baseline, so without this an employee could
  // promote themselves by editing their own designation or manager.
  if (isSelf && !hasOrgEdit) {
    for (const field of JOB_FIELDS) {
      if (dto[field] !== undefined) {
        throw new HrmsForbiddenError(
          `Only HR, a recruiter or a super admin can change ${field}.`,
        );
      }
    }
  }

  await assertReferencesResolve(dto);

  const managerChanged =
    dto.reportingManagerId !== undefined &&
    idStr(dto.reportingManagerId) !== idStr(existing.reportingManagerId);

  if (managerChanged) {
    await assertManagerExists(dto.reportingManagerId);
    // The correction the reference lacks entirely.
    await assertNoCycle(idStr(existing._id), dto.reportingManagerId ?? null);
  }

  const { clean: cleanCustom, extracted } = dto.customFieldValues
    ? sanitiseCustomFields(dto.customFieldValues)
    : { clean: undefined, extracted: {} };

  const sensitiveInput = { ...extracted, ...pickSensitive(dto) };
  // HA1: bank/PAN/Aadhaar/UAN/ESI/passport are compensation data. Reading them
  // already needs employees:compensation, so writing them (where a changed
  // bank account redirects salary) must too - employees:edit is not enough.
  assertCanWriteSensitive(actor, sensitiveInput, { isSelf });

  const sensitive = await buildSensitiveUpdate(sensitiveInput, { employeeId: existing._id });

  const $set = { updatedById: actor.userId, ...sensitive };

  const DIRECT_FIELDS = [
    'firstName', 'lastName', 'personalEmail', 'phone', 'phone2',
    'employmentType', 'designation', 'status',
    'departmentId', 'locationId', 'reportingManagerId',
    'probationMonths', 'noticeMonths',
    'fatherName', 'motherName', 'permanentAddress', 'temporaryAddress',
    'emergencyContacts', 'dependents',
  ];
  for (const f of DIRECT_FIELDS) {
    if (dto[f] !== undefined) $set[f] = dto[f];
  }

  for (const f of [
    'dateOfBirth', 'probationStartDate', 'probationEndDate',
    'noticeStartDate', 'noticeEndDate',
  ]) {
    if (dto[f] !== undefined) $set[f] = toDate(dto[f]);
  }

  if (cleanCustom !== undefined) $set.customFieldValues = cleanCustom;

  if (managerChanged) {
    $set.managerChain = await computeManagerChain(dto.reportingManagerId ?? null);
  }

  const updated = await withTransaction(async (session) => {
    const opts = session ? { session } : {};

    const row = await Employee.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set },
      { new: true, runValidators: true, ...opts },
    ).lean();

    // Keep the login's display name in step with the employee's name. An
    // employee with no login has no display name to keep in step.
    if (existing.userId && (dto.firstName !== undefined || dto.lastName !== undefined || dto.displayName)) {
      const displayName =
        dto.displayName ??
        `${dto.firstName ?? existing.firstName} ${dto.lastName ?? existing.lastName}`.trim();
      await User.updateOne({ _id: existing.userId }, { $set: { user: displayName } }, opts);
    }

    /**
     * HRMS -> portal, the other half of requirement 5.
     *
     * This used to read `dto.status === 'inactive'`, and `inactive` IS NOT AN
     * EMPLOYEE STATUS: `EMPLOYEE_STATUSES` is invited / active / probation /
     * notice / exited / suspended, and the zod enum refuses anything else. The
     * condition could therefore never be true, so suspending an employee from
     * the HRMS side left their login working - the only path that actually
     * suspended an account was `deactivateEmployee`.
     *
     * `portalStatusForEmployeeStatus` is the mapping, and it is deliberately
     * partial: it answers for the statuses a LOGIN has an opinion about and
     * returns null otherwise. Moving someone between `active`, `probation` and
     * `notice` all mean "still working here", so the account is left alone
     * rather than rewritten on every HR edit.
     *
     * Sessions are revoked only on the way DOWN. Re-activating somebody has no
     * reason to sign anyone out, and revoking there would log out the HR
     * administrator making the change if they happened to be editing their own
     * record.
     */
    const statusChanged = dto.status !== undefined && dto.status !== existing.status;
    if (existing.userId && statusChanged) {
      const portalStatus = portalStatusForEmployeeStatus(dto.status);
      if (portalStatus) {
        const revoking = portalStatus !== 'Active';
        await User.updateOne(
          { _id: existing.userId },
          {
            $set: {
              status: portalStatus,
              ...(revoking ? { refreshTokenHash: null, refreshSessions: [] } : {}),
            },
          },
          opts,
        );
      }
    }

    // Descendants inherit a new prefix. Skipping this is the silent RBAC bug:
    // a manager stops being able to see their own reports.
    if (managerChanged) {
      await rebuildDescendantChains(id, { session });
    }

    return row;
  });

  const [dto2] = await hydrate([updated]);
  return dto2;
}

// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------

/**
 * Soft delete, matching the reference exactly.
 *
 * A hard delete would strand attendance, leave and payroll rows that reference
 * this employee, and AD-2 has no cascade to catch it. The record is marked
 * `exited`, its login is suspended, and its sessions are revoked.
 *
 * Direct reports block the operation: removing a middle manager would orphan
 * everyone under them and leave their chains pointing at a deleted row.
 */
export async function deactivateEmployee(id, actor) {
  if (!hasHrmsPermission(actor, M.EMPLOYEES, A.DELETE, S.ORG)) {
    throw new HrmsForbiddenError('Cannot deactivate employees.');
  }

  const existing = await Employee.findOne({ _id: id, deletedAt: null }).lean();
  if (!existing) throw new HrmsNotFoundError('Employee');

  const reports = await Employee.countDocuments({
    reportingManagerId: id,
    deletedAt: null,
  });
  if (reports > 0) {
    throw new HrmsConflictError(
      `This employee has ${reports} direct report${reports === 1 ? '' : 's'}. Reassign them first.`,
      { code: 'HAS_DIRECT_REPORTS' },
    );
  }

  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    await Employee.updateOne(
      { _id: id },
      { $set: { deletedAt: new Date(), status: 'exited', updatedById: actor.userId } },
      opts,
    );
    // Nothing to suspend when there is no login. The employee record is still
    // marked exited, which is what every other module reads.
    if (existing.userId) {
      await User.updateOne(
        { _id: existing.userId },
        { $set: { status: 'Suspended', refreshTokenHash: null, refreshSessions: [] } },
        opts,
      );
    }
  });

  return { id: idStr(id), employeeCode: existing.employeeCode };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function getEmployeeRoles(id, actor) {
  if (!hasHrmsPermission(actor, M.EMPLOYEES, A.EDIT, S.ORG)) {
    throw new HrmsForbiddenError('Only org-level editors can view role assignments.');
  }
  const emp = await Employee.findOne({ _id: id, deletedAt: null }).select('userId').lean();
  if (!emp) throw new HrmsNotFoundError('Employee');

  // Roles live on the account, so an employee with no login holds none. That is
  // an empty list, not an error: the screen shows "no roles" rather than
  // failing to load.
  if (!emp.userId) return { roleKeys: [], customRoleKeys: [] };

  const user = await User.findById(emp.userId).select('roles role').lean();

  /*
   * Two lists, because they are stored in two places and for a reason.
   *
   * The eight built-in keys live in `User.roles[]`, which both portals
   * validate against a fixed allow-list. Custom role keys cannot go there -
   * that validation would reject them - so they live in `hrms_user_roles`.
   * Reporting them separately also lets the screen show which grants come from
   * code and which from a role somebody built.
   */
  return {
    roleKeys: (user?.roles ?? []).filter(isHrmsRoleKey),
    customRoleKeys: await customRoleKeysForUser(emp.userId),
  };
}

export async function assignEmployeeRoles(id, roleKeys, actor, portalActor = null) {
  if (!hasHrmsPermission(actor, M.EMPLOYEES, A.EDIT, S.ORG)) {
    throw new HrmsForbiddenError('Only org-level editors can change role assignments.');
  }

  /*
   * One list in, two destinations out.
   *
   * A key is either one of the eight built-in roles or the key of a custom
   * role somebody built in Settings. `resolveCustomRoleKeys` refuses anything
   * that is neither, BEFORE any write happens - validating after the first
   * write is how half an assignment lands.
   */
  const builtInKeys = roleKeys.filter((k) => HRMS_ROLE_LIST.includes(k));
  const customKeys = roleKeys.filter((k) => !HRMS_ROLE_LIST.includes(k));
  await resolveCustomRoleKeys(customKeys);

  /*
   * A custom role EXTENDS HRMS access; it cannot be the whole of it.
   *
   * Custom grants are unioned onto the actor after the AD-4 choke point has
   * already decided whether this account reaches HRMS at all (see
   * rbac/customRole.middleware.js), so an account holding nothing but a custom
   * role would be refused at the door and its grants would never be consulted.
   * Refusing here, with the reason, is the alternative to that surfacing later
   * as a 403 nobody can explain.
   */
  if (customKeys.length > 0 && builtInKeys.length === 0) {
    throw new HrmsValidationError(
      'A custom role extends a built-in HRMS role rather than replacing it. Assign at least one built-in role as well.',
    );
  }

  const emp = await Employee.findOne({ _id: id, deletedAt: null }).select('userId').lean();
  if (!emp) throw new HrmsNotFoundError('Employee');

  // A role is a grant on an ACCOUNT. Granting one to an employee who cannot
  // sign in would write nothing and report success, so it is refused with the
  // reason rather than silently ignored.
  if (!emp.userId) {
    throw new HrmsValidationError(
      'This employee has no portal login, so there is nothing to grant a role to. Give them a login first.',
    );
  }

  const user = await User.findById(emp.userId).select('role roles extraGrants status').lean();
  if (!user) throw new HrmsNotFoundError('Employee login');

  /*
   * NO ESCALATION THROUGH HRMS ROLES.
   *
   * The route asks only for org-level employee edit, which hr_admin and
   * recruiter hold - so either could hand themselves (or a friend)
   * hrms_super_admin, and with it every HRMS power including password resets.
   * Three rules, the same ones utils/accessGuard.js applies to portal roles:
   *   - you cannot change your OWN HRMS roles;
   *   - you cannot grant an HRMS role you do not hold yourself;
   *   - an account with full portal access is changed only by a Super Admin.
   * An HRMS super admin is exempt from the first two, as a portal Super Admin is.
   */
  if (!actor.roleKeys.includes(R.SUPER_ADMIN)) {
    if (String(emp.userId) === String(actor.userId)) {
      throw new HrmsForbiddenError('You cannot change your own HRMS roles. Ask another administrator.');
    }
    const current = (user.roles ?? []).filter(isHrmsRoleKey);
    const beyond = builtInKeys.filter((k) => !current.includes(k) && !actor.roleKeys.includes(k));
    if (beyond.length) {
      throw new HrmsForbiddenError(`You cannot grant HRMS roles you do not hold yourself: ${beyond.join(', ')}.`);
    }
  }
  if (portalActor) {
    const blocked = actOnAccountProblem(portalActor, user);
    if (blocked) throw new HrmsForbiddenError(blocked.message);
  }

  // AD-4, checked here as well as in the schema hook: findOneAndUpdate does not
  // run document validation, so this is the real control on this path.
  // The LIVE portal-only question, not the literal name 'Customer': a role a
  // Super Admin invented and marked portalOnly is as fenced as a Customer is.
  assertHrmsRolesAssignable(user.role, builtInKeys);

  // Replace only the HRMS half; portal roles on the same account are untouched.
  const portalRoles = (user.roles ?? []).filter((k) => !isHrmsRoleKey(k));
  await User.updateOne({ _id: emp.userId }, { $set: { roles: [...portalRoles, ...builtInKeys] } });

  // Custom roles live in their own collection - see getEmployeeRoles above for
  // why they cannot share `User.roles[]`.
  const customRoleKeys = await setCustomRolesForUser(emp.userId, customKeys);

  return { roleKeys: builtInKeys, customRoleKeys };
}

/**
 * Issue a fresh temporary password.
 *
 * Super admin only, as in the reference. Revokes live sessions, and returns the
 * plaintext ONCE — it is never stored or logged.
 */
export async function resetEmployeePassword(id, actor, portalActor = null) {
  if (!actor.roleKeys.includes(R.SUPER_ADMIN)) {
    throw new HrmsForbiddenError('Only a super admin can reset an employee password.');
  }

  const emp = await Employee.findOne({ _id: id, deletedAt: null }).select('userId').lean();
  if (!emp) throw new HrmsNotFoundError('Employee');

  // Without this the update would match nothing and an administrator would be
  // handed a password for an account that does not exist.
  if (!emp.userId) {
    throw new HrmsValidationError(
      'This employee has no portal login, so there is no password to reset.',
    );
  }

  /*
   * A reset hands the plaintext password to the person asking: it is signing in
   * as the employee. So it is refused for the asker's own account (they have
   * Change Password on their profile) and for an account that holds ANY portal
   * access the asker does not - a Super Admin, an Admin, an Accounts login.
   * HR still resets everyone at or below its own access; anything above goes
   * to an administrator who holds it.
   */
  if (String(emp.userId) === String(actor.userId)) {
    throw new HrmsForbiddenError('Use Change Password on your profile to change your own password.');
  }
  if (portalActor && !isUnrestricted(portalActor)) {
    const target = await User.findById(emp.userId).select('role extraGrants status').lean();
    if (target) {
      const blocked = actOnAccountProblem(portalActor, target);
      if (blocked) throw new HrmsForbiddenError(blocked.message);
      if (keysBeyond(portalActor, resolveUserPermissions(target)).length) {
        throw new HrmsForbiddenError(
          'This login has access you do not hold, so its password can only be reset by an administrator who does.',
        );
      }
    }
  }

  const tempPassword = crypto.randomBytes(9).toString('base64url');
  await User.updateOne(
    { _id: emp.userId },
    { $set: { password: await hashPassword(tempPassword), refreshTokenHash: null, refreshSessions: [] } },
  );

  return { tempPassword };
}

// ---------------------------------------------------------------------------
// Work email
// ---------------------------------------------------------------------------

/**
 * Change an employee's work email.
 *
 * The work email is not stored on the employee: it is the login account's
 * `User.email`, and every screen, report and notification reads it from there.
 * So changing it in that ONE place is what makes the new address show up
 * everywhere in the ERP.
 *
 * What it deliberately leaves alone:
 *   - the password - the employee signs in with the new address and the SAME
 *     password;
 *   - live sessions - access and refresh tokens carry the account id, not the
 *     email, so nobody is signed out;
 *   - roles, status and every field of the employee record.
 *
 * The one denormalised copy of a user's email in the database - the snapshot
 * on Delegation `inLoop[]` entries - is brought in step in the same
 * transaction, so a task's collaborator list does not keep the old address.
 *
 * A suspended login lives in `archivedusers`, not `users`. Its email is changed
 * there, so the new address applies when the account is restored.
 */
export async function changeWorkEmail(id, newEmail, actor, portalActor = null) {
  if (!hasHrmsPermission(actor, M.EMPLOYEES, A.EDIT, S.ORG)) {
    throw new HrmsForbiddenError('Only HR or an administrator can change a work email.');
  }

  const email = String(newEmail ?? '').trim().toLowerCase();
  if (!email) throw new HrmsValidationError('A work email is required.');

  const emp = await Employee.findOne({ _id: id, deletedAt: null }).lean();
  if (!emp) throw new HrmsNotFoundError('Employee');

  if (!emp.userId) {
    throw new HrmsValidationError(
      'This employee has no portal login, so there is no work email to change.',
    );
  }

  const live = await User.findById(emp.userId).select('email role extraGrants status').lean();
  const archived = live
    ? null
    : await ArchivedUser.findById(emp.userId).select('email role extraGrants status').lean();
  const account = live ?? archived;
  if (!account) throw new HrmsNotFoundError('Employee login');

  // The same rule the Users screen applies: an account with full system
  // access is changed only by someone who holds it too. Without this, HR could
  // re-point a Super Admin's sign-in address.
  if (portalActor) {
    const blocked = actOnAccountProblem(portalActor, account);
    if (blocked) throw new HrmsForbiddenError(blocked.message);
  }

  const previousEmail = account.email ?? null;

  if (email !== previousEmail) {
    // Duplicates are checked across BOTH collections. The unique index on
    // `users` cannot see a suspended account parked in the archive, and
    // restoring that account later would then collide.
    const [clash, archivedClash] = await Promise.all([
      User.exists({ email, _id: { $ne: emp.userId } }),
      ArchivedUser.exists({ email, _id: { $ne: emp.userId } }),
    ]);
    if (clash || archivedClash) {
      throw new HrmsConflictError('That email address is already in use.', {
        code: 'EMAIL_IN_USE',
      });
    }

    await withTransaction(async (session) => {
      const opts = session ? { session } : {};

      const Model = live ? User : ArchivedUser;
      await Model.updateOne(
        { _id: emp.userId },
        // Only the email. Password, sessions, roles and status are untouched.
        { $set: { email } },
        { runValidators: true, ...opts },
      ).catch((err) => {
        // The unique index is the last word on a race between two edits.
        if (isDuplicateKeyError(err)) {
          throw new HrmsConflictError('That email address is already in use.', {
            code: 'EMAIL_IN_USE',
          });
        }
        throw err;
      });

      await Delegation.updateMany(
        { 'inLoop.userId': emp.userId },
        { $set: { 'inLoop.$[p].email': email } },
        { arrayFilters: [{ 'p.userId': emp.userId }], ...opts },
      );

      await Employee.updateOne(
        { _id: emp._id },
        { $set: { updatedById: actor.userId } },
        opts,
      );
    });
  }

  const row = await Employee.findById(emp._id).lean();
  const [employee] = await hydrate([row]);
  // A suspended login is not in `users`, so hydrate cannot see it.
  if (!live) employee.email = email;

  return { employee, previousEmail, changed: email !== previousEmail };
}

// ---------------------------------------------------------------------------
// Custom field definitions
// ---------------------------------------------------------------------------

export async function listCustomFields() {
  const rows = await EmployeeCustomField.find({}).sort({ order: 1, createdAt: 1 }).lean();
  return rows.map((r) => ({
    id: idStr(r._id),
    name: r.name,
    label: r.label,
    type: r.type,
    options: r.options ?? [],
    required: r.required,
    order: r.order,
  }));
}

const customFieldShape = (row) => ({
  id: idStr(row._id),
  name: row.name,
  label: row.label,
  type: row.type,
  options: row.options ?? [],
  required: row.required,
  order: row.order,
});

export async function createCustomField(dto) {
  try {
    const row = await EmployeeCustomField.create(dto);
    return customFieldShape(row);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new HrmsConflictError('A custom field with that name already exists.');
    }
    throw err;
  }
}

export async function updateCustomField(id, dto) {
  const existing = await EmployeeCustomField.findById(id).lean();
  if (!existing) throw new HrmsNotFoundError('Custom field');

  /*
   * The MERGED document has to satisfy the options rule, not just the payload.
   *
   * `updateCustomFieldSchema` catches `{type:'select', options:[]}` sent
   * together, but it cannot judge `{type:'select'}` on its own - whether that
   * is legal depends on what is already stored. Checking the merge is what
   * closes the remaining path to an optionless dropdown, and it is checked
   * HERE rather than by the model because `findByIdAndUpdate` does not run
   * document `pre('validate')` hooks.
   */
  const merged = { ...existing, ...dto };
  if (requiresOptions(merged.type) && (merged.options ?? []).length === 0) {
    throw new HrmsValidationError(`A "${merged.type}" field needs at least one option.`);
  }

  const row = await EmployeeCustomField.findByIdAndUpdate(id, { $set: dto }, {
    new: true,
    runValidators: true,
  }).lean();
  if (!row) throw new HrmsNotFoundError('Custom field');
  return customFieldShape(row);
}

/**
 * Retire a definition.
 *
 * Existing VALUES are deliberately left on their employee records, matching the
 * reference: HR keeps the historical data after a field is withdrawn.
 */
export async function deleteCustomField(id) {
  const row = await EmployeeCustomField.findByIdAndDelete(id).lean();
  if (!row) throw new HrmsNotFoundError('Custom field');
}

export default {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  revealSensitiveField,
  getEmployeeRoles,
  assignEmployeeRoles,
  resetEmployeePassword,
  changeWorkEmail,
  listCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  toEmployeeDto,
};
