/**
 * The Academy catalogue: learning paths, their courses, and each course's
 * lessons.
 *
 * ---------------------------------------------------------------------------
 * EDITING THE CATALOGUE MUST NOT REWRITE HISTORY
 * ---------------------------------------------------------------------------
 * This is the constraint that shapes the whole file. People are part-way
 * through these paths while an administrator edits them, and there are two ways
 * to get that wrong:
 *
 *   - recompute everyone's progress from the CURRENT catalogue, and an admin
 *     marking a lesson optional retroactively completes it for a thousand
 *     people who never opened it;
 *   - freeze each assignment at its creation, and a lesson added to a mandatory
 *     compliance course is never owed by anybody already assigned.
 *
 * Neither is acceptable, so the split is explicit: an assignment's lesson
 * records are SNAPSHOTS of what was owed (see `AcademyModels.js`), and
 * `syncAssignmentsForCourse` ADDS newly-created lessons to live assignments
 * without disturbing the records already there. Adding work propagates;
 * reinterpreting existing work does not.
 *
 * ---------------------------------------------------------------------------
 * Deletion is soft, everywhere, and refused where it would orphan
 * ---------------------------------------------------------------------------
 * A path that has ever been assigned keeps its name, or every assignment row
 * loses its provenance - the defect `OnboardingModels.js` records about its own
 * reference's hard-deleted templates.
 */

import {
  LearningPath,
  AcademyCourse,
  Assessment,
  LearningAssignment,
} from '../../../models/hrms/AcademyModels.js';
import User from '../../../models/User.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS } from '../../../shared/constants/hrms.js';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  CONTENT_LESSON_TYPES,
  LESSONS_MAX,
} from '../../../shared/constants/academy.js';
import {
  createPathSchema,
  updatePathSchema,
  pathListQuerySchema,
  createCourseSchema,
  updateCourseSchema,
  reorderCoursesSchema,
  createLessonSchema,
  updateLessonSchema,
  reorderLessonsSchema,
} from '../../../shared/schemas/academy.js';
import {
  HrmsNotFoundError,
  HrmsConflictError,
  HrmsValidationError,
} from '../hrms.errors.js';
import { deriveStatus } from '../../../shared/academy/progress.js';
import { contentByIds } from './content.service.js';
import {
  idStr,
  oid,
  iso,
  parse,
  escapeRegex,
  assertCanManage,
  canManageAcademy,
  page,
  skipOf,
} from './academy.shared.js';

const isDuplicateKey = (error) => error?.code === 11000;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * The three states the catalogue presents, derived from what is stored.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DERIVED AND NOT A FOURTH COLUMN
 * ---------------------------------------------------------------------------
 * The screen wants Active / Draft / Archived. The model stores one boolean,
 * `active`, and that boolean is load-bearing: the rule engine, the assign
 * endpoint and the learner-facing queries all gate on it. Replacing it with an
 * enum would mean migrating every one of those, for a distinction that is
 * already visible in the data.
 *
 *   archived - `active: false`. Explicitly withdrawn; cannot be assigned.
 *   draft    - active, but no courses. Started and never finished: assigning it
 *              would give somebody a path that completes the instant it lands.
 *   active   - active, with something in it.
 *
 * "Draft" is therefore not a flag somebody forgot to clear - it is the real,
 * actionable state of a path nobody can usefully be given, which is exactly
 * what an administrator opening this screen is looking for.
 *
 * It is defined ONCE, here, and the list pipeline reproduces it in aggregation
 * operators so filtering and display cannot disagree. Change one, change both -
 * and `academy-api.test.js` asserts they still match.
 */
export function derivePathStatus(row, courseCount) {
  if (row.active === false) return 'archived';
  return (courseCount ?? 0) === 0 ? 'draft' : 'active';
}

