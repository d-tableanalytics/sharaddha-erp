/**
 * The automatic assignment-rule engine.
 *
 * "IF department = IT AND designation = Software Developer AND employment type
 * = full time, THEN assign IT - New Employee Onboarding."
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS HARDCODED, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * Section 11 asks for a reusable engine rather than a special case for one
 * department. So criteria are stored as DEPARTMENT IDS and enum values chosen
 * from the live catalogues: no department name, designation or path name
 * appears anywhere in this file or in the schema. Renaming a department leaves
 * every rule working, because the rule never knew the name.
 *
 * ---------------------------------------------------------------------------
 * WITHIN a criterion is OR; ACROSS criteria is AND
 * ---------------------------------------------------------------------------
 *   departments: [IT, Engineering]     -> IT *or* Engineering
 *   + employmentTypes: [full_time]     -> ...*and* full time
 *
 * That is the shape the section 11 example describes and the only one that
 * reads the way an administrator says it aloud. An empty criterion is "don't
 * care" rather than "match nothing" - the alternative makes every rule
 * unsatisfiable unless every field is filled in.
 *
 * ---------------------------------------------------------------------------
 * EVERY matching rule fires, not just the first
 * ---------------------------------------------------------------------------
 * A new developer legitimately owes the company orientation AND the IT
 * induction. `priority` orders the run so the reporting reads sensibly; it does
 * not stop later rules. First-match-wins would silently drop the second path,
 * and the symptom - "some people are missing their orientation" - is
 * miserable to diagnose.
 */

import {
  AssignmentRule,
  LearningPath,
  AcademyCourse,
} from '../../../models/hrms/AcademyModels.js';
import Employee from '../../../models/hrms/Employee.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS } from '../../../shared/constants/hrms.js';
import { RULE_RUN_CHUNK } from '../../../shared/constants/academy.js';
import { createRuleSchema, updateRuleSchema } from '../../../shared/schemas/academy.js';
import { paginationQuery } from '../../../shared/validation/common.js';
import {
  HrmsNotFoundError,
  HrmsConflictError,
  HrmsValidationError,
} from '../hrms.errors.js';
import { assignPathToEmployee, computeDueDate } from './assignment.service.js';
import {
  idStr,
  oid,
  iso,
  parse,
  escapeRegex,
  assertCanAssign,
  page,
  skipOf,
} from './academy.shared.js';

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** One criterion. Empty means "don't care"; otherwise the value must be in it. */
const criterionMatches = (allowed, value) => {
  if (!allowed || allowed.length === 0) return true;
  if (value === null || value === undefined) return false;
  return allowed.map(String).includes(String(value));
};

/**
 * Does this employee match this rule?
 *
 * PURE - no database, no clock - so it is directly testable and so the admin
 * UI's "which employees would this match" preview evaluates exactly what the
 * engine will.
 *
 * Designation is compared case-insensitively and trimmed. It is free text on
 * the employee record rather than a catalogue id, so "Software Developer" and
 * "software developer " are the same job, and a rule that failed on whitespace
 * would be an invisible bug in a compliance system.
 */
export function employeeMatchesRule(employee, rule) {
  if (!rule?.active) return false;

  if (rule.matchAll) return true;

  const c = rule.criteria ?? {};

  if (!criterionMatches(c.departmentIds, idStr(employee.departmentId))) return false;
  if (!criterionMatches(c.locationIds, idStr(employee.locationId))) return false;
  if (!criterionMatches(c.employmentTypes, employee.employmentType)) return false;

  if (c.designations?.length > 0) {
    const want = c.designations.map((d) => String(d).trim().toLowerCase());
    const have = String(employee.designation ?? '').trim().toLowerCase();
    if (!have || !want.includes(have)) return false;
  }

  return true;
}

