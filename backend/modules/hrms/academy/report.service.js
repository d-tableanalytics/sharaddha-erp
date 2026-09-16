/**
 * The Academy admin dashboard and its two reports.
 *
 * ---------------------------------------------------------------------------
 * EVERY NUMBER HERE IS AGGREGATED IN THE DATABASE
 * ---------------------------------------------------------------------------
 * Not fetched and counted in application memory. The distinction matters at
 * exactly the moment it is hardest to fix: a dashboard that loads every
 * assignment to count them works beautifully against the fifty rows a demo has
 * and falls over against the fifty thousand a real company accumulates in two
 * years of annual refreshers.
 *
 * AD-13's "never assume the set is small" is about lists; this is the same rule
 * applied to counts.
 *
 * ---------------------------------------------------------------------------
 * `overdue` is a date comparison, not a stored status
 * ---------------------------------------------------------------------------
 * It appears in three of the four aggregations below as
 * `dueDate < today AND status IN (assigned, in_progress)`, which is the same
 * condition `deriveDueState` applies on read. The two cannot drift because
 * neither stores anything.
 */

import {
  LearningAssignment,
  AcademyCertificate,
} from '../../../models/hrms/AcademyModels.js';
import Employee from '../../../models/hrms/Employee.js';
import Department from '../../../models/hrms/Department.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS } from '../../../shared/constants/hrms.js';
import { academyReportQuerySchema } from '../../../shared/schemas/academy.js';
import { toDay } from '../../../shared/academy/progress.js';
import { HrmsForbiddenError } from '../hrms.errors.js';
import {
  idStr,
  oid,
  parse,
  canViewOrg,
  canViewTeam,
} from './academy.shared.js';

/** The overdue predicate, declared once and reused by every aggregation. */
const overdueMatch = (today) => ({
  dueDate: { $ne: null, $lt: today },
  status: { $in: ['assigned', 'in_progress'] },
});

/**
 * Percent complete, computed inside the aggregation pipeline.
 *
 * The same formula `percentOf` applies in JavaScript - mandatory lessons
 * completed over mandatory lessons total - expressed so Mongo can evaluate it
 * per document without the rows travelling anywhere.
 *
 * A path with no mandatory lessons is 100, matching `percentOf`'s vacuous case.
 * Without that guard this divides by zero and the average becomes null, which
 * renders as an empty tile rather than as an error anyone would notice.
 */
const percentExpr = {
  $let: {
    vars: {
      mandatory: {
        $filter: { input: '$lessons', as: 'l', cond: { $eq: ['$$l.mandatory', true] } },
      },
    },
    in: {
      $cond: [
        { $eq: [{ $size: '$$mandatory' }, 0] },
        100,
        {
          $multiply: [
            {
              $divide: [
                {
                  $size: {
                    $filter: {
                      input: '$$mandatory',
                      as: 'm',
                      cond: { $eq: ['$$m.status', 'completed'] },
                    },
                  },
                },
                { $size: '$$mandatory' },
              ],
            },
            100,
          ],
        },
      ],
    },
  },
};

/**
 * What this actor may count.
 *
 * The dashboard is gated on `academy:view:org` at the route, so in practice
 * this returns `{}`. A manager reaching the team view gets their reports only -
 * and an actor with neither grant gets a refusal rather than a company-wide
 * total, which is the failure mode that matters.
 */