export function toPathDto(
  row,
  { courseCount = null, assignedCount = null, lessonCount = null, assessmentCount = null } = {},
) {
  return {
    id: idStr(row._id),
    name: row.name,
    description: row.description ?? null,
    tags: row.tags ?? [],
    audience: {
      departmentIds: (row.audience?.departmentIds ?? []).map(idStr),
      locationIds: (row.audience?.locationIds ?? []).map(idStr),
      designations: row.audience?.designations ?? [],
      employmentTypes: row.audience?.employmentTypes ?? [],
    },
    dueDateMode: row.dueDateMode,
    dueDays: row.dueDays ?? null,
    dueDate: row.dueDate ?? null,
    mandatory: row.mandatory !== false,
    sequential: row.sequential === true,
    requiresCertificate: row.requiresCertificate === true,
    certificateValidityMonths: row.certificateValidityMonths ?? null,
    active: row.active !== false,
    status: row.status ?? derivePathStatus(row, courseCount),
    courseCount,
    lessonCount,
    assessmentCount,
    assignedCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * A lesson, as the CATALOGUE sees it.
 *
 * Carries `contentMissing` rather than silently omitting a lesson whose content
 * has been removed: section 24 asks that deleted content not break a course,
 * and the honest way to do that is to keep the lesson visible and say what is
 * wrong with it. Omitting it would make a course quietly shorter and a
 * mandatory lesson quietly disappear.
 */
export function toLessonDto(lesson, content = null) {
  const needsContent = CONTENT_LESSON_TYPES.includes(lesson.type);
  return {
    id: idStr(lesson._id),
    title: lesson.title,
    description: lesson.description ?? null,
    type: lesson.type,
    contentId: idStr(lesson.contentId),
    assessmentId: idStr(lesson.assessmentId),
    mandatory: lesson.mandatory !== false,
    videoCompletionPercent: lesson.videoCompletionPercent,
    order: lesson.order,
    content: content
      ? {
          title: content.title,
          type: content.type,
          mimeType: content.mimeType,
          durationSeconds: content.durationSeconds ?? null,
          fileSize: content.fileSize ?? null,
          active: content.active !== false && !content.deletedAt,
        }
      : null,
    contentMissing: needsContent && !content,
  };
}

export function toCourseDto(row, contentMap = new Map()) {
  const lessons = [...(row.lessons ?? [])].sort((a, b) => a.order - b.order);
  return {
    id: idStr(row._id),
    pathId: idStr(row.pathId),
    name: row.name,
    description: row.description ?? null,
    estimatedMinutes: row.estimatedMinutes ?? null,
    mandatory: row.mandatory !== false,
    prerequisiteCourseId: idStr(row.prerequisiteCourseId),
    order: row.order,
    active: row.active !== false,
    lessonCount: lessons.length,
    mandatoryLessonCount: lessons.filter((l) => l.mandatory !== false).length,
    lessons: lessons.map((l) => toLessonDto(l, contentMap.get(idStr(l.contentId)) ?? null)),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Learning paths - reads
// ---------------------------------------------------------------------------

/**
 * The path catalogue.
 *
 * Two audiences, one query. An ADMIN sees everything including inactive paths;
 * anyone else sees only active ones, because a learner's "browse the catalogue"
 * must not advertise a path that has been withdrawn.
 */
export async function listPaths(actor, query) {
  const q = parse(pathListQuerySchema, query, 'learning path query');
  const admin = canManageAcademy(actor);

  const filter = { deletedAt: null };
  if (!admin) filter.active = true;
  else if (q.active !== undefined) filter.active = q.active;

  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { description: rx }, { tags: rx }];
  }
  if (q.departmentId) filter['audience.departmentIds'] = oid(q.departmentId);
  if (q.tag) filter.tags = q.tag;

  /**
   * ---------------------------------------------------------------------------
   * ONE PIPELINE, BECAUSE STATUS IS A FILTER AND NOT JUST A LABEL
   * ---------------------------------------------------------------------------
   * `status` is derived from the course count (see `derivePathStatus`), so it
   * cannot be applied as a `find()` condition. Deriving it in application code
   * after the page was fetched would filter the 25 rows already returned and
   * leave `total` counting the unfiltered set - a pager that reports 12 results
   * and shows 4, which is the bug this shape exists to avoid.
   *
   * So the derivation happens in the database, before `$skip`/`$limit`, and the
   * count comes from the same pipeline. The `$lookup` is bounded by the number
   * of PATHS, which is a catalogue a company curates by hand - dozens, not the
   * unbounded collections AD-13 is about - and the inner match is on an indexed
   * `pathId`.
   */
  const lessonsOf = { $ifNull: ['$$course.lessons', []] };

  const enrich = [
    {
      $lookup: {
        from: AcademyCourse.collection.name,
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$pathId', '$$pid'] }, deletedAt: null } },
          { $project: { 'lessons.type': 1 } },
        ],
        as: 'courseDocs',
      },
    },
    {
      $lookup: {
        from: LearningAssignment.collection.name,
        let: { pid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$pathId', '$$pid'] },
              status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
            },
          },
          { $count: 'n' },
        ],
        as: 'assignedDocs',
      },
    },
    {
      $addFields: {
        courseCount: { $size: '$courseDocs' },
        lessonCount: {
          $sum: {
            $map: { input: '$courseDocs', as: 'course', in: { $size: lessonsOf } },
          },
        },
        assessmentCount: {
          $sum: {
            $map: {
              input: '$courseDocs',
              as: 'course',
              in: {
                $size: {
                  $filter: {
                    input: lessonsOf,
                    as: 'lesson',
                    cond: { $eq: ['$$lesson.type', 'quiz'] },
                  },
                },
              },
            },
          },
        },
        assignedCount: { $ifNull: [{ $first: '$assignedDocs.n' }, 0] },
      },
    },
    {
      // The aggregation twin of `derivePathStatus`. Both are asserted to agree.
      $addFields: {
        status: {
          $cond: [
            { $eq: ['$active', false] },
            'archived',
            { $cond: [{ $eq: ['$courseCount', 0] }, 'draft', 'active'] },
          ],
        },
      },
    },
    { $project: { courseDocs: 0, assignedDocs: 0 } },
  ];

  const SORTS = {
    updated: { updatedAt: -1, name: 1 },
    created: { createdAt: -1, name: 1 },
    name: { name: 1 },
    assigned: { assignedCount: -1, name: 1 },
  };

  const [result] = await LearningPath.aggregate([
    { $match: filter },
    ...enrich,
    {
      $facet: {
        /**
         * The tiles count what the SEARCH matched, before the status filter.
         *
         * So typing a word narrows every tile together, and clicking "Drafts"
         * does not zero the other three - which is what makes the tiles usable
         * as filters rather than as a readout that collapses the moment you use
         * it.
         */
        summary: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        rows: [
          ...(q.status ? [{ $match: { status: q.status } }] : []),
          { $sort: SORTS[q.sort] ?? SORTS.updated },
          { $skip: skipOf(q) },
          { $limit: q.pageSize },
        ],
        total: [
          ...(q.status ? [{ $match: { status: q.status } }] : []),
          { $count: 'n' },
        ],
      },
    },
  ]);

  const counts = Object.fromEntries((result?.summary ?? []).map((r) => [r._id, r.n]));

  return {
    ...page(
      (result?.rows ?? []).map((r) =>
        toPathDto(r, {
          courseCount: r.courseCount,
          lessonCount: r.lessonCount,
          assessmentCount: r.assessmentCount,
          assignedCount: r.assignedCount,
        }),
      ),
      result?.total?.[0]?.n ?? 0,
      q,
    ),
    summary: {
      total: (counts.active ?? 0) + (counts.draft ?? 0) + (counts.archived ?? 0),
      active: counts.active ?? 0,
      draft: counts.draft ?? 0,
      archived: counts.archived ?? 0,
    },
  };
}

