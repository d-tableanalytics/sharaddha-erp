/**
 * SI Academy collections.
 *
 * Follows the accepted decisions the rest of HRMS is built on:
 *
 *   AD-1   single tenant, so no organizationId
 *   AD-2   ObjectId keys, no foreign-key constraints - the services check
 *          references, as every other module here does
 *   AD-7   videos and documents live in object storage, never on the instance's
 *          disk, and are read only through a short-lived presigned URL
 *   AD-13  every list is server-paginated, so the indexes below matter
 *   AD-16  rows expire under a retention policy
 *
 * ---------------------------------------------------------------------------
 * 🔴 ONE PROGRESS ROW, NOT THREE
 * ---------------------------------------------------------------------------
 * The obvious model has LessonProgress, CourseProgress and LearningPathProgress
 * tables, each storing a percentage. That is three copies of one fact, and the
 * moment a lesson is added to a course every stored course percentage is
 * silently wrong until something recomputes it - which nothing ever does on the
 * rows nobody touched.
 *
 * So there is ONE row per employee per path - `LearningAssignment` - carrying
 * the lesson records. Course and path percentages are computed from it by
 * `shared/academy/progress.js` whenever they are needed. Adding a lesson to a
 * course changes every learner's percentage correctly and instantly, because
 * there was never a second number to update.
 *
 * The single field that IS stored is `status`, recomputed on every write rather
 * than latched - the decision `checklist.service.js#closeIfSettled` records for
 * onboarding. It is stored because the assignment LIST filters and sorts on it,
 * and a filter cannot run against a value computed in application code.
 *
 * `overdue` is not stored at all. It is a function of the due date and today.
 *
 * ---------------------------------------------------------------------------
 * 🔴 LESSONS ARE EMBEDDED, COURSES ARE NOT
 * ---------------------------------------------------------------------------
 * A lesson is never read without its course, the whole set is written in one
 * edit, and the count is bounded (LESSONS_MAX). That is the same argument
 * `OnboardingModels.js` makes for embedding its tasks, and it makes "reorder
 * the lessons" one atomic document write.
 *
 * A course is different: it belongs to a path, it is listed and paged on its
 * own, and a path with fifty courses each holding a hundred lessons would be a
 * document nobody can load. Courses are their own collection, ordered by an
 * `order` field within `pathId`.
 */

import mongoose from 'mongoose';

import {
  CONTENT_TYPES,
  LESSON_TYPES,
  LESSON_STATUSES,
  ASSIGNMENT_STATUSES,
  QUESTION_TYPES,
  SCORE_POLICIES,
  DUE_DATE_MODES,
  RULE_TRIGGERS,
  DEFAULT_VIDEO_COMPLETION_PERCENT,
  DEFAULT_PASSING_PERCENT,
  PATH_NAME_MAX,
  COURSE_NAME_MAX,
  LESSON_TITLE_MAX,
  DESCRIPTION_MAX,
  QUESTION_TEXT_MAX,
  OPTION_TEXT_MAX,
  LESSONS_MAX,
} from '../../shared/constants/academy.js';
import { EMPLOYMENT_TYPES } from '../../shared/constants/hrms.js';

const { Schema } = mongoose;