/** The Mongo query that selects the employees a rule matches, for a backfill. */
function ruleQuery(rule) {
  const filter = { deletedAt: null, status: { $nin: ['exited', 'inactive'] } };
  if (rule.matchAll) return filter;

  const c = rule.criteria ?? {};
  if (c.departmentIds?.length) filter.departmentId = { $in: c.departmentIds.map(oid) };
  if (c.locationIds?.length) filter.locationId = { $in: c.locationIds.map(oid) };
  if (c.employmentTypes?.length) filter.employmentType = { $in: c.employmentTypes };
  if (c.designations?.length) {
    // Case-insensitive, to match `employeeMatchesRule`. Anchored and escaped so
    // a designation containing regex metacharacters cannot widen the match.
    filter.designation = {
      $in: c.designations.map((d) => new RegExp(`^${escapeRegex(String(d).trim())}$`, 'i')),
    };
  }
  return filter;
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export function toRuleDto(row) {
  return {
    id: idStr(row._id),
    name: row.name,
    pathId: idStr(row.pathId),
    pathName: row.pathName,
    matchAll: row.matchAll === true,
    criteria: {
      departmentIds: (row.criteria?.departmentIds ?? []).map(idStr),
      locationIds: (row.criteria?.locationIds ?? []).map(idStr),
      designations: row.criteria?.designations ?? [],
      employmentTypes: row.criteria?.employmentTypes ?? [],
    },
    trigger: row.trigger,
    active: row.active !== false,
    priority: row.priority,
    lastRunAt: iso(row.lastRunAt),
    lastRunAssignedCount: row.lastRunAssignedCount ?? 0,
    totalAssignedCount: row.totalAssignedCount ?? 0,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

async function resolvePath(pathId) {
  const path = await LearningPath.findOne({ _id: pathId, deletedAt: null }).lean();
  if (!path) {
    throw new HrmsValidationError('Unknown learning path.', [
      { path: 'pathId', message: 'That learning path does not exist.' },
    ]);
  }
  return path;
}

export async function listRules(actor, query) {
  assertCanAssign(actor);
  const q = parse(paginationQuery, query, 'rule query');

  const filter = { deletedAt: null };
  if (q.search) filter.name = new RegExp(escapeRegex(q.search), 'i');

  const [rows, total] = await Promise.all([
    AssignmentRule.find(filter)
      .sort({ active: -1, priority: 1, name: 1 })
      .skip(skipOf(q))
      .limit(q.pageSize)
      .lean(),
    AssignmentRule.countDocuments(filter),
  ]);

  return page(rows.map(toRuleDto), total, q);
}

export async function createRule(body, actor, context = {}) {
  assertCanAssign(actor);
  const dto = parse(createRuleSchema, body, 'assignment rule');
  const path = await resolvePath(dto.pathId);

  let row;
  try {
    row = await AssignmentRule.create({
      ...dto,
      pathName: path.name,
      createdByUserId: actor.userId ?? null,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new HrmsConflictError(`A rule called "${dto.name}" already exists.`, {
        code: 'RULE_NAME_IN_USE',
      });
    }
    throw error;
  }

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_RULE_CREATED,
    `Created assignment rule "${dto.name}" -> "${path.name}"`,
    context.req,
    {
      meta: {
        ruleId: idStr(row._id),
        pathId: idStr(path._id),
        matchAll: dto.matchAll,
        trigger: dto.trigger,
      },
    },
  );

  return toRuleDto(row.toObject());
}

export async function updateRule(id, body, actor, context = {}) {
  assertCanAssign(actor);
  const dto = parse(updateRuleSchema, body, 'assignment rule');

  const row = await AssignmentRule.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Assignment rule');

  if (dto.pathId) {
    const path = await resolvePath(dto.pathId);
    row.pathId = path._id;
    row.pathName = path.name;
  }
  for (const key of ['name', 'matchAll', 'criteria', 'trigger', 'active', 'priority']) {
    if (dto[key] !== undefined) row[key] = dto[key];
  }

  /**
   * Re-check the merged result, for the same reason `updatePath` does: a
   * partial update that only clears `criteria` would otherwise leave a rule
   * that is neither `matchAll` nor filtered - which matches every employee by
   * accident rather than by decision.
   */
  const anyCriteria = ['departmentIds', 'locationIds', 'designations', 'employmentTypes'].some(
    (k) => (row.criteria?.[k]?.length ?? 0) > 0,
  );
  if (!row.matchAll && !anyCriteria) {
    throw new HrmsValidationError(
      'A rule needs at least one criterion, or must be marked as applying to every new employee.',
      [{ path: 'criteria', message: 'Add a criterion or tick "every new employee".' }],
    );
  }
  if (row.matchAll && anyCriteria) {
    throw new HrmsValidationError('A company-wide rule cannot also filter on criteria.', [
      { path: 'matchAll', message: 'Clear the criteria, or untick "every new employee".' },
    ]);
  }

  await row.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_RULE_UPDATED,
    `Updated assignment rule "${row.name}"`,
    context.req,
    { meta: { ruleId: idStr(row._id), fields: Object.keys(dto) } },
  );

  return toRuleDto(row.toObject());
}

export async function deleteRule(id, actor, context = {}) {
  assertCanAssign(actor);

  const row = await AssignmentRule.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Assignment rule');

  row.deletedAt = new Date();
  row.active = false;
  await row.save();

  /**
   * Assignments the rule already created are LEFT ALONE.
   *
   * They are real obligations somebody may be part-way through, and deleting
   * the rule that created them is an instruction about the future. Cancelling
   * them here would erase in-flight training as a side effect of tidying up a
   * rule list.
   */
  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_RULE_DELETED,
    `Deleted assignment rule "${row.name}"`,
    context.req,
    { meta: { ruleId: idStr(row._id), assignmentsCreated: row.totalAssignedCount ?? 0 } },
  );

  return { id: idStr(row._id), deleted: true };
}

/**
 * Which employees would this rule match, without assigning anything?
 *
 * A preview, because "apply this rule to everyone" is an operation an
 * administrator should be able to see the size of before they run it.
 */
export async function previewRule(id, actor) {
  assertCanAssign(actor);

  const rule = await AssignmentRule.findOne({ _id: id, deletedAt: null }).lean();
  if (!rule) throw new HrmsNotFoundError('Assignment rule');

  const filter = ruleQuery(rule);
  const [total, sample] = await Promise.all([
    Employee.countDocuments(filter),
    Employee.find(filter).select('firstName lastName employeeCode designation').limit(10).lean(),
  ]);

  return {
    ruleId: idStr(rule._id),
    matches: total,
    sample: sample.map((e) => ({
      id: idStr(e._id),
      name: `${e.firstName} ${e.lastName}`.trim(),
      employeeCode: e.employeeCode,
      designation: e.designation ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** A path plus its live courses, ready to snapshot into an assignment. */
async function loadAssignable(pathId) {
  const path = await LearningPath.findOne({ _id: pathId, deletedAt: null, active: true }).lean();
  if (!path) return null;

  const courses = await AcademyCourse.find({ pathId: path._id, deletedAt: null, active: true })
    .sort({ order: 1 })
    .lean();

  // An empty path would create an assignment that can never complete - see
  // `createAssignments`, which refuses the same case with a message.
  if (courses.length === 0 || courses.every((c) => (c.lessons ?? []).length === 0)) return null;

  return { path, courses };
}

/**
 * Run every `on_create` rule against ONE employee.
 *
 * 🔴 THIS IS THE SECTION 2 INTEGRATION POINT. `employee.service.js#createEmployee`
 * calls it after its transaction commits.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER THROWS
 * ---------------------------------------------------------------------------
 * The same rule `notifier.service.js` applies to notifications, one layer out:
 * an employee record is a fact that has already been written and audited, and a
 * training assignment is a consequence of it. A misconfigured rule, a deleted
 * path or a database hiccup must not be the reason an HR administrator cannot
 * create an employee - especially since the failure would surface as a 500 on
 * the create form, with the employee already created.
 *
 * So everything is caught and reported in the return value, and the caller
 * logs. A missing assignment is visible and fixable from the Assignments
 * screen; a failed employee creation is neither.
 */
export async function runRulesForEmployee(employee, context = {}) {
  const outcome = { matched: 0, assigned: 0, skipped: [], errors: [] };

  try {
    const rules = await AssignmentRule.find({
      active: true,
      trigger: 'on_create',
      deletedAt: null,
    })
      .sort({ priority: 1 })
      .lean();

    if (rules.length === 0) return outcome;

    for (const rule of rules) {
      if (!employeeMatchesRule(employee, rule)) continue;
      outcome.matched += 1;

      try {
        const assignable = await loadAssignable(rule.pathId);
        if (!assignable) {
          // A rule pointing at a path that is inactive, deleted or empty. Not
          // an error the employee's creation should care about, but absolutely
          // something an administrator needs to see.
          outcome.skipped.push({
            ruleId: idStr(rule._id),
            ruleName: rule.name,
            reason: 'PATH_UNAVAILABLE',
          });
          continue;
        }

        const result = await assignPathToEmployee(
          {
            employee,
            path: assignable.path,
            courses: assignable.courses,
            dueDate: computeDueDate(assignable.path, employee),
            source: 'rule',
            rule,
            actorUserId: context.actorUserId ?? null,
          },
          context,
        );

        if (result.created) {
          outcome.assigned += 1;
          await AssignmentRule.updateOne(
            { _id: rule._id },
            {
              $set: { lastRunAt: new Date(), lastRunAssignedCount: 1 },
              $inc: { totalAssignedCount: 1 },
            },
          );
        } else {
          outcome.skipped.push({
            ruleId: idStr(rule._id),
            ruleName: rule.name,
            reason: result.reason,
          });
        }
      } catch (error) {
        outcome.errors.push({
          ruleId: idStr(rule._id),
          ruleName: rule.name,
          message: error?.message ?? String(error),
        });
      }
    }
  } catch (error) {
    outcome.errors.push({ ruleId: null, ruleName: null, message: error?.message ?? String(error) });
  }

  return outcome;
}

/**
 * Run one rule across the whole workforce.
 *
 * The backfill: a new compliance path is created, and the existing staff who
 * owe it have to be assigned. Bounded by `RULE_RUN_CHUNK` per invocation so a
 * single request cannot start an unbounded write, and it reports whether more
 * remain so the caller can run it again.
 *
 * Employees who already hold the path are skipped by `assignPathToEmployee`, so
 * running this twice is safe and the second run assigns nothing.
 */
export async function runRule(id, actor, context = {}) {
  assertCanAssign(actor);

  const rule = await AssignmentRule.findOne({ _id: id, deletedAt: null });
  if (!rule) throw new HrmsNotFoundError('Assignment rule');

  const assignable = await loadAssignable(rule.pathId);
  if (!assignable) {
    throw new HrmsConflictError(
      `"${rule.pathName}" is inactive, deleted or has no lessons, so this rule cannot assign it.`,
      { code: 'PATH_UNAVAILABLE' },
    );
  }

  const filter = ruleQuery(rule);
  const [employees, total] = await Promise.all([
    Employee.find(filter)
      .select('firstName lastName departmentId locationId designation employmentType dateOfJoining status')
      .limit(RULE_RUN_CHUNK)
      .lean(),
    Employee.countDocuments(filter),
  ]);

  let assigned = 0;
  const skipped = [];

  for (const employee of employees) {
    const result = await assignPathToEmployee(
      {
        employee,
        path: assignable.path,
        courses: assignable.courses,
        dueDate: computeDueDate(assignable.path, employee),
        source: 'rule',
        rule,
        actorUserId: actor.userId ?? null,
      },
      context,
    );

    if (result.created) assigned += 1;
    else skipped.push({ employeeId: result.employeeId, reason: result.reason });
  }

  rule.lastRunAt = new Date();
  rule.lastRunAssignedCount = assigned;
  rule.totalAssignedCount = (rule.totalAssignedCount ?? 0) + assigned;
  await rule.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_RULE_RUN,
    `Ran assignment rule "${rule.name}": ${assigned} assigned`,
    context.req,
    {
      meta: {
        ruleId: idStr(rule._id),
        pathId: idStr(rule.pathId),
        matched: employees.length,
        assigned,
        skipped: skipped.length,
        totalMatching: total,
      },
    },
  );

  return {
    ruleId: idStr(rule._id),
    matched: employees.length,
    assigned,
    skipped,
    totalMatching: total,
    /** True when the workforce is larger than one run's ceiling. */
    hasMore: total > employees.length,
  };
}

export default {
  employeeMatchesRule,
  toRuleDto,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  previewRule,
  runRulesForEmployee,
  runRule,
};