/** One path with its courses, in sequence, each with its lessons. */
export async function getPath(id, actor) {
  const admin = canManageAcademy(actor);
  const filter = { _id: id, deletedAt: null };
  if (!admin) filter.active = true;

  const path = await LearningPath.findOne(filter).lean();
  if (!path) throw new HrmsNotFoundError('Learning path');

  const courseFilter = { pathId: path._id, deletedAt: null };
  // A learner sees active courses only; an admin sees the archived ones too,
  // because that is the screen where they are un-archived.
  if (!admin) courseFilter.active = true;

  const courses = await AcademyCourse.find(courseFilter).sort({ order: 1 }).lean();
  const contentMap = await contentByIds(
    courses.flatMap((c) => (c.lessons ?? []).map((l) => l.contentId)),
  );

  const [courseCount, assignedCount] = await Promise.all([
    AcademyCourse.countDocuments({ pathId: path._id, deletedAt: null }),
    LearningAssignment.countDocuments({
      pathId: path._id,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
    }),
  ]);

  /**
   * Who made it, by NAME.
   *
   * The row stores `createdByUserId` only. The detail panel says "Created by
   * Sumedh", and a screen that renders a 24-character id there is a screen
   * nobody reads - so the two ids are resolved in one query, here, where there
   * are at most two of them. The list deliberately does NOT do this: it would
   * be a join per row for a line the cards do not show.
   */
  const authorIds = [path.createdByUserId, path.updatedByUserId].filter(Boolean);
  const authors = authorIds.length
    ? await User.find({ _id: { $in: authorIds } })
        // 🔴 The display name on User is `user`, NOT `name` - the same pair
        // `audit.service.js` selects, and it falls back to the email for an
        // account that has never been given one.
        .select('user email')
        .lean()
        .catch(() => [])
    : [];
  const nameOf = new Map(authors.map((u) => [idStr(u._id), u.user || u.email || null]));

  const lessons = courses.flatMap((c) => c.lessons ?? []);

  return {
    ...toPathDto(path, {
      courseCount,
      assignedCount,
      lessonCount: lessons.length,
      assessmentCount: lessons.filter((l) => l.type === 'quiz').length,
    }),
    createdByName: nameOf.get(idStr(path.createdByUserId)) ?? null,
    updatedByName: nameOf.get(idStr(path.updatedByUserId)) ?? null,
    courses: courses.map((c) => toCourseDto(c, contentMap)),
  };
}