const isoDay = {
  type: String,
  default: null,
  match: [/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date'],
};

// ---------------------------------------------------------------------------
// ContentItem - the reusable library
// ---------------------------------------------------------------------------

/**
 * One uploaded video, PDF or document.
 *
 * REUSABLE ACROSS COURSES by design (section 15): a lesson holds a `contentId`,
 * so the same security-policy PDF can appear in the IT induction and the annual
 * refresher without a second upload and without a second object in the bucket.
 *
 * The consequence is that deleting a content item can orphan lessons, which is
 * why deletion is soft and why the service refuses to remove an item a lesson
 * still points at. Section 24 asks that missing content not break a course; the
 * cheapest way to honour that is to make content hard to lose.
 */
const contentItemSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: LESSON_TITLE_MAX },
    description: { type: String, default: null, trim: true, maxlength: DESCRIPTION_MAX },
    type: { type: String, required: true, enum: CONTENT_TYPES, index: true },

    /**
     * The storage layer's key. NEVER sent to a browser and never accepted from
     * one - reads go through `issueReadUrl`, which authorises, audits and
     * returns a short-lived URL. Same rule as `HrmsDocument.storageKey`.
     */
    storageKey: { type: String, required: true },
    storageCategory: { type: String, required: true },

    /** The SNIFFED type, not the one the client declared. */
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 0 },
    /** Display only; never used to build a path. */
    originalFilename: { type: String, default: null, maxlength: 260 },

    /**
     * Video length in seconds, reported by the uploader's browser.
     *
     * Advisory, and safe to be: it is only ever the DENOMINATOR of a completion
     * ratio whose numerator the server accumulates itself, so an inflated value
     * makes a video harder to complete rather than easier.
     */
    durationSeconds: { type: Number, default: null, min: 0 },

    tags: { type: [String], default: [] },

    active: { type: Boolean, required: true, default: true, index: true },

    uploadedByEmployeeId: { type: Schema.Types.ObjectId, default: null },
    uploadedByName: { type: String, default: '' },

    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: 'hrms_academy_content' },
);

contentItemSchema.index({ deletedAt: 1, type: 1, title: 1 });
contentItemSchema.index({ title: 'text', description: 'text' });

// ---------------------------------------------------------------------------
// LearningPath
// ---------------------------------------------------------------------------

/**
 * Who the path is for.
 *
 * Read, not decorative: the admin list renders it, and "Create assignment rule
 * from this path" prefills from it. The AUTHORITY on who is actually assigned
 * is `AssignmentRule` - this is the description, the rule is the behaviour.
 *
 * Worth stating explicitly because the onboarding template beside this one
 * carries `appliesToRoleKey` / `appliesToDepartmentId`, renders them in an
 * "Applies to" column, and reads them nowhere - a field that looks like
 * configuration and is documentation.
 */
const audienceSchema = new Schema(
  {
    departmentIds: { type: [Schema.Types.ObjectId], default: [] },
    locationIds: { type: [Schema.Types.ObjectId], default: [] },
    designations: { type: [String], default: [] },
    employmentTypes: { type: [String], default: [], enum: EMPLOYMENT_TYPES },
  },
  { _id: false },
);

const learningPathSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: PATH_NAME_MAX },
    description: { type: String, default: null, trim: true, maxlength: DESCRIPTION_MAX },

    audience: { type: audienceSchema, default: () => ({}) },

    /** How the due date is computed per assignment. See constants/academy.js. */
    dueDateMode: { type: String, required: true, enum: DUE_DATE_MODES, default: 'none' },
    dueDays: { type: Number, default: null, min: 1 },
    dueDate: isoDay,

    mandatory: { type: Boolean, required: true, default: true },

    /**
     * Courses must be completed in order.
     *
     * Configurable per path, as section 9 requires - a compliance library of
     * unrelated modules should not be a queue, and an induction should.
     */
    sequential: { type: Boolean, required: true, default: false },

    requiresCertificate: { type: Boolean, required: true, default: false },
    /** Months from issue. Null means it does not expire. */
    certificateValidityMonths: { type: Number, default: null, min: 1 },

    active: { type: Boolean, required: true, default: true, index: true },

    createdByUserId: { type: Schema.Types.ObjectId, default: null },
    updatedByUserId: { type: Schema.Types.ObjectId, default: null },

    /**
     * Soft delete, following the onboarding template's reasoning: a path that
     * has ever been assigned must keep its name, or every assignment row loses
     * its provenance and the employee's history reads as blank.
     */
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: 'hrms_academy_paths' },
);

learningPathSchema.index({ active: -1, name: 1 });
learningPathSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