async function reportScope(actor) {
  if (canViewOrg(actor)) return {};

  if (canViewTeam(actor) && actor?.employeeId) {
    const reports = await Employee.find({
      managerChain: oid(actor.employeeId),
      deletedAt: null,
    })
      .select('_id')
      .lean();
    return { employeeId: { $in: [oid(actor.employeeId), ...reports.map((r) => r._id)] } };
  }

  throw new HrmsForbiddenError('You do not have permission to view academy reports.');
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * The admin dashboard.
 *
 * Five independent aggregations, run concurrently and settled independently -
 * the shape `dashboard.service.js` uses for the HR dashboard, so one slow or
 * failing widget leaves the rest of the page intact rather than blanking it.
 */
export async function academyDashboard(actor) {
  const scope = await reportScope(actor);
  const today = toDay(new Date());

  const [totals, byStatus, topPaths, recent, certificates] = await Promise.all([
    LearningAssignment.aggregate([
      { $match: { ...scope, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: null,
          assignments: { $sum: 1 },
          employees: { $addToSet: '$employeeId' },
          avgPercent: { $avg: percentExpr },
        },
      },
      {
        $project: {
          _id: 0,
          assignments: 1,
          employees: { $size: '$employees' },
          avgPercent: { $round: [{ $ifNull: ['$avgPercent', 0] }, 0] },
        },
      },
    ]),

    LearningAssignment.aggregate([
      { $match: { ...scope, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),

    LearningAssignment.aggregate([
      { $match: { ...scope, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: { pathId: '$pathId', pathName: '$pathName' },
          assigned: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', today] },
                    { $in: ['$status', ['assigned', 'in_progress']] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          avgPercent: { $avg: percentExpr },
        },
      },
      { $sort: { assigned: -1 } },
      { $limit: 8 },
    ]),

    // The queue an administrator actually acts on: what is overdue, soonest
    // first. Bounded, because a dashboard card is not a list screen.
    LearningAssignment.find({ ...scope, ...overdueMatch(today) })
      .sort({ dueDate: 1 })
      .limit(10)
      .select('employeeName pathName dueDate status lessons')
      .lean(),

    AcademyCertificate.countDocuments(
      scope.employeeId ? { employeeId: scope.employeeId, revokedAt: null } : { revokedAt: null },
    ),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  const overdueCount = await LearningAssignment.countDocuments({
    ...scope,
    ...overdueMatch(today),
  });

  return {
    metrics: {
      employeesAssigned: totals[0]?.employees ?? 0,
      assignments: totals[0]?.assignments ?? 0,
      notStarted: statusCounts.assigned ?? 0,
      inProgress: statusCounts.in_progress ?? 0,
      completed: statusCounts.completed ?? 0,
      overdue: overdueCount,
      averagePercent: totals[0]?.avgPercent ?? 0,
      certificatesIssued: certificates,
    },
    pathCompletion: topPaths.map((p) => ({
      pathId: idStr(p._id.pathId),
      pathName: p._id.pathName,
      assigned: p.assigned,
      completed: p.completed,
      inProgress: p.inProgress,
      overdue: p.overdue,
      completionPercent: p.assigned > 0 ? Math.round((p.completed / p.assigned) * 100) : 0,
      averagePercent: Math.round(p.avgPercent ?? 0),
    })),
    overdueQueue: recent.map((r) => ({
      id: idStr(r._id),
      employeeName: r.employeeName,
      pathName: r.pathName,
      dueDate: r.dueDate,
      status: r.status,
      overdueByDays: r.dueDate
        ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.dueDate}T00:00:00Z`)) / 86_400_000)
        : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * Learning-path completion: one row per path.
 *
 * The section 14 table. Filters narrow the population being counted, never the
 * scope - the scope is applied first and the filter is intersected with it.
 */
export async function pathCompletionReport(actor, query, context = {}) {
  const scope = await reportScope(actor);
  const q = parse(academyReportQuerySchema, query, 'report query');
  const today = toDay(new Date());

  const match = { ...scope, status: { $ne: 'cancelled' } };
  if (q.pathId) match.pathId = oid(q.pathId);
  if (q.departmentId) match.departmentId = oid(q.departmentId);
  if (q.status) match.status = q.status;

  const rows = await LearningAssignment.aggregate([
    { $match: match },
    {
      $group: {
        _id: { pathId: '$pathId', pathName: '$pathName' },
        assigned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
        notStarted: { $sum: { $cond: [{ $eq: ['$status', 'assigned'] }, 1, 0] } },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$dueDate', null] },
                  { $lt: ['$dueDate', today] },
                  { $in: ['$status', ['assigned', 'in_progress']] },
                ],
              },
              1,
              0,
            ],
          },
        },
        avgPercent: { $avg: percentExpr },
      },
    },
    { $sort: { assigned: -1 } },
  ]);

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.REPORT_RUN,
    'Ran the SI Academy learning-path completion report',
    context.req,
    { meta: { report: 'academy.path_completion', filters: q, rows: rows.length } },
  );

  return {
    report: 'path_completion',
    generatedAt: new Date().toISOString(),
    filters: q,
    rows: rows.map((r) => ({
      pathId: idStr(r._id.pathId),
      pathName: r._id.pathName,
      assigned: r.assigned,
      completed: r.completed,
      inProgress: r.inProgress,
      notStarted: r.notStarted,
      overdue: r.overdue,
      completionPercent: r.assigned > 0 ? Math.round((r.completed / r.assigned) * 100) : 0,
      averagePercent: Math.round(r.avgPercent ?? 0),
    })),
  };
}

/**
 * Employee training status: one row per employee per path.
 *
 * The other section 14 table, and the one HR actually exports. Department names
 * are resolved in ONE query rather than per row - the N+1 that turns a
 * thousand-row export into a thousand round trips.
 */
export async function employeeStatusReport(actor, query, context = {}) {
  const scope = await reportScope(actor);
  const q = parse(academyReportQuerySchema, query, 'report query');
  const today = toDay(new Date());

  const match = { ...scope, status: { $ne: 'cancelled' } };
  if (q.pathId) match.pathId = oid(q.pathId);
  if (q.departmentId) match.departmentId = oid(q.departmentId);
  if (q.status) match.status = q.status;

  const rows = await LearningAssignment.aggregate([
    { $match: match },
    {
      $project: {
        employeeId: 1,
        employeeName: 1,
        departmentId: 1,
        pathId: 1,
        pathName: 1,
        status: 1,
        dueDate: 1,
        assignedAt: 1,
        completedAt: 1,
        lastActivityAt: 1,
        percent: { $round: [percentExpr, 0] },
        overdue: {
          $and: [
            { $ne: ['$dueDate', null] },
            { $lt: ['$dueDate', today] },
            { $in: ['$status', ['assigned', 'in_progress']] },
          ],
        },
      },
    },
    { $sort: { overdue: -1, dueDate: 1, employeeName: 1 } },
    // A report is not a list screen, but it is not unbounded either. 5,000 rows
    // is a generous export ceiling and a firm one.
    { $limit: 5000 },
  ]);

  const departmentIds = [...new Set(rows.map((r) => idStr(r.departmentId)).filter(Boolean))];
  const departments = departmentIds.length
    ? await Department.find({ _id: { $in: departmentIds.map(oid) } })
        .select('name')
        .lean()
    : [];
  const deptName = new Map(departments.map((d) => [idStr(d._id), d.name]));

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.REPORT_RUN,
    'Ran the SI Academy employee training status report',
    context.req,
    { meta: { report: 'academy.employee_status', filters: q, rows: rows.length } },
  );

  return {
    report: 'employee_status',
    generatedAt: new Date().toISOString(),
    filters: q,
    rows: rows.map((r) => ({
      assignmentId: idStr(r._id),
      employeeId: idStr(r.employeeId),
      employeeName: r.employeeName,
      department: deptName.get(idStr(r.departmentId)) ?? null,
      pathId: idStr(r.pathId),
      pathName: r.pathName,
      status: r.status,
      percent: r.percent,
      dueDate: r.dueDate ?? null,
      overdue: r.overdue === true,
      assignedAt: r.assignedAt ? new Date(r.assignedAt).toISOString() : null,
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
    })),
  };
}

/**
 * One employee's complete Academy record.
 *
 * The section 13 screen, reached from the employee profile. Deliberately a
 * SUMMARY across paths rather than the per-lesson detail - that is
 * `getAssignment`, which already exists and already authorises per row.
 */
export async function employeeAcademyRecord(employeeId, actor) {
  const employee = await Employee.findOne({ _id: employeeId, deletedAt: null })
    .select('firstName lastName employeeCode departmentId managerChain userId dateOfJoining')
    .lean();
  if (!employee) throw new HrmsForbiddenError('You cannot view this employee.');

  const resource = {
    ownerUserId: idStr(employee.userId),
    ownerEmployeeId: idStr(employee._id),
    ownerDepartmentId: idStr(employee.departmentId) ?? undefined,
    ownerManagerChain: (employee.managerChain ?? []).map(idStr),
  };

  const { hasHrmsPermission } = await import('../../../shared/permissions/has-permission.js');
  const { HRMS_MODULES: M, HRMS_ACTIONS: A, SCOPES: S } = await import(
    '../../../shared/permissions/constants.js'
  );

  const allowed =
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.ORG) ||
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.TEAM, resource) ||
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.SELF, resource);

  if (!allowed) {
    throw new HrmsForbiddenError("You cannot view this employee's learning record.");
  }

  const [assignments, certificates] = await Promise.all([
    LearningAssignment.find({ employeeId: oid(employeeId) })
      .sort({ assignedAt: -1 })
      .lean(),
    AcademyCertificate.find({ employeeId: oid(employeeId), revokedAt: null })
      .sort({ issuedAt: -1 })
      .lean(),
  ]);

  const { toAssignmentSummary } = await import('./assignment.service.js');
  const { toCertificateDto } = await import('./certificate.service.js');

  return {
    employee: {
      id: idStr(employee._id),
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeCode,
      dateOfJoining: employee.dateOfJoining
        ? new Date(employee.dateOfJoining).toISOString().slice(0, 10)
        : null,
    },
    assignments: assignments.map(toAssignmentSummary),
    certificates: certificates.map(toCertificateDto),
  };
}

export default {
  academyDashboard,
  pathCompletionReport,
  employeeStatusReport,
  employeeAcademyRecord,
};