// ---------------------------------------------------------------------------
// Learning paths - writes
// ---------------------------------------------------------------------------

export async function createPath(body, actor, context = {}) {
  assertCanManage(actor, 'learning paths');
  const dto = parse(createPathSchema, body, 'learning path');

  let row;
  try {
    row = await LearningPath.create({
      ...dto,
      audience: dto.audience ?? {},
      createdByUserId: actor.userId ?? null,
      updatedByUserId: actor.userId ?? null,
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new HrmsConflictError(`A learning path called "${dto.name}" already exists.`, {
        code: 'PATH_NAME_IN_USE',
      });
    }
    throw error;
  }

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_PATH_CREATED,
    `Created learning path "${dto.name}"`,
    context.req,
    { meta: { pathId: idStr(row._id), mandatory: dto.mandatory, sequential: dto.sequential } },
  );

  return toPathDto(row.toObject(), { courseCount: 0, assignedCount: 0 });
}

export async function updatePath(id, body, actor, context = {}) {
  assertCanManage(actor, 'learning paths');
  const dto = parse(updatePathSchema, body, 'learning path');

  const row = await LearningPath.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Learning path');

  for (const key of [
    'name', 'description', 'audience', 'tags', 'dueDateMode', 'dueDays', 'dueDate',
    'mandatory', 'sequential', 'requiresCertificate', 'certificateValidityMonths', 'active',
  ]) {
    if (dto[key] !== undefined) row[key] = dto[key];
  }
  row.updatedByUserId = actor.userId ?? null;

  /**
   * The due-date configuration has to stay internally consistent after a
   * PARTIAL update too.
   *
   * `updatePathSchema` cannot check this on its own: a request that changes
   * only `dueDateMode` to `fixed` passes field-level validation while leaving
   * the row with no date. Re-validating the MERGED result is the only place
   * that catches it.
   */
  if (
    (row.dueDateMode === 'joining_plus_days' || row.dueDateMode === 'assigned_plus_days') &&
    row.dueDays == null
  ) {
    throw new HrmsValidationError('Say how many days this is due in.', [
      { path: 'dueDays', message: 'Required for this due-date mode.' },
    ]);
  }
  if (row.dueDateMode === 'fixed' && !row.dueDate) {
    throw new HrmsValidationError('Pick the date this is due.', [
      { path: 'dueDate', message: 'Required for a fixed due date.' },
    ]);
  }

  try {
    await row.save();
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new HrmsConflictError(`A learning path called "${row.name}" already exists.`, {
        code: 'PATH_NAME_IN_USE',
      });
    }
    throw error;
  }

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_PATH_UPDATED,
    `Updated learning path "${row.name}"`,
    context.req,
    { meta: { pathId: idStr(row._id), fields: Object.keys(dto) } },
  );

  return toPathDto(row.toObject());
}

/**
 * Retire a path.
 *
 * REFUSED while anyone is still working through it. Withdrawing a path from
 * under a learner mid-way is not a delete, it is data loss with a friendly
 * name - the assignment would keep pointing at a row the UI can no longer
 * resolve. Cancel the assignments first, deliberately, or deactivate the path
 * so it stops being assigned while the people on it finish.
 */
export async function deletePath(id, actor, context = {}) {
  assertCanManage(actor, 'learning paths');

  const row = await LearningPath.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Learning path');

  const live = await LearningAssignment.countDocuments({
    pathId: row._id,
    status: { $in: ['assigned', 'in_progress'] },
  });
  if (live > 0) {
    throw new HrmsConflictError(
      `${live} employee(s) are still working through "${row.name}". Deactivate it instead, or cancel those assignments first.`,
      { code: 'PATH_IN_USE', details: { activeAssignments: live } },
    );
  }

  row.deletedAt = new Date();
  row.active = false;
  await row.save();

  // The courses go with it. Soft, so a completed assignment's history still
  // resolves every course name it references.
  await AcademyCourse.updateMany(
    { pathId: row._id, deletedAt: null },
    { $set: { deletedAt: new Date(), active: false } },
  );

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_PATH_DELETED,
    `Deleted learning path "${row.name}"`,
    context.req,
    { meta: { pathId: idStr(row._id) } },
  );

  return { id: idStr(row._id), deleted: true };
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/**
 * Validate a prerequisite.
 *
 * Three ways it can be wrong, and all three produce a lock with no key:
 * pointing at itself, at a course in a different path, or at one that comes
 * LATER in the sequence. The last is the subtle one - a course whose
 * prerequisite is downstream of it can never be unlocked by anyone, and the
 * only symptom is a learner stuck on a screen that says "complete X first"
 * where X is itself locked behind them.
 */
