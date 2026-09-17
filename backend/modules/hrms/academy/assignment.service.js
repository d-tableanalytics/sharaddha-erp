/**
 * Learning assignments: creating them, and everything a learner does inside one.
 *
 * This file owns the single progress record described in `AcademyModels.js`.
 * Every percentage in the product is computed from `assignment.lessons[]` by
 * `shared/academy/progress.js`; nothing here stores a second copy of it.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS A LEARNER MAY TELL THE SERVER
 * ---------------------------------------------------------------------------
 *   1. "I watched some more of this video"  -> a bounded DELTA, clamped
 *   2. "I have read this document"          -> an acknowledgement
 *   3. "these are my answers"               -> marked server-side
 *
 * That is the entire vocabulary. There is no endpoint that accepts a
 * percentage, a lesson status, a score or a completion date, so section 25's
 * "employees must not be able to manipulate completion through client-side
 * requests" is guaranteed by the absence of an API rather than by a check.
 */

import {
  LearningPath,
  AcademyCourse,
  LearningAssignment,
} from '../../../models/hrms/AcademyModels.js';
import Employee from '../../../models/hrms/Employee.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { notify } from '../inbox/notifier.service.js';
import { INBOX_TYPES } from '../../../shared/constants/inbox.js';
import { AUDIT_ACTIONS } from '../../../shared/constants/hrms.js';
import {
  createAssignmentSchema,
  assignmentListQuerySchema,
  cancelAssignmentSchema,
  videoProgressSchema,
  completeLessonSchema,
  submitAttemptSchema,
} from '../../../shared/schemas/academy.js';
import {
  HrmsNotFoundError,
  HrmsConflictError,
  HrmsValidationError,
  HrmsForbiddenError,
} from '../hrms.errors.js';
import {
  toDay,
  addDays,
  deriveStatus,
  deriveDueState,
  courseProgress,
  percentOf,
  countsOf,
  nextLesson,
  videoIsComplete,
  videoPercent,
} from '../../../shared/academy/progress.js';
import { CONTENT_LESSON_TYPES } from '../../../shared/constants/academy.js';
import { contentStorageKey, contentByIds } from './content.service.js';
import { issue as issueCertificate } from './certificate.service.js';
import {
  loadAssessment,
  assessmentsByIds,
  toLearnerDto,
  markAttempt,
  effectiveAttempt,
  attemptsRemaining,
  assertAttemptAllowed,
} from './assessment.service.js';
import {
  idStr,
  oid,
  iso,
  parse,
  fullName,
  escapeRegex,
  assertCanAssign,
  assertCanViewAssignment,
  assertIsLearner,
  assignmentScopeFilter,
  canViewOrg,
  canViewTeam,
  page,
  skipOf,
} from './academy.shared.js';

/**
 * Slack allowed on top of elapsed wall-clock when crediting watch time.
 *
 * One heartbeat interval plus a little: the player reports every ten seconds,
 * so without this a learner would lose credit for the seconds between opening
 * the lesson and the first report. It is added to the CUMULATIVE ceiling, not
 * to each request - see `recordVideoProgress`.
 */
const VIDEO_PROGRESS_GRACE_SECONDS = 15;

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

/**
 * When is this due?
 *
 * The `joining_plus_days` mode is the reason this is a function rather than a
 * column: the section 10 example is "joining 16 Sep + 15 days = 30 Sep", which
 * is a different date for every employee and cannot be stored on the path.
 *
 * An employee with no joining date on record falls back to the assignment date
 * rather than producing `null`. A mandatory induction with no deadline is a
 * quieter failure than one with the wrong deadline, and it is the wrong one -
 * it silently drops out of every overdue report.
 */