// ---------------------------------------------------------------------------
// Course (+ embedded lessons)
// ---------------------------------------------------------------------------

const lessonSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: LESSON_TITLE_MAX },
    description: { type: String, default: null, trim: true, maxlength: DESCRIPTION_MAX },

    /**
     * STORED, never inferred from which id is set. `DocumentModels.js` records
     * why: an inferred discriminator changes meaning when the thing it points
     * at disappears.
     */
    type: { type: String, required: true, enum: LESSON_TYPES },

    /** Set for video / pdf / document lessons. */
    contentId: { type: Schema.Types.ObjectId, default: null },
    /** Set for quiz lessons. */
    assessmentId: { type: Schema.Types.ObjectId, default: null },

    mandatory: { type: Boolean, required: true, default: true },

    /** Per-lesson, so a 2-minute clip and a 40-minute induction can differ. */
    videoCompletionPercent: {
      type: Number,
      required: true,
      default: DEFAULT_VIDEO_COMPLETION_PERCENT,
      min: 1,
      max: 100,
    },

    order: { type: Number, required: true, default: 0, min: 0, max: 999 },
  },
  { _id: true },
);

const courseSchema = new Schema(
  {
    pathId: { type: Schema.Types.ObjectId, required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: COURSE_NAME_MAX },
    description: { type: String, default: null, trim: true, maxlength: DESCRIPTION_MAX },
    estimatedMinutes: { type: Number, default: null, min: 1 },

    mandatory: { type: Boolean, required: true, default: true },

    /**
     * An explicit prerequisite, independent of the path's `sequential` flag.
     * Validated in the service to be a course in the SAME path and not itself -
     * a cross-path prerequisite would be unsatisfiable for anyone not assigned
     * the other path, which is a lock with no key.
     */
    prerequisiteCourseId: { type: Schema.Types.ObjectId, default: null },

    order: { type: Number, required: true, default: 0, min: 0, max: 999 },

    lessons: {
      type: [lessonSchema],
      default: [],
      validate: {
        validator: (v) => Array.isArray(v) && v.length <= LESSONS_MAX,
        message: `A course may hold at most ${LESSONS_MAX} lessons.`,
      },
    },

    /**
     * Archived rather than deleted.
     *
     * An inactive course stays visible to anyone mid-path and stops being
     * added to new assignments - section 24's "inactive course" case. Hiding it
     * outright would make a learner's half-finished path lose a course and
     * jump to 100%, which reads as a system that lost their work.
     */
    active: { type: Boolean, required: true, default: true },

    createdByUserId: { type: Schema.Types.ObjectId, default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: 'hrms_academy_courses' },
);

courseSchema.index({ pathId: 1, deletedAt: 1, order: 1 });

// ---------------------------------------------------------------------------
// Assessment (+ embedded questions)
// ---------------------------------------------------------------------------

const optionSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: OPTION_TEXT_MAX },
    /**
     * 🔴 NEVER LEAVES THE SERVER for a learner.
     *
     * `toLearnerDto` in assessment.service.js strips this field. There is no
     * endpoint that returns a question with its answer key to anyone without
     * `academy:edit:org`, and the marking happens server-side from the stored
     * document - so a learner cannot read the answers out of the response they
     * are about to answer, which is how most quiz implementations leak.
     */
    isCorrect: { type: Boolean, required: true, default: false },
  },
  { _id: true },
);

const questionSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: QUESTION_TEXT_MAX },
    type: { type: String, required: true, enum: QUESTION_TYPES, default: 'single' },
    options: { type: [optionSchema], required: true },
    order: { type: Number, required: true, default: 0, min: 0, max: 999 },
  },
  { _id: true },
);

const assessmentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: LESSON_TITLE_MAX },
    description: { type: String, default: null, trim: true, maxlength: DESCRIPTION_MAX },

    passingPercent: {
      type: Number,
      required: true,
      default: DEFAULT_PASSING_PERCENT,
      min: 1,
      max: 100,
    },
    /** Null means unlimited retries. */
    maxAttempts: { type: Number, default: null, min: 1 },
    scorePolicy: { type: String, required: true, enum: SCORE_POLICIES, default: 'highest' },
    shuffleQuestions: { type: Boolean, required: true, default: false },

    questions: { type: [questionSchema], required: true },

    active: { type: Boolean, required: true, default: true, index: true },

    createdByUserId: { type: Schema.Types.ObjectId, default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: 'hrms_academy_assessments' },
);

assessmentSchema.index({ deletedAt: 1, active: -1, title: 1 });

// ---------------------------------------------------------------------------
// LearningAssignment - the one progress record
// ---------------------------------------------------------------------------

/**
 * One lesson's state for one learner.
 *
 * `courseId` and `lessonId` are denormalised onto every record so the rollup in
 * `shared/academy/progress.js` can group without loading the course documents.
 * `mandatory` and `type` are SNAPSHOT at assignment time for the same reason -
 * and, more importantly, so that an admin flipping a lesson to optional
 * half-way through a compliance year does not retroactively rewrite what
 * everybody already owed.
 */
const lessonRecordSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, required: true },
    lessonId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, default: null, maxlength: LESSON_TITLE_MAX },
    type: { type: String, required: true, enum: LESSON_TYPES },
    mandatory: { type: Boolean, required: true, default: true },

    status: { type: String, required: true, enum: LESSON_STATUSES, default: 'not_started' },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // ---- video ----------------------------------------------------------
    /**
     * Unique seconds genuinely watched, accumulated SERVER-SIDE from bounded
     * deltas. Not the playhead: dragging the scrubber to the end moves
     * `lastPositionSeconds` and leaves this untouched, which is the entire
     * point of storing two numbers.
     */
    watchedSeconds: { type: Number, required: true, default: 0, min: 0 },
    lastPositionSeconds: { type: Number, required: true, default: 0, min: 0 },
    /** Snapshot of the clip's length, so a re-upload cannot rewrite history. */
    videoDurationSeconds: { type: Number, default: null, min: 0 },
    /** Wall-clock guard for the delta clamp. See `recordVideoProgress`. */
    lastProgressAt: { type: Date, default: null },

    /** Rough engagement time, for the "time spent" column section 13 asks for. */
    timeSpentSeconds: { type: Number, required: true, default: 0, min: 0 },

    // ---- document -------------------------------------------------------
    acknowledgedAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * One sitting of one assessment.
 *
 * Append-only. A retry adds a record; it never edits the one before, because
 * "attempt 1 scored 60%" is a fact about what happened and section 16 asks for
 * the history rather than the latest value.
 */