async function assertPrerequisiteIsSane(pathId, courseId, prerequisiteCourseId, order) {
  if (!prerequisiteCourseId) return;

  if (courseId && idStr(prerequisiteCourseId) === idStr(courseId)) {
    throw new HrmsValidationError('A course cannot be its own prerequisite.', [
      { path: 'prerequisiteCourseId', message: 'Pick a different course.' },
    ]);
  }

  const prereq = await AcademyCourse.findOne({
    _id: prerequisiteCourseId,
    deletedAt: null,
  })
    .select('pathId order name')
    .lean()
    .catch(() => null);

  if (!prereq) {
    throw new HrmsValidationError('That prerequisite course does not exist.', [
      { path: 'prerequisiteCourseId', message: 'Unknown course.' },
    ]);
  }
  if (idStr(prereq.pathId) !== idStr(pathId)) {
    throw new HrmsValidationError(
      'A prerequisite must be a course in the same learning path.',
      [{ path: 'prerequisiteCourseId', message: 'That course belongs to another path.' }],
    );
  }
  if (order !== undefined && order !== null && prereq.order >= order) {
    throw new HrmsValidationError(
      `"${prereq.name}" comes after this course, so it could never be completed first.`,
      [{ path: 'prerequisiteCourseId', message: 'Pick a course that comes earlier.' }],
    );
  }
}

export async function createCourse(body, actor, context = {}) {
  assertCanManage(actor, 'courses');
  const dto = parse(createCourseSchema, body, 'course');

  const path = await LearningPath.findOne({ _id: dto.pathId, deletedAt: null })
    .select('_id name')
    .lean();
  if (!path) {
    throw new HrmsValidationError('Unknown learning path.', [
      { path: 'pathId', message: 'That learning path does not exist.' },
    ]);
  }

  // Append. The order is a dense 0..n-1 sequence maintained by `reorderCourses`.
  const last = await AcademyCourse.findOne({ pathId: path._id, deletedAt: null })
    .sort({ order: -1 })
    .select('order')
    .lean();
  const order = last ? last.order + 1 : 0;

  await assertPrerequisiteIsSane(path._id, null, dto.prerequisiteCourseId, order);

  const row = await AcademyCourse.create({
    pathId: path._id,
    name: dto.name,
    description: dto.description ?? null,
    estimatedMinutes: dto.estimatedMinutes ?? null,
    mandatory: dto.mandatory,
    prerequisiteCourseId: dto.prerequisiteCourseId ?? null,
    order,
    active: dto.active,
    lessons: [],
    createdByUserId: actor.userId ?? null,
  });

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_COURSE_CREATED,
    `Created course "${dto.name}" in "${path.name}"`,
    context.req,
    { meta: { courseId: idStr(row._id), pathId: idStr(path._id), order } },
  );

  return toCourseDto(row.toObject());
}

export async function getCourse(id, actor) {
  const admin = canManageAcademy(actor);
  const filter = { _id: id, deletedAt: null };
  if (!admin) filter.active = true;

  const row = await AcademyCourse.findOne(filter).lean();
  if (!row) throw new HrmsNotFoundError('Course');

  const contentMap = await contentByIds((row.lessons ?? []).map((l) => l.contentId));
  return toCourseDto(row, contentMap);
}

export async function updateCourse(id, body, actor, context = {}) {
  assertCanManage(actor, 'courses');
  const dto = parse(updateCourseSchema, body, 'course');

  const row = await AcademyCourse.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Course');

  if (dto.prerequisiteCourseId !== undefined) {
    await assertPrerequisiteIsSane(row.pathId, row._id, dto.prerequisiteCourseId, row.order);
  }

  for (const key of [
    'name', 'description', 'estimatedMinutes', 'mandatory', 'prerequisiteCourseId', 'active',
  ]) {
    if (dto[key] !== undefined) row[key] = dto[key];
  }
  await row.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_COURSE_UPDATED,
    `Updated course "${row.name}"`,
    context.req,
    { meta: { courseId: idStr(row._id), fields: Object.keys(dto) } },
  );

  return toCourseDto(row.toObject());
}

/**
 * Reorder a path's courses.
 *
 * ONE call carrying the whole new order, applied as a single `bulkWrite`. The
 * alternative - N "move up" requests - is N round trips that can interleave
 * with each other and leave the sequence with duplicate or missing positions.
 *
 * The list must be complete: a partial reorder is rejected rather than applied,
 * because reordering three of five courses leaves the other two at positions
 * that now collide.
 */