export function computeDueDate(path, employee, { assignedOn = toDay(new Date()) } = {}) {
  switch (path.dueDateMode) {
    case 'fixed':
      return path.dueDate ?? null;

    case 'assigned_plus_days':
      return path.dueDays ? addDays(assignedOn, path.dueDays) : null;

    case 'joining_plus_days': {
      if (!path.dueDays) return null;
      const joining = employee?.dateOfJoining ? toDay(employee.dateOfJoining) : null;
      return addDays(joining ?? assignedOn, path.dueDays);
    }

    case 'none':
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Building an assignment
// ---------------------------------------------------------------------------

/**
 * Snapshot a path's live courses into lesson records.
 *
 * `mandatory` and `type` are copied rather than referenced. `AcademyModels.js`
 * explains why: it is what stops an administrator flipping a lesson to optional
 * from retroactively completing a compliance path for people who never opened
 * it.
 *
 * Only ACTIVE courses are included. An archived course is one the company has
 * stopped teaching, and new assignments should not owe it.
 */
function buildLessonRecords(courses) {
  const records = [];
  for (const course of [...courses].sort((a, b) => a.order - b.order)) {
    for (const lesson of [...(course.lessons ?? [])].sort((a, b) => a.order - b.order)) {
      records.push({
        courseId: course._id,
        lessonId: lesson._id,
        title: lesson.title,
        type: lesson.type,
        mandatory: lesson.mandatory !== false,
        status: 'not_started',
        watchedSeconds: 0,
        lastPositionSeconds: 0,
        timeSpentSeconds: 0,
      });
    }
  }
  return records;
}

/**
 * Create one assignment.
 *
 * Shared by the manual route and the rule engine, so duplicate handling, due
 * date computation and the notification are identical however an assignment
 * comes to exist - the alternative is two code paths that drift, and only one
 * of them checking for duplicates.
 *
 * Returns `{ created: false, reason }` rather than throwing when the employee
 * already has the path. Section 12 asks for duplicates to be handled
 * "gracefully", and a bulk assign to forty people of whom three already have it
 * must not fail for the other thirty-seven.
 */
export async function assignPathToEmployee(
  { employee, path, courses, dueDate, source = 'manual', rule = null, actorUserId = null },
  context = {},
) {
  const existing = await LearningAssignment.findOne({
    employeeId: employee._id,
    pathId: path._id,
    status: { $in: ['assigned', 'in_progress', 'completed'] },
  })
    .select('_id status')
    .lean();

  if (existing) {
    return {
      created: false,
      reason: 'ALREADY_ASSIGNED',
      assignmentId: idStr(existing._id),
      status: existing.status,
      employeeId: idStr(employee._id),
      employeeName: fullName(employee),
    };
  }

  const lessons = buildLessonRecords(courses);

  let row;
  try {
    row = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: fullName(employee),
      departmentId: employee.departmentId ?? null,
      pathId: path._id,
      pathName: path.name,
      source,
      ruleId: rule?._id ?? null,
      ruleName: rule?.name ?? null,
      assignedAt: new Date(),
      assignedByUserId: actorUserId,
      dueDate: dueDate ?? null,
      status: 'assigned',
      sequential: path.sequential === true,
      mandatory: path.mandatory !== false,
      requiresCertificate: path.requiresCertificate === true,
      lessons,
      attempts: [],
    });
  } catch (error) {
    /**
     * The unique partial index won the race.
     *
     * Two rules matching the same employee in the same request, or two
     * administrators assigning at once. The pre-check above exists to produce a
     * better message; THIS is the guarantee, and treating it as "already
     * assigned" rather than as an error is what makes concurrent assignment
     * safe.
     */
    if (error?.code === 11000) {
      return {
        created: false,
        reason: 'ALREADY_ASSIGNED',
        employeeId: idStr(employee._id),
        employeeName: fullName(employee),
      };
    }
    throw error;
  }

  /**
   * Tell them. Best-effort by construction - `notify` never throws, and its
   * header explains why an assignment must not be rolled back because a
   * notification could not be written.
   */
  await notify({
    to: idStr(employee._id),
    type: INBOX_TYPES.ACADEMY_ASSIGNED,
    title: `New training assigned: ${path.name}`,
    body: dueDate ? `Due by ${dueDate}.` : null,
    entity: 'academy_assignment',
    entityId: idStr(row._id),
  });

  await recordAudit(
    actorUserId ? { _id: actorUserId } : null,
    AUDIT_ACTIONS.ACADEMY_ASSIGNED,
    `Assigned "${path.name}" to ${fullName(employee)}`,
    context.req,
    {
      meta: {
        assignmentId: idStr(row._id),
        employeeId: idStr(employee._id),
        pathId: idStr(path._id),
        source,
        ruleId: idStr(rule?._id),
        dueDate: dueDate ?? null,
        lessons: lessons.length,
      },
    },
  );

  return { created: true, assignmentId: idStr(row._id), employeeId: idStr(employee._id) };
}

/**
 * Manual assignment: one path, one or more employees.
 *
 * Reports per-employee outcomes rather than failing the batch, for the reason
 * given on `assignPathToEmployee`.
 */
export async function createAssignments(body, actor, context = {}) {
  assertCanAssign(actor);
  const dto = parse(createAssignmentSchema, body, 'assignment');

  const path = await LearningPath.findOne({ _id: dto.pathId, deletedAt: null }).lean();
  if (!path) {
    throw new HrmsValidationError('Unknown learning path.', [
      { path: 'pathId', message: 'That learning path does not exist.' },
    ]);
  }
  if (!path.active) {
    throw new HrmsConflictError(
      `"${path.name}" is inactive, so it cannot be assigned. Reactivate it first.`,
      { code: 'PATH_INACTIVE' },
    );
  }

  const courses = await AcademyCourse.find({
    pathId: path._id,
    deletedAt: null,
    active: true,
  })
    .sort({ order: 1 })
    .lean();

  /**
   * An empty path is refused.
   *
   * Assigning one would create an assignment with no lessons, which
   * `deriveStatus` correctly reports as `assigned` forever - it can never
   * complete, because it has no mandatory lesson to complete. The onboarding
   * module records the same defect in its own reference: an empty template
   * instantiates into a checklist that immediately reads as done.
   */
  if (courses.length === 0 || courses.every((c) => (c.lessons ?? []).length === 0)) {
    throw new HrmsConflictError(
      `"${path.name}" has no lessons yet, so there is nothing to assign.`,
      { code: 'PATH_EMPTY' },
    );
  }

  const employees = await Employee.find({
    _id: { $in: dto.employeeIds.map(oid) },
    deletedAt: null,
  })
    .select('firstName lastName departmentId dateOfJoining status')
    .lean();

  const found = new Set(employees.map((e) => idStr(e._id)));
  const missing = dto.employeeIds.filter((id) => !found.has(idStr(id)));

  const results = [];
  for (const employee of employees) {
    // Somebody who has left is not assigned new training. The onboarding module
    // draws the same line for the same reason.
    if (employee.status === 'exited' || employee.status === 'inactive') {
      results.push({
        created: false,
        reason: 'EMPLOYEE_NOT_ACTIVE',
        employeeId: idStr(employee._id),
        employeeName: fullName(employee),
      });
      continue;
    }

    results.push(
      await assignPathToEmployee(
        {
          employee,
          path,
          courses,
          // An explicit due date overrides the path's configuration; otherwise
          // the path decides, per employee.
          dueDate: dto.dueDate ?? computeDueDate(path, employee),
          source: 'manual',
          actorUserId: actor.userId ?? null,
        },
        context,
      ),
    );
  }

  return {
    assigned: results.filter((r) => r.created).length,
    skipped: results.filter((r) => !r.created),
    notFound: missing,
    results,
  };
}