const attemptSchema = new Schema(
  {
    assessmentId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    lessonId: { type: Schema.Types.ObjectId, required: true },

    attemptNo: { type: Number, required: true, min: 1 },
    submittedAt: { type: Date, required: true, default: Date.now },

    /** Server-computed, every one of them. */
    score: { type: Number, required: true, min: 0, max: 100 },
    correctCount: { type: Number, required: true, min: 0 },
    questionCount: { type: Number, required: true, min: 0 },
    passed: { type: Boolean, required: true },
    /** The bar at the time of the attempt - it may be raised later. */
    passingPercent: { type: Number, required: true, min: 1, max: 100 },

    /** What was ticked, for review. No correctness flags - those are marked live. */
    answers: {
      type: [
        new Schema(
          {
            questionId: { type: Schema.Types.ObjectId, required: true },
            selectedOptionIds: { type: [Schema.Types.ObjectId], default: [] },
            correct: { type: Boolean, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: true },
);

const learningAssignmentSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** Snapshot, so the row still reads correctly after the employee ages out. */
    employeeName: { type: String, default: '' },
    /** Denormalised for the admin list's department filter. */
    departmentId: { type: Schema.Types.ObjectId, default: null, index: true },

    pathId: { type: Schema.Types.ObjectId, required: true, index: true },
    pathName: { type: String, default: '' },

    /** How this came to exist, for the "why am I assigned this" question. */
    source: { type: String, required: true, enum: ['rule', 'manual'], default: 'manual' },
    ruleId: { type: Schema.Types.ObjectId, default: null },
    ruleName: { type: String, default: null },

    assignedAt: { type: Date, required: true, default: Date.now },
    assignedByUserId: { type: Schema.Types.ObjectId, default: null },

    dueDate: isoDay,

    /**
     * Recomputed from `lessons` on every write, never latched. `overdue` is
     * NOT here - it is a function of `dueDate` and today, computed on read.
     */
    status: {
      type: String,
      required: true,
      enum: ASSIGNMENT_STATUSES,
      default: 'assigned',
      index: true,
    },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: null },

    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, maxlength: 500 },

    /** Snapshot of the path's rule at assignment time. */
    sequential: { type: Boolean, required: true, default: false },
    mandatory: { type: Boolean, required: true, default: true },
    requiresCertificate: { type: Boolean, required: true, default: false },

    /**
     * What the reminder sweep last told this person, and when.
     *
     * Stored so a DAILY sweep does not send the same "your training is overdue"
     * every morning for three weeks. The sweep notifies only when the due state
     * has CHANGED since the last reminder - upcoming -> due_soon -> overdue is
     * three notifications over the life of an assignment, not thirty.
     *
     * Null means never reminded. It is deliberately NOT the same field as
     * `status`: the due state is computed, and this records what was
     * communicated rather than what is true.
     */
    lastReminderState: { type: String, default: null },
    lastReminderAt: { type: Date, default: null },

    lessons: { type: [lessonRecordSchema], default: [] },
    attempts: { type: [attemptSchema], default: [] },

    certificateId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: 'hrms_academy_assignments' },
);

/**
 * 🔴 ONE LIVE ASSIGNMENT PER EMPLOYEE PER PATH.
 *
 * Section 12 asks that duplicates be prevented; this is the guarantee, and the
 * service's pre-check exists only to produce a better message than a
 * duplicate-key error. `cancelled` is excluded so a path can legitimately be
 * re-assigned after being withdrawn - without that exclusion, cancelling would
 * permanently bar the employee from ever taking the path again.
 */
learningAssignmentSchema.index(
  { employeeId: 1, pathId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['assigned', 'in_progress', 'completed'] } },
  },
);

/** "My learning" - one person's assignments, newest first. */
learningAssignmentSchema.index({ employeeId: 1, status: 1, dueDate: 1 });
/** The admin queue, and the overdue filter, which sorts on the due date. */
learningAssignmentSchema.index({ status: 1, dueDate: 1 });
/** The reminder sweep: live, dated assignments, oldest deadline first. */
learningAssignmentSchema.index({ status: 1, dueDate: 1, lastReminderState: 1 });
learningAssignmentSchema.index({ pathId: 1, status: 1 });
learningAssignmentSchema.index({ departmentId: 1, status: 1 });

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------

/**
 * Issued by the server, on verified completion, and never by a request that
 * merely asks for one.
 *
 * `certificateNo` is a random 128-bit identifier rather than a sequence: a
 * sequence would let anyone holding one certificate work out how many had been
 * issued, and by subtraction how many people had not passed.
 */
const certificateSchema = new Schema(
  {
    // `unique` already builds the index; adding `index: true` beside it
    // declares the same one twice and Mongoose warns at boot.
    certificateNo: { type: String, required: true, unique: true },

    // Indexed by the unique compound declaration below, not here - same reason.
    assignmentId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true, index: true },
    employeeName: { type: String, required: true },
    employeeCode: { type: String, default: null },

    pathId: { type: Schema.Types.ObjectId, required: true, index: true },
    pathName: { type: String, required: true },

    issuedAt: { type: Date, required: true, default: Date.now },
    completionDate: { type: String, required: true },
    /** `YYYY-MM-DD`, or null when the path sets no validity window. */
    validUntil: isoDay,

    /** The rendered document, in storage. Read only through a presigned URL. */
    storageKey: { type: String, default: null },
    storageCategory: { type: String, default: null },

    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true, collection: 'hrms_academy_certificates' },
);