export async function reorderCourses(pathId, body, actor, context = {}) {
  assertCanManage(actor, 'courses');
  const dto = parse(reorderCoursesSchema, body, 'course order');

  const path = await LearningPath.findOne({ _id: pathId, deletedAt: null }).select('name').lean();
  if (!path) throw new HrmsNotFoundError('Learning path');

  const existing = await AcademyCourse.find({ pathId: oid(pathId), deletedAt: null })
    .select('_id')
    .lean();

  const have = new Set(existing.map((c) => idStr(c._id)));
  const given = dto.courseIds.map(idStr);

  if (new Set(given).size !== given.length) {
    throw new HrmsValidationError('That order lists the same course twice.');
  }
  if (given.length !== have.size || !given.every((id) => have.has(id))) {
    throw new HrmsValidationError(
      'Send the complete list of courses in this path, in their new order.',
      [{ path: 'courseIds', message: `Expected ${have.size} course id(s).` }],
    );
  }

  await AcademyCourse.bulkWrite(
    given.map((id, index) => ({
      updateOne: { filter: { _id: oid(id) }, update: { $set: { order: index } } },
    })),
  );

  /**
   * A reorder can invalidate a prerequisite that was legal when it was set:
   * dragging course 4 above its own prerequisite makes the dependency point
   * forwards, which is the unsatisfiable case `assertPrerequisiteIsSane`
   * refuses at write time.
   *
   * Clearing it is the only safe repair - keeping it would wall off the rest of
   * the path with no way for a learner to act, and guessing a replacement would
   * be inventing curriculum. The admin is told which ones were cleared.
   */
  const after = await AcademyCourse.find({ pathId: oid(pathId), deletedAt: null })
    .select('_id name order prerequisiteCourseId')
    .lean();

  const orderById = new Map(after.map((c) => [idStr(c._id), c.order]));
  const broken = after.filter((c) => {
    if (!c.prerequisiteCourseId) return false;
    const prereqOrder = orderById.get(idStr(c.prerequisiteCourseId));
    return prereqOrder === undefined || prereqOrder >= c.order;
  });

  if (broken.length > 0) {
    await AcademyCourse.updateMany(
      { _id: { $in: broken.map((c) => c._id) } },
      { $set: { prerequisiteCourseId: null } },
    );
  }

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_COURSE_REORDERED,
    `Reordered the courses in "${path.name}"`,
    context.req,
    {
      meta: {
        pathId: idStr(pathId),
        count: given.length,
        prerequisitesCleared: broken.map((c) => c.name),
      },
    },
  );

  return {
    reordered: given.length,
    prerequisitesCleared: broken.map((c) => ({ id: idStr(c._id), name: c.name })),
  };
}

/**
 * Remove a course.
 *
 * Refused while a live assignment still owes its lessons - the same argument as
 * `deletePath`. Deactivating is the move for "stop teaching this", and it is
 * the one that leaves people mid-path unharmed.
 */
export async function deleteCourse(id, actor, context = {}) {
  assertCanManage(actor, 'courses');

  const row = await AcademyCourse.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Course');

  const live = await LearningAssignment.countDocuments({
    pathId: row.pathId,
    status: { $in: ['assigned', 'in_progress'] },
    'lessons.courseId': row._id,
  });
  if (live > 0) {
    throw new HrmsConflictError(
      `${live} employee(s) still have lessons from "${row.name}" outstanding. Deactivate the course instead.`,
      { code: 'COURSE_IN_USE', details: { activeAssignments: live } },
    );
  }

  row.deletedAt = new Date();
  row.active = false;
  await row.save();

  // Anything that named this course as its prerequisite would otherwise be
  // locked behind a course that no longer exists.
  await AcademyCourse.updateMany(
    { prerequisiteCourseId: row._id, deletedAt: null },
    { $set: { prerequisiteCourseId: null } },
  );

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_COURSE_DELETED,
    `Deleted course "${row.name}"`,
    context.req,
    { meta: { courseId: idStr(row._id), pathId: idStr(row.pathId) } },
  );

  return { id: idStr(row._id), deleted: true };
}

// ---------------------------------------------------------------------------
// Lessons - embedded, so every mutation is one atomic document write
// ---------------------------------------------------------------------------

