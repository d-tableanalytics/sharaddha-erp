/**
 * Helpers every Academy service uses.
 *
 * Factored out rather than repeated, because the six services here would
 * otherwise each grow their own `idStr`, their own permission shorthand and -
 * the one that actually matters - their own idea of what `academy/view/team`
 * means. Scope is decided once, in `assignmentScopeFilter`, and every list
 * read goes through it.
 */

import mongoose from 'mongoose';

import { hasHrmsPermission } from '../../../shared/permissions/has-permission.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from '../../../shared/permissions/constants.js';
import { formatZodIssues } from '../../../shared/validation/common.js';
import { HrmsValidationError, HrmsForbiddenError } from '../hrms.errors.js';

export const idStr = (v) => (v === null || v === undefined ? null : String(v));
export const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const iso = (v) => (v ? new Date(v).toISOString() : null);
export const isValidId = (v) => mongoose.isValidObjectId(v);

export const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const fullName = (e) => `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();

/** Parse through a shared Zod schema, or fail with the HRMS validation shape. */
export function parse(schema, input, what) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new HrmsValidationError(`Invalid ${what}.`, formatZodIssues(result.error));
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Permission shorthands
// ---------------------------------------------------------------------------

/** Authors the catalogue: paths, courses, lessons, content, assessments. */
export const canManageAcademy = (actor) =>
  hasHrmsPermission(actor, M.ACADEMY, A.EDIT, S.ORG);

/** Assigns learning paths, manually or by rule. */
export const canAssignAcademy = (actor) =>
  hasHrmsPermission(actor, M.ACADEMY, A.ASSIGN, S.ORG);

/** Sees anybody's progress. */
export const canViewOrg = (actor) => hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.ORG);

/** Sees their reports' progress. */
export const canViewTeam = (actor) => hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.TEAM);

export function assertCanManage(actor, what = 'the academy catalogue') {
  if (!canManageAcademy(actor)) {
    throw new HrmsForbiddenError(`You do not have permission to manage ${what}.`);
  }
}

export function assertCanAssign(actor) {
  if (!canAssignAcademy(actor)) {
    throw new HrmsForbiddenError('You do not have permission to assign learning paths.');
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * The query condition that limits an assignment list to what this actor may see.
 *
 * Applied as a QUERY condition rather than filtering after the fetch, so the
 * index does the work and `total` counts what the actor can actually see. The
 * employees module records the same reasoning; filtering post-fetch also makes
 * the pagination total a lie.
 *
 * Note the deliberate asymmetry with `employees`: a TEAM-scoped actor here
 * matches on the EMPLOYEE's manager chain, which means the assignment rows of
 * their reports - not rows the actor happens to have created. A manager who
 * assigned something to somebody outside their team still cannot read it back.
 *
 * @param {object} actor
 * @param {Array}  teamEmployeeIds  ids of the actor's reports, resolved by the
 *   caller. Passed in rather than queried here so one list read does one lookup.
 */
export function assignmentScopeFilter(actor, teamEmployeeIds = null) {
  if (canViewOrg(actor)) return {};

  if (canViewTeam(actor)) {
    if (!actor?.employeeId) return { _id: null };
    const me = oid(actor.employeeId);
    // Their own row plus their reports'. `teamEmployeeIds` is null when the
    // caller has not resolved the team yet, in which case self is all we can
    // safely promise - failing narrow rather than wide.
    if (!teamEmployeeIds) return { employeeId: me };
    return { employeeId: { $in: [me, ...teamEmployeeIds.map(oid)] } };
  }

  // Self baseline. Every employee holds this.
  if (hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.SELF)) {
    if (!actor?.employeeId) return { _id: null };
    return { employeeId: oid(actor.employeeId) };
  }

  throw new HrmsForbiddenError('No permission to view learning assignments.');
}

/** ResourceContext for one assignment, for a scope check against a concrete row. */
export const assignmentResource = (row) => ({
  ownerEmployeeId: idStr(row?.employeeId),
  ownerDepartmentId: idStr(row?.departmentId) ?? undefined,
  ownerManagerChain: (row?.managerChain ?? []).map(idStr),
});

/**
 * May this actor read this specific assignment?
 *
 * The resource is passed, so a `self` or `team` grant is evaluated against the
 * actual row rather than waved through - the trap `has-permission.js` documents
 * on `isSelf`, which any route carrying an id parameter has to avoid.
 */
export function assertCanViewAssignment(actor, row, managerChain = []) {
  const resource = { ...assignmentResource(row), ownerManagerChain: managerChain.map(idStr) };
  const ok =
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.ORG) ||
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.TEAM, resource) ||
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.SELF, resource);
  if (!ok) throw new HrmsForbiddenError('You cannot view this learning assignment.');
}

/**
 * Only the learner may record their own progress.
 *
 * Not "self or wider" - deliberately. An HR admin holding `academy/view/org`
 * can READ anybody's progress and must never be able to COMPLETE a lesson on
 * their behalf; section 26 asks for that explicitly, and a wider-satisfies-
 * narrower check would have quietly granted it.
 */
export function assertIsLearner(actor, row) {
  if (!actor?.employeeId || idStr(row?.employeeId) !== idStr(actor.employeeId)) {
    throw new HrmsForbiddenError('You can only record progress on your own learning.');
  }
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** The shape every paginated HRMS list returns (AD-13). */
export const page = (data, total, query) => ({
  data,
  total,
  page: query.page,
  pageSize: query.pageSize,
});

export const skipOf = (query) => (query.page - 1) * query.pageSize;

export default {
  idStr,
  oid,
  iso,
  isValidId,
  escapeRegex,
  fullName,
  parse,
  canManageAcademy,
  canAssignAcademy,
  canViewOrg,
  canViewTeam,
  assertCanManage,
  assertCanAssign,
  assignmentScopeFilter,
  assignmentResource,
  assertCanViewAssignment,
  assertIsLearner,
  page,
  skipOf,
};