/** One certificate per assignment - re-issuing replaces rather than duplicates. */
certificateSchema.index({ assignmentId: 1 }, { unique: true });
certificateSchema.index({ employeeId: 1, issuedAt: -1 });

// ---------------------------------------------------------------------------
// AssignmentRule
// ---------------------------------------------------------------------------

/**
 * "IF department = X AND designation = Y THEN assign path Z."
 *
 * Criteria are stored as IDS and enum values chosen from the live catalogues,
 * so no department or designation name is ever compiled into code - section 11
 * asks for exactly that, and it is what makes the rule survive a department
 * being renamed.
 *
 * WITHIN a criterion the match is OR (any of these departments); ACROSS criteria
 * it is AND (this department AND this employment type). That is the shape the
 * section 11 example describes, and the only one that reads the way an
 * administrator says it out loud.
 */
const ruleCriteriaSchema = new Schema(
  {
    departmentIds: { type: [Schema.Types.ObjectId], default: [] },
    locationIds: { type: [Schema.Types.ObjectId], default: [] },
    designations: { type: [String], default: [] },
    employmentTypes: { type: [String], default: [], enum: EMPLOYMENT_TYPES },
  },
  { _id: false },
);

const assignmentRuleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: PATH_NAME_MAX },
    pathId: { type: Schema.Types.ObjectId, required: true, index: true },
    pathName: { type: String, default: '' },

    /**
     * Company-wide. Must be set deliberately - `createRuleSchema` refuses a rule
     * that is neither `matchAll` nor carries a criterion, so a rule cannot
     * become company-wide by an empty form.
     */
    matchAll: { type: Boolean, required: true, default: false },
    criteria: { type: ruleCriteriaSchema, default: () => ({}) },

    trigger: { type: String, required: true, enum: RULE_TRIGGERS, default: 'on_create' },
    active: { type: Boolean, required: true, default: true, index: true },
    priority: { type: Number, required: true, default: 100, min: 0, max: 999 },

    /** Observability: when it last ran and what it did. */
    lastRunAt: { type: Date, default: null },
    lastRunAssignedCount: { type: Number, default: 0, min: 0 },
    totalAssignedCount: { type: Number, default: 0, min: 0 },

    createdByUserId: { type: Schema.Types.ObjectId, default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: 'hrms_academy_rules' },
);

/** The hot path: every active on-create rule, in priority order. */
assignmentRuleSchema.index({ active: 1, trigger: 1, deletedAt: 1, priority: 1 });
assignmentRuleSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

// ---------------------------------------------------------------------------

export const AcademyContent =
  mongoose.models.AcademyContent || mongoose.model('AcademyContent', contentItemSchema);

export const LearningPath =
  mongoose.models.LearningPath || mongoose.model('LearningPath', learningPathSchema);

export const AcademyCourse =
  mongoose.models.AcademyCourse || mongoose.model('AcademyCourse', courseSchema);

export const Assessment =
  mongoose.models.Assessment || mongoose.model('Assessment', assessmentSchema);

export const LearningAssignment =
  mongoose.models.LearningAssignment ||
  mongoose.model('LearningAssignment', learningAssignmentSchema);

export const AcademyCertificate =
  mongoose.models.AcademyCertificate ||
  mongoose.model('AcademyCertificate', certificateSchema);

export const AssignmentRule =
  mongoose.models.AssignmentRule || mongoose.model('AssignmentRule', assignmentRuleSchema);

export default {
  AcademyContent,
  LearningPath,
  AcademyCourse,
  Assessment,
  LearningAssignment,
  AcademyCertificate,
  AssignmentRule,
};