export async function addLesson(courseId, body, actor, context = {}) {
  assertCanManage(actor, 'lessons');
  const dto = parse(createLessonSchema, body, 'lesson');

  const course = await AcademyCourse.findOne({ _id: courseId, deletedAt: null });
  if (!course) throw new HrmsNotFoundError('Course');

  if ((course.lessons?.length ?? 0) >= LESSONS_MAX) {
    throw new HrmsConflictError(
      `A course may hold at most ${LESSONS_MAX} lessons. Split it into two.`,
      { code: 'LESSON_LIMIT_REACHED' },
    );
  }

  // The reference it points at has to exist, or the lesson is a dead end the
  // learner discovers rather than the author.
  if (dto.type === 'quiz') {
    const assessment = await Assessment.findOne({ _id: dto.assessmentId, deletedAt: null })
      .select('_id')
      .lean();
    if (!assessment) {
      throw new HrmsValidationError('Unknown assessment.', [
        { path: 'assessmentId', message: 'That assessment does not exist.' },
      ]);
    }
  } else {
    const map = await contentByIds([dto.contentId]);
    const content = map.get(idStr(dto.contentId));
    if (!content || content.deletedAt) {
      throw new HrmsValidationError('Unknown content item.', [
        { path: 'contentId', message: 'That content item does not exist.' },
      ]);
    }
    if (content.type !== dto.type) {
      throw new HrmsValidationError(
        `That content item is a ${content.type}, not a ${dto.type}.`,
        [{ path: 'contentId', message: 'Pick a content item of the right type.' }],
      );
    }
  }

  const order = (course.lessons ?? []).reduce((max, l) => Math.max(max, l.order + 1), 0);

  course.lessons.push({
    title: dto.title,
    description: dto.description ?? null,
    type: dto.type,
    contentId: dto.type === 'quiz' ? null : oid(dto.contentId),
    assessmentId: dto.type === 'quiz' ? oid(dto.assessmentId) : null,
    mandatory: dto.mandatory,
    videoCompletionPercent: dto.videoCompletionPercent,
    order,
  });

  await course.save();
  const created = course.lessons[course.lessons.length - 1];

  /**
   * Live assignments gain the new lesson.
   *
   * This is the half of the snapshot rule that ADDS work. Without it a lesson
   * added to a mandatory compliance course would be owed by nobody already
   * assigned - which is precisely the case where it matters most.
   */
  const touched = await syncAssignmentsForCourse(course, created);

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_LESSON_CREATED,
    `Added lesson "${dto.title}" to "${course.name}"`,
    context.req,
    {
      meta: {
        courseId: idStr(course._id),
        lessonId: idStr(created._id),
        type: dto.type,
        assignmentsUpdated: touched,
      },
    },
  );

  const contentMap = await contentByIds([created.contentId]);
  return {
    ...toLessonDto(created, contentMap.get(idStr(created.contentId)) ?? null),
    assignmentsUpdated: touched,
  };
}

export async function updateLesson(courseId, lessonId, body, actor, context = {}) {
  assertCanManage(actor, 'lessons');
  const dto = parse(updateLessonSchema, body, 'lesson');

  const course = await AcademyCourse.findOne({ _id: courseId, deletedAt: null });
  if (!course) throw new HrmsNotFoundError('Course');

  const lesson = course.lessons.id(lessonId);
  if (!lesson) throw new HrmsNotFoundError('Lesson');

  for (const key of ['title', 'description', 'mandatory', 'videoCompletionPercent']) {
    if (dto[key] !== undefined) lesson[key] = dto[key];
  }
  await course.save();

  /**
   * NOTE what does not happen here.
   *
   * Changing `mandatory` or the video threshold does NOT rewrite the lesson
   * records on existing assignments. Those are snapshots of what each learner
   * was told they owed, and retroactively marking a lesson optional would
   * complete a compliance path for people who never opened it - see this file's
   * header. New assignments pick the change up; existing ones keep their terms.
   */
  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_LESSON_UPDATED,
    `Updated lesson "${lesson.title}" in "${course.name}"`,
    context.req,
    { meta: { courseId: idStr(course._id), lessonId: idStr(lesson._id), fields: Object.keys(dto) } },
  );

  const contentMap = await contentByIds([lesson.contentId]);
  return toLessonDto(lesson, contentMap.get(idStr(lesson.contentId)) ?? null);
}

export async function reorderLessons(courseId, body, actor, context = {}) {
  assertCanManage(actor, 'lessons');
  const dto = parse(reorderLessonsSchema, body, 'lesson order');

  const course = await AcademyCourse.findOne({ _id: courseId, deletedAt: null });
  if (!course) throw new HrmsNotFoundError('Course');

  const have = new Set((course.lessons ?? []).map((l) => idStr(l._id)));
  const given = dto.lessonIds.map(idStr);

  if (new Set(given).size !== given.length) {
    throw new HrmsValidationError('That order lists the same lesson twice.');
  }
  if (given.length !== have.size || !given.every((id) => have.has(id))) {
    throw new HrmsValidationError(
      'Send the complete list of lessons in this course, in their new order.',
      [{ path: 'lessonIds', message: `Expected ${have.size} lesson id(s).` }],
    );
  }

  given.forEach((id, index) => {
    course.lessons.id(id).order = index;
  });
  await course.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_LESSON_UPDATED,
    `Reordered the lessons in "${course.name}"`,
    context.req,
    { meta: { courseId: idStr(course._id), count: given.length } },
  );

  const contentMap = await contentByIds((course.lessons ?? []).map((l) => l.contentId));
  return toCourseDto(course.toObject(), contentMap);
}