// ---------------------------------------------------------------------------
// Reading assignments
// ---------------------------------------------------------------------------

/** The actor's direct and indirect reports, for a `team`-scoped list. */
async function teamEmployeeIds(actor) {
  if (!actor?.employeeId) return [];
  const rows = await Employee.find({ managerChain: oid(actor.employeeId), deletedAt: null })
    .select('_id')
    .lean();
  return rows.map((r) => idStr(r._id));
}

/**
 * The summary shape - what a list row and a dashboard card need, and nothing
 * more. The full course breakdown is only built for a single assignment.
 */
export function toAssignmentSummary(row) {
  const records = row.lessons ?? [];
  const percent = percentOf(records);
  const counts = countsOf(records);
  const due = deriveDueState(row.dueDate, row.status);

  return {
    id: idStr(row._id),
    employeeId: idStr(row.employeeId),
    employeeName: row.employeeName,
    departmentId: idStr(row.departmentId),
    pathId: idStr(row.pathId),
    pathName: row.pathName,
    source: row.source,
    ruleName: row.ruleName ?? null,
    status: row.status,
    mandatory: row.mandatory !== false,
    requiresCertificate: row.requiresCertificate === true,
    certificateId: idStr(row.certificateId),
    percent,
    completedLessons: counts.completed,
    totalLessons: counts.total,
    /**
     * How many COURSES this path spans.
     *
     * Counted off the lesson records already in hand rather than joined from
     * the path - the records carry `courseId`, so this is a set size over data
     * that is loaded either way and costs no extra query.
     */
    totalCourses: new Set(records.map((r) => String(r.courseId))).size,
    dueDate: row.dueDate ?? null,
    dueState: due.state,
    dueLabel: due.label,
    dueInDays: due.days,
    assignedAt: iso(row.assignedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    lastActivityAt: iso(row.lastActivityAt),
  };
}

/**
 * List assignments.
 *
 * Scope is applied as a QUERY condition, so `total` counts what the caller can
 * actually see. `overdue` is a filter the caller can ask for and NOT a stored
 * field, so it is translated here into the date comparison it really is.
 */
export async function listAssignments(actor, query) {
  const q = parse(assignmentListQuerySchema, query, 'assignment query');

  const team = canViewTeam(actor) && !canViewOrg(actor) ? await teamEmployeeIds(actor) : null;
  const filter = { ...assignmentScopeFilter(actor, team) };

  if (q.employeeId) {
    // Narrowing within the permitted scope, never widening it: the scope filter
    // above already constrains `employeeId`, and Mongo applies both.
    filter.employeeId = filter.employeeId
      ? { $in: [oid(q.employeeId)].filter((id) => matchesExisting(filter.employeeId, id)) }
      : oid(q.employeeId);
  }
  if (q.pathId) filter.pathId = oid(q.pathId);
  if (q.status) filter.status = q.status;
  if (q.departmentId) filter.departmentId = oid(q.departmentId);
  if (q.search) filter.$or = [
    { employeeName: new RegExp(escapeRegex(q.search), 'i') },
    { pathName: new RegExp(escapeRegex(q.search), 'i') },
  ];

  if (q.overdue) {
    filter.dueDate = { $ne: null, $lt: toDay(new Date()) };
    filter.status = { $in: ['assigned', 'in_progress'] };
  }

  const sort = q.sortBy
    ? { [q.sortBy]: q.sortDir === 'desc' ? -1 : 1 }
    : { dueDate: 1, assignedAt: -1 };

  const [rows, total] = await Promise.all([
    LearningAssignment.find(filter).sort(sort).skip(skipOf(q)).limit(q.pageSize).lean(),
    LearningAssignment.countDocuments(filter),
  ]);

  return page(rows.map(toAssignmentSummary), total, q);
}

/** Keep a narrowing `employeeId` inside whatever the scope filter already allowed. */
function matchesExisting(existing, id) {
  if (!existing) return true;
  if (existing.$in) return existing.$in.some((e) => String(e) === String(id));
  return String(existing) === String(id);
}

/**
 * My Learning.
 *
 * Deliberately NOT `listAssignments({ employeeId: me })`. The employee id comes
 * from the SESSION and never from the request, so there is no parameter to
 * tamper with - the same shape `documents/me` and `onboarding/checklists/mine`
 * use, and the reason `notifier.service.js` resolves recipients rather than
 * accepting them.
 */
export async function myLearning(actor) {
  if (!actor?.employeeId) {
    // An HR administrator who is not themselves an employee is legitimate; they
    // simply have no learning of their own. An empty list, not an error.
    return { summary: emptySummary(), assignments: [], continue: null };
  }

  const rows = await LearningAssignment.find({
    employeeId: oid(actor.employeeId),
    status: { $in: ['assigned', 'in_progress', 'completed'] },
  })
    .sort({ status: 1, dueDate: 1 })
    .lean();

  const assignments = rows.map(toAssignmentSummary);

  const summary = {
    assigned: assignments.length,
    notStarted: assignments.filter((a) => a.status === 'assigned').length,
    inProgress: assignments.filter((a) => a.status === 'in_progress').length,
    completed: assignments.filter((a) => a.status === 'completed').length,
    overdue: assignments.filter((a) => a.dueState === 'overdue').length,
    dueSoon: assignments.filter((a) => a.dueState === 'due_soon').length,
  };

  /**
   * "Continue learning" - the single most-used control on the page.
   *
   * The most urgent unfinished path: overdue first, then by due date, with
   * undated paths last. Resolved here rather than in the browser so the card
   * and the button cannot disagree about which path is "current".
   */
  const live = rows.filter((r) => r.status !== 'completed');
  const ranked = live.sort((a, b) => {
    const da = deriveDueState(a.dueDate, a.status);
    const db = deriveDueState(b.dueDate, b.status);
    if (da.state === 'overdue' !== (db.state === 'overdue')) return da.state === 'overdue' ? -1 : 1;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  let resume = null;
  if (ranked[0]) {
    const courses = await AcademyCourse.find({ pathId: ranked[0].pathId, deletedAt: null })
      .sort({ order: 1 })
      .lean();
    const next = nextLesson(courses, ranked[0].lessons ?? [], {
      sequential: ranked[0].sequential,
    });
    resume = {
      ...toAssignmentSummary(ranked[0]),
      nextLesson: next,
    };
  }

  return { summary, assignments, continue: resume };
}

const emptySummary = () => ({
  assigned: 0,
  notStarted: 0,
  inProgress: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
});

/**
 * One assignment, in full: every course, its lock state, and every lesson.
 *
 * This is the screen a learner works from and the screen HR reads to answer
 * "where have they got to", so it is ONE function rather than two. The only
 * difference between the two audiences is authorisation, which happens above.
 */
export async function getAssignment(id, actor) {
  const row = await LearningAssignment.findById(id).lean();
  if (!row) throw new HrmsNotFoundError('Learning assignment');

  // A `team` grant is evaluated against the SUBJECT's manager chain, so it has
  // to be loaded - the resource must be real, or `isSelf`/`isInTeamOf` would be
  // deciding against `undefined` and waving the request through.
  const subject = await Employee.findById(row.employeeId)
    .select('managerChain departmentId employeeCode dateOfJoining')
    .lean();

  assertCanViewAssignment(actor, row, subject?.managerChain ?? []);

  const courses = await AcademyCourse.find({ pathId: row.pathId, deletedAt: null })
    .sort({ order: 1 })
    .lean();

  /**
   * The path's own blurb.
   *
   * Read LIVE rather than denormalised onto the assignment: unlike `pathName`,
   * which is kept on the row so a deleted path still has something to display,
   * the description is prose that HR edits and expects to see updated. A copy
   * frozen at assignment time would show every learner the wording as it was on
   * the day they joined.
   */
  const path = await LearningPath.findById(row.pathId).select('description').lean();

  const records = row.lessons ?? [];
  const rollup = courseProgress(courses, records, { sequential: row.sequential });
  const contentMap = await contentByIds(
    courses.flatMap((c) => (c.lessons ?? []).map((l) => l.contentId)),
  );

  /**
   * The quizzes, so a lesson can say how many attempts are LEFT.
   *
   * Without this the attempt summary knew only what the learner had already
   * done, never what they are still allowed to do — so the lesson's landing
   * screen offered "Try again" to somebody who had used their last attempt,
   * and the server refused the click. A control that is offered, accepted and
   * then refused is the one thing a control must never be.
   */
  const assessmentMap = await assessmentsByIds(
    courses.flatMap((c) => (c.lessons ?? []).map((l) => l.assessmentId)),
  );

  const byLessonId = new Map(records.map((r) => [idStr(r.lessonId), r]));

  const detailed = rollup.map((course) => {
    const source = courses.find((c) => idStr(c._id) === course.courseId);
    const lessons = [...(source?.lessons ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((lesson) => {
        const record = byLessonId.get(idStr(lesson._id));
        const content = contentMap.get(idStr(lesson.contentId)) ?? null;

        return {
          id: idStr(lesson._id),
          title: lesson.title,
          description: lesson.description ?? null,
          type: lesson.type,
          mandatory: lesson.mandatory !== false,
          /**
           * A lesson added to the course AFTER this person was assigned has no
           * record. It is shown, marked, and not counted - inventing a record
           * here would silently add work the learner was never assigned, and
           * hiding it would make the course look shorter than it is.
           */
          inAssignment: Boolean(record),
          status: record?.status ?? 'not_started',
          completedAt: iso(record?.completedAt),
          watchedSeconds: record?.watchedSeconds ?? 0,
          lastPositionSeconds: record?.lastPositionSeconds ?? 0,
          videoDurationSeconds:
            record?.videoDurationSeconds ?? content?.durationSeconds ?? null,
          videoCompletionPercent: lesson.videoCompletionPercent,
          videoPercent: record ? videoPercent(record) : 0,
          timeSpentSeconds: record?.timeSpentSeconds ?? 0,
          contentMissing:
            CONTENT_LESSON_TYPES.includes(lesson.type) && (!content || Boolean(content.deletedAt)),
          contentTitle: content?.title ?? null,
          mimeType: content?.mimeType ?? null,
          assessment:
            lesson.type === 'quiz'
              ? assessmentSummaryFor(row, lesson, assessmentMap.get(idStr(lesson.assessmentId)))
              : null,
        };
      });

    return {
      ...course,
      description: source?.description ?? null,
      estimatedMinutes: source?.estimatedMinutes ?? null,
      active: source?.active !== false,
      lessons,
    };
  });

  return {
    ...toAssignmentSummary(row),
    employeeCode: subject?.employeeCode ?? null,
    description: path?.description ?? null,
    sequential: row.sequential,
    cancelReason: row.cancelReason ?? null,
    courses: detailed,
    nextLesson: nextLesson(courses, records, { sequential: row.sequential }),
  };
}

/** Attempt history for one quiz lesson, as the learner's course page shows it. */
function assessmentSummaryFor(assignment, lesson, assessment = null) {
  const attempts = (assignment.attempts ?? []).filter(
    (a) => idStr(a.lessonId) === idStr(lesson._id),
  );
  const best = effectiveAttempt(attempts, 'highest');
  const latest = effectiveAttempt(attempts, 'latest');

  return {
    assessmentId: idStr(lesson.assessmentId),
    attemptCount: attempts.length,
    passed: attempts.some((a) => a.passed),
    bestScore: best?.score ?? null,
    latestScore: latest?.score ?? null,
    /**
     * What the learner may still do, computed by the SAME function the submit
     * endpoint gates on — so the button and the refusal cannot disagree.
     *
     * `null` means unlimited, which is what an assessment created without an
     * attempt limit gets. An assessment that has been deleted since the lesson
     * was authored resolves to no row here, and the screen falls back to
     * offering the attempt: the server still refuses it with a message that
     * says the assessment is gone, which is more useful than a disabled button
     * with no explanation.
     */
    maxAttempts: assessment?.maxAttempts ?? null,
    attemptsRemaining: assessment ? attemptsRemaining(assessment, attempts) : null,
    /**
     * The rules of the assessment, so the screen can state them BEFORE the
     * learner starts rather than after they have committed to an attempt.
     *
     * `questionCount` is a count and not the questions - see the projection in
     * `assessmentsByIds`, which loads question ids only.
     */
    passingPercent: assessment?.passingPercent ?? null,
    questionCount: assessment?.questionCount ?? null,
    scorePolicy: assessment?.scorePolicy ?? null,
    attempts: attempts
      .sort((a, b) => a.attemptNo - b.attemptNo)
      .map((a) => ({
        attemptNo: a.attemptNo,
        score: a.score,
        passed: a.passed,
        correctCount: a.correctCount,
        questionCount: a.questionCount,
        passingPercent: a.passingPercent,
        submittedAt: iso(a.submittedAt),
      })),
  };
}

// ---------------------------------------------------------------------------
// Working through a lesson
// ---------------------------------------------------------------------------

/**
 * Load an assignment for a WRITE by its learner, with the lesson resolved.
 *
 * Every progress endpoint starts here, so the four things that must be true
 * before anything is written are checked in one place:
 *
 *   1. the assignment exists
 *   2. the caller IS the learner  - not "may view", see `assertIsLearner`
 *   3. the assignment is live     - a cancelled one accepts no work
 *   4. the lesson is not locked   - the prerequisite gate, enforced SERVER-side
 *
 * Point 4 is the one worth stating: the UI also greys out a locked course, but
 * that is decoration. This is the check, and it is why a learner cannot POST
 * their way past a prerequisite (section 26).
 */
async function loadForProgress(assignmentId, lessonId, actor) {
  const assignment = await LearningAssignment.findById(assignmentId);
  if (!assignment) throw new HrmsNotFoundError('Learning assignment');

  assertIsLearner(actor, assignment);

  if (assignment.status === 'cancelled') {
    throw new HrmsConflictError('This assignment has been cancelled.', {
      code: 'ASSIGNMENT_CANCELLED',
    });
  }

  const record = assignment.lessons.find((r) => idStr(r.lessonId) === idStr(lessonId));
  if (!record) {
    throw new HrmsNotFoundError('Lesson', { code: 'LESSON_NOT_IN_ASSIGNMENT' });
  }

  const courses = await AcademyCourse.find({ pathId: assignment.pathId, deletedAt: null })
    .sort({ order: 1 })
    .lean();

  const rollup = courseProgress(courses, assignment.lessons, {
    sequential: assignment.sequential,
  });
  const course = rollup.find((c) => c.courseId === idStr(record.courseId));

  if (course?.locked) {
    throw new HrmsForbiddenError(
      course.lockedBy
        ? `Complete "${course.lockedBy}" before starting this course.`
        : 'This course is locked until its prerequisite is complete.',
      { code: 'COURSE_LOCKED' },
    );
  }

  const sourceCourse = courses.find((c) => idStr(c._id) === idStr(record.courseId));
  const lesson = (sourceCourse?.lessons ?? []).find(
    (l) => idStr(l._id) === idStr(lessonId),
  );

  return { assignment, record, lesson, courses, sourceCourse };
}

/**
 * Settle an assignment after a lesson changed.
 *
 * Recomputes the status from the records rather than latching it, fires the
 * completion notification exactly once, and returns whether this write was the
 * one that completed the path - which is what the caller needs in order to
 * decide about a certificate.
 */
async function settle(assignment, context = {}) {
  const wasCompleted = assignment.status === 'completed';
  const next = deriveStatus(assignment.lessons, assignment.status);

  assignment.lastActivityAt = new Date();
  if (!assignment.startedAt && next !== 'assigned') assignment.startedAt = new Date();

  assignment.status = next;

  const justCompleted = next === 'completed' && !wasCompleted;
  if (justCompleted) {
    assignment.completedAt = new Date();
  } else if (next !== 'completed') {
    // Reopened, because new mandatory material arrived. The old completion date
    // no longer describes anything true.
    assignment.completedAt = null;
  }

  await assignment.save();

  if (justCompleted) {
    /**
     * The certificate, if the path issues one.
     *
     * BEFORE the completion notification, so the "your certificate is ready"
     * line is only written when one actually is. `issue` re-verifies the
     * completion itself and returns null rather than throwing, so a rendering
     * failure costs the certificate and never the completion - see its header.
     */
    const certificate = assignment.requiresCertificate
      ? await issueCertificate(assignment, {
          req: context.req,
          actorUserId: context.actorUserId,
        })
      : null;

    await notify({
      to: idStr(assignment.employeeId),
      type: INBOX_TYPES.ACADEMY_COMPLETED,
      title: `You have completed ${assignment.pathName}`,
      body: certificate ? 'Your certificate is ready.' : null,
      entity: 'academy_assignment',
      entityId: idStr(assignment._id),
    });

    await recordAudit(
      { _id: context.actorUserId ?? null },
      AUDIT_ACTIONS.ACADEMY_PATH_COMPLETED,
      `${assignment.employeeName} completed "${assignment.pathName}"`,
      context.req,
      {
        meta: {
          assignmentId: idStr(assignment._id),
          employeeId: idStr(assignment.employeeId),
          pathId: idStr(assignment.pathId),
          dueDate: assignment.dueDate ?? null,
          onTime: assignment.dueDate ? toDay(new Date()) <= assignment.dueDate : null,
        },
      },
    );
  }

  return justCompleted;
}

/**
 * Record video progress.
 *
 * ---------------------------------------------------------------------------
 * 🔴 WHY THE CLIENT SENDS A DELTA AND NOT A TOTAL
 * ---------------------------------------------------------------------------
 * A running total is a number the client controls: one POST of
 * `watchedSeconds: 3600` completes anything. A DELTA can be bounded against
 * something the client does not control - the wall-clock time since the last
 * ping - so a learner cannot accumulate more watch time than has actually
 * elapsed, however many requests they send or however large they make each one.
 *
 * The clamp is generous (a small grace, plus 2x for playback speed) because the
 * goal is to make cheating cost real time, not to police exact playback. At 2x
 * the fastest anyone can complete a 10-minute video is 5 minutes of real time.
 */
export async function recordVideoProgress(assignmentId, lessonId, body, actor, context = {}) {
  const dto = parse(videoProgressSchema, body, 'video progress');
  const { assignment, record, lesson } = await loadForProgress(assignmentId, lessonId, actor);

  if (record.type !== 'video') {
    throw new HrmsValidationError('That lesson is not a video.');
  }

  const now = new Date();

  // The duration is snapshot on first contact, so a later re-upload of the
  // content cannot change the denominator of work already done.
  if (record.videoDurationSeconds == null && lesson?.contentId) {
    const content = await contentStorageKey(lesson.contentId);
    record.videoDurationSeconds = content?.durationSeconds ?? null;
  }

  // The lesson starts on first contact, and that timestamp is what the
  // ceiling below is measured from - so it has to be set BEFORE the ceiling is
  // computed, not after.
  if (record.status === 'not_started') {
    record.status = 'in_progress';
    record.startedAt = now;
  }
  if (!record.startedAt) record.startedAt = now;

  /**
   * 🔴 THE CEILING IS CUMULATIVE, NOT PER-REQUEST.
   *
   * Two earlier shapes of this check were both broken, and both in ways that
   * only show up when somebody actually tries:
   *
   *   - "clamp the delta against the time since the LAST ping" leaves the FIRST
   *     ping unbounded, because there is no previous timestamp to measure
   *     against. One POST claiming 600 seconds completed a ten-minute video.
   *
   *   - "clamp the delta, plus a few seconds of grace for a laggy heartbeat"
   *     hands out that grace once per REQUEST, so a hundred requests fired in a
   *     loop earn a hundred graces and the video completes in no time at all.
   *
   * So the bound is on the TOTAL: watched seconds may never exceed twice the
   * real time since the learner opened this lesson, plus one heartbeat of
   * slack. Rapid-fire requests gain nothing, because the ceiling does not move
   * when a request arrives - only when time passes.
   *
   * 2x, rather than 1x, because a browser genuinely plays at up to 2x speed and
   * refusing that would punish somebody for using a feature the player offers.
   * The effect is a floor on cheating measured in real minutes: the fastest
   * anybody completes a forty-minute induction is twenty minutes of wall clock.
   */
  const elapsedSinceStart = Math.max(
    0,
    (now.getTime() - new Date(record.startedAt).getTime()) / 1000,
  );
  const ceiling = elapsedSinceStart * 2 + VIDEO_PROGRESS_GRACE_SECONDS;

  const duration = record.videoDurationSeconds ?? Number.POSITIVE_INFINITY;
  const before = record.watchedSeconds;

  record.watchedSeconds = Math.min(
    record.watchedSeconds + dto.watchedDeltaSeconds,
    ceiling,
    // Never credit more than the clip is long; otherwise a long session on a
    // short video accumulates a meaningless number.
    duration,
  );

  const credited = Math.max(0, record.watchedSeconds - before);

  record.lastPositionSeconds = dto.positionSeconds;
  record.timeSpentSeconds += Math.round(credited);
  record.lastProgressAt = now;

  /**
   * Completion is DERIVED, here, from the numbers above - never asserted by the
   * client. `videoIsComplete` needs a real duration, so a clip whose length the
   * library never recorded stays `in_progress` and the learner marks it done
   * explicitly. Failing toward asking is the right direction.
   */
  if (record.status !== 'completed' && videoIsComplete(lesson ?? {}, record)) {
    record.status = 'completed';
    record.completedAt = now;
  }

  const justCompleted = await settle(assignment, {
    req: context.req,
    actorUserId: actor.userId,
  });

  return {
    lessonId: idStr(lessonId),
    status: record.status,
    watchedSeconds: Math.round(record.watchedSeconds),
    videoPercent: videoPercent(record),
    requiredPercent: lesson?.videoCompletionPercent ?? null,
    assignmentStatus: assignment.status,
    pathCompleted: justCompleted,
  };
}

/**
 * Mark a PDF or document lesson complete.
 *
 * The acknowledgement is required by the schema, which is what turns "I have
 * read and understood this document" into a recorded statement rather than a
 * checkbox the client may omit - the shape the documents module already uses
 * for policy acknowledgement.
 */
export async function completeLesson(assignmentId, lessonId, body, actor, context = {}) {
  parse(completeLessonSchema, body, 'completion');
  const { assignment, record, lesson } = await loadForProgress(assignmentId, lessonId, actor);

  if (record.type === 'quiz') {
    throw new HrmsValidationError(
      'A quiz is completed by passing it, not by marking it read.',
    );
  }

  /**
   * A video may be marked complete BY HAND only when it has genuinely been
   * watched, or when the library holds no duration to measure against.
   *
   * Without this the endpoint is a bypass for the whole video-progress
   * mechanism: a learner opens the player, sends nothing, and marks it done.
   */
  if (record.type === 'video') {
    const measurable = (record.videoDurationSeconds ?? 0) > 0;
    if (measurable && !videoIsComplete(lesson ?? {}, record)) {
      throw new HrmsForbiddenError(
        `Watch at least ${lesson?.videoCompletionPercent ?? 90}% of this video before marking it complete. You have watched ${videoPercent(record)}%.`,
        { code: 'VIDEO_NOT_WATCHED' },
      );
    }
  }

  const now = new Date();
  if (record.status !== 'completed') {
    record.status = 'completed';
    record.completedAt = now;
    record.acknowledgedAt = now;
    if (!record.startedAt) record.startedAt = now;
  }

  const justCompleted = await settle(assignment, {
    req: context.req,
    actorUserId: actor.userId,
  });

  return {
    lessonId: idStr(lessonId),
    status: record.status,
    assignmentStatus: assignment.status,
    pathCompleted: justCompleted,
  };
}

/**
 * Open a quiz.
 *
 * Returns the questions WITHOUT their answers (`toLearnerDto`), plus how many
 * attempts remain. The attempt ceiling is checked here as well as on submit -
 * here so the UI can refuse gracefully, on submit because that is the check
 * that actually binds.
 */
export async function startAttempt(assignmentId, lessonId, actor) {
  const { assignment, record, lesson } = await loadForProgress(assignmentId, lessonId, actor);

  if (record.type !== 'quiz') throw new HrmsValidationError('That lesson is not a quiz.');

  const assessment = await loadAssessment(lesson?.assessmentId);
  if (!assessment) {
    throw new HrmsConflictError(
      'This assessment is no longer available. Ask HR to restore it.',
      { code: 'ASSESSMENT_MISSING' },
    );
  }

  const attempts = (assignment.attempts ?? []).filter(
    (a) => idStr(a.lessonId) === idStr(lessonId),
  );
  assertAttemptAllowed(assessment, attempts);

  if (record.status === 'not_started') {
    record.status = 'in_progress';
    record.startedAt = new Date();
    await assignment.save();
  }

  return {
    ...toLearnerDto(assessment, {
      // Seeded per learner per attempt, so a refresh does not reshuffle.
      shuffleSeed: `${idStr(assignment._id)}:${idStr(lessonId)}:${attempts.length}`,
    }),
    attemptNo: attempts.length + 1,
    attemptsRemaining: attemptsRemaining(assessment, attempts),
  };
}

/**
 * Submit a quiz.
 *
 * Every number in the result is computed from the STORED assessment by
 * `markAttempt`. The attempt is appended, never edited - "attempt 1 scored 60%"
 * is a fact about what happened, and section 16 asks for the history.
 */
export async function submitAttempt(assignmentId, lessonId, body, actor, context = {}) {
  const dto = parse(submitAttemptSchema, body, 'assessment submission');
  const { assignment, record, lesson } = await loadForProgress(assignmentId, lessonId, actor);

  if (record.type !== 'quiz') throw new HrmsValidationError('That lesson is not a quiz.');

  const assessment = await loadAssessment(lesson?.assessmentId);
  if (!assessment) {
    throw new HrmsConflictError('This assessment is no longer available.', {
      code: 'ASSESSMENT_MISSING',
    });
  }

  const attempts = (assignment.attempts ?? []).filter(
    (a) => idStr(a.lessonId) === idStr(lessonId),
  );
  assertAttemptAllowed(assessment, attempts);

  const marked = markAttempt(assessment, dto.answers);
  const attemptNo = attempts.length + 1;

  assignment.attempts.push({
    assessmentId: assessment._id,
    courseId: record.courseId,
    lessonId: record.lessonId,
    attemptNo,
    submittedAt: new Date(),
    score: marked.score,
    correctCount: marked.correctCount,
    questionCount: marked.questionCount,
    passed: marked.passed,
    passingPercent: marked.passingPercent,
    answers: marked.answers,
  });

  /**
   * A quiz lesson completes on a PASS and only on a pass.
   *
   * A failed attempt leaves it `in_progress`, so the path stays incomplete and
   * the retry is visible where the learner left off.
   */
  if (marked.passed) {
    record.status = 'completed';
    record.completedAt = new Date();
  } else {
    record.status = 'in_progress';
  }

  const justCompleted = await settle(assignment, {
    req: context.req,
    actorUserId: actor.userId,
  });

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_ATTEMPT_SUBMITTED,
    `${assignment.employeeName} scored ${marked.score}% on "${assessment.title}" (attempt ${attemptNo})`,
    context.req,
    {
      meta: {
        assignmentId: idStr(assignment._id),
        assessmentId: idStr(assessment._id),
        attemptNo,
        score: marked.score,
        passed: marked.passed,
        passingPercent: marked.passingPercent,
      },
    },
  );

  const allAttempts = assignment.attempts.filter(
    (a) => idStr(a.lessonId) === idStr(lessonId),
  );

  return {
    attemptNo,
    score: marked.score,
    correctCount: marked.correctCount,
    questionCount: marked.questionCount,
    passed: marked.passed,
    passingPercent: marked.passingPercent,
    attemptsRemaining: attemptsRemaining(assessment, allAttempts),
    /**
     * Per-question correctness, so the learner can see WHICH ones they got
     * wrong. Deliberately not the correct ANSWERS: handing those back after a
     * failed attempt turns a retry into a transcription exercise.
     */
    results: marked.answers.map((a) => ({
      questionId: idStr(a.questionId),
      correct: a.correct,
    })),
    assignmentStatus: assignment.status,
    pathCompleted: justCompleted,
  };
}

/**
 * A short-lived URL for a lesson's content.
 *
 * The authorisation that matters happens HERE rather than in the storage
 * layer's access rule: `resolveContentAccess` can only answer "is this a live
 * content object", because a key knows nothing about who was assigned what.
 * This function knows the lesson, the assignment and the learner, so this is
 * where the question is actually answerable.
 */
export async function lessonContentUrl(assignmentId, lessonId, actor) {
  const assignment = await LearningAssignment.findById(assignmentId).lean();
  if (!assignment) throw new HrmsNotFoundError('Learning assignment');

  const subject = await Employee.findById(assignment.employeeId).select('managerChain').lean();
  // A manager or HR reviewing somebody's progress may also open the material -
  // they can see the course in the catalogue anyway, and refusing here would
  // make "what exactly did they have to read" unanswerable.
  assertCanViewAssignment(actor, assignment, subject?.managerChain ?? []);

  const record = (assignment.lessons ?? []).find(
    (r) => idStr(r.lessonId) === idStr(lessonId),
  );
  if (!record) throw new HrmsNotFoundError('Lesson', { code: 'LESSON_NOT_IN_ASSIGNMENT' });

  const course = await AcademyCourse.findOne({ _id: record.courseId, deletedAt: null }).lean();
  const lesson = (course?.lessons ?? []).find((l) => idStr(l._id) === idStr(lessonId));
  if (!lesson?.contentId) throw new HrmsNotFoundError('Lesson content');

  const content = await contentStorageKey(lesson.contentId);
  if (!content) {
    throw new HrmsConflictError(
      'The material for this lesson is no longer available. Ask HR to restore it.',
      { code: 'CONTENT_MISSING' },
    );
  }

  return { key: content.key, category: content.category, name: content.name, mimeType: content.mimeType };
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

/**
 * Withdraw an assignment.
 *
 * Cancelled rather than deleted, so the record that somebody WAS assigned
 * mandatory training and it was withdrawn survives - which is exactly the fact
 * a compliance audit asks about. The unique index excludes `cancelled`, so the
 * path can legitimately be assigned again afterwards.
 */
export async function cancelAssignment(id, body, actor, context = {}) {
  assertCanAssign(actor);
  const dto = parse(cancelAssignmentSchema, body, 'cancellation');

  const row = await LearningAssignment.findById(id);
  if (!row) throw new HrmsNotFoundError('Learning assignment');

  if (row.status === 'cancelled') {
    throw new HrmsConflictError('That assignment is already cancelled.', {
      code: 'ALREADY_CANCELLED',
    });
  }

  row.status = 'cancelled';
  row.cancelledAt = new Date();
  row.cancelReason = dto.reason ?? null;
  await row.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_ASSIGNMENT_CANCELLED,
    `Cancelled "${row.pathName}" for ${row.employeeName}`,
    context.req,
    {
      meta: {
        assignmentId: idStr(row._id),
        employeeId: idStr(row.employeeId),
        percentAtCancel: percentOf(row.lessons ?? []),
        reason: dto.reason ?? null,
      },
    },
  );

  return toAssignmentSummary(row.toObject());
}

export default {
  computeDueDate,
  assignPathToEmployee,
  createAssignments,
  listAssignments,
  myLearning,
  getAssignment,
  toAssignmentSummary,
  recordVideoProgress,
  completeLesson,
  startAttempt,
  submitAttempt,
  lessonContentUrl,
  cancelAssignment,
};