/**
 * Remove a lesson.
 *
 * Refused while any live assignment still has it OUTSTANDING. A lesson somebody
 * has already completed can be removed - their record of having done it stays
 * on the assignment, and removing it from future work is exactly what an
 * administrator means. A lesson somebody still owes cannot: deleting it would
 * silently reduce what they were told to complete, and a path could jump to
 * 100% because work was withdrawn rather than done.
 */
export async function deleteLesson(courseId, lessonId, actor, context = {}) {
  assertCanManage(actor, 'lessons');

  const course = await AcademyCourse.findOne({ _id: courseId, deletedAt: null });
  if (!course) throw new HrmsNotFoundError('Course');

  const lesson = course.lessons.id(lessonId);
  if (!lesson) throw new HrmsNotFoundError('Lesson');

  const outstanding = await LearningAssignment.countDocuments({
    status: { $in: ['assigned', 'in_progress'] },
    lessons: { $elemMatch: { lessonId: lesson._id, status: { $ne: 'completed' } } },
  });
  if (outstanding > 0) {
    throw new HrmsConflictError(
      `${outstanding} employee(s) still have "${lesson.title}" outstanding. Make it optional instead, or cancel those assignments.`,
      { code: 'LESSON_IN_USE', details: { outstanding } },
    );
  }

  const title = lesson.title;
  course.lessons.pull({ _id: lesson._id });
  // Keep the sequence dense, so "order" stays an index rather than a sparse
  // set of numbers that later reorders have to reason about.
  [...course.lessons]
    .sort((a, b) => a.order - b.order)
    .forEach((l, index) => {
      l.order = index;
    });
  await course.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_LESSON_DELETED,
    `Deleted lesson "${title}" from "${course.name}"`,
    context.req,
    { meta: { courseId: idStr(course._id), lessonId: idStr(lessonId) } },
  );

  return { id: idStr(lessonId), deleted: true };
}

// ---------------------------------------------------------------------------
// Keeping live assignments in step
// ---------------------------------------------------------------------------

/**
 * Add a newly-created lesson to every live assignment for its path.
 *
 * ADDITIVE ONLY. It appends one `not_started` record and never touches an
 * existing one, so a learner's completed work is untouched and their percentage
 * simply has a larger denominator - which is the truthful outcome when the
 * syllabus grows.
 *
 * The status is recomputed afterwards because adding a mandatory lesson can
 * legitimately move an assignment OUT of `completed`. That is the intended
 * behaviour and the reason `deriveStatus` recomputes rather than latches: a
 * compliance path with new required material is no longer complete, and saying
 * otherwise would be the system lying about a regulatory fact.
 */
export async function syncAssignmentsForCourse(course, lesson) {
  const assignments = await LearningAssignment.find({
    pathId: course.pathId,
    status: { $in: ['assigned', 'in_progress', 'completed'] },
    'lessons.lessonId': { $ne: lesson._id },
  });

  let touched = 0;
  for (const assignment of assignments) {
    // A course added to the path AFTER this person was assigned is not part of
    // their assignment at all, so a lesson inside it is not either. Only
    // courses they already carry gain lessons.
    const carriesCourse = assignment.lessons.some(
      (r) => idStr(r.courseId) === idStr(course._id),
    );
    if (!carriesCourse) continue;

    assignment.lessons.push({
      courseId: course._id,
      lessonId: lesson._id,
      title: lesson.title,
      type: lesson.type,
      mandatory: lesson.mandatory !== false,
      status: 'not_started',
    });

    const next = deriveStatus(assignment.lessons, assignment.status);
    if (next !== assignment.status) {
      assignment.status = next;
      // Reopened by new material: the completion date no longer describes
      // anything true, so it goes rather than becoming a stale artefact.
      if (next !== 'completed') assignment.completedAt = null;
    }

    await assignment.save();
    touched += 1;
  }

  return touched;
}

/** Courses of a path, with lessons, for the assignment builder. */
export async function coursesForAssignment(pathId) {
  return AcademyCourse.find({ pathId: oid(pathId), deletedAt: null, active: true })
    .sort({ order: 1 })
    .lean();
}

export default {
  toPathDto,
  toCourseDto,
  toLessonDto,
  listPaths,
  getPath,
  createPath,
  updatePath,
  deletePath,
  createCourse,
  getCourse,
  updateCourse,
  reorderCourses,
  deleteCourse,
  addLesson,
  updateLesson,
  reorderLessons,
  deleteLesson,
  syncAssignmentsForCourse,
  coursesForAssignment,
};
