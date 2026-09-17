/**
 * SI Academy validation schemas (AD-6).
 *
 * Used by both the Express validator and the React forms, so a rule cannot
 * drift between them. Zod 4 - the version the frontend already depends on.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT accepted here
 * ---------------------------------------------------------------------------
 * There is no schema for "set my progress to 80%" and no schema for "my score
 * was 9 out of 10", because no such endpoint exists. A learner may report where
 * the playhead reached and which options they ticked; every number that decides
 * whether they passed is computed on the server from those two facts. Section
 * 25 asks for exactly this, and the cheapest way to guarantee it is to give the
 * client no vocabulary in which to say otherwise.
 */

import { z } from 'zod';

import { objectId, isoDay, paginationQuery } from '../validation/common.js';
import { EMPLOYMENT_TYPES } from '../constants/hrms.js';
import {
  CONTENT_TYPES,
  LESSON_TYPES,
  QUESTION_TYPES,
  SCORE_POLICIES,
  DUE_DATE_MODES,
  RULE_TRIGGERS,
  ASSIGNMENT_STATUSES,
  DUE_DAYS_MIN,
  DUE_DAYS_MAX,
  PASSING_PERCENT_MIN,
  PASSING_PERCENT_MAX,
  DEFAULT_PASSING_PERCENT,
  MAX_ATTEMPTS_CEILING,
  QUESTIONS_MAX,
  OPTIONS_MIN,
  OPTIONS_MAX,
  LESSONS_MAX,
  MIN_VIDEO_COMPLETION_PERCENT,
  MAX_VIDEO_COMPLETION_PERCENT,
  DEFAULT_VIDEO_COMPLETION_PERCENT,
  MAX_VIDEO_DURATION_SECONDS,
  PATH_NAME_MAX,
  COURSE_NAME_MAX,
  LESSON_TITLE_MAX,
  DESCRIPTION_MAX,
  QUESTION_TEXT_MAX,
  OPTION_TEXT_MAX,
} from '../constants/academy.js';

/** Present-but-empty and absent both mean "not supplied". */
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .optional()
    .nullable();

const idList = (max = 50) => z.array(objectId).max(max).default([]);

// ---------------------------------------------------------------------------
// Content library
// ---------------------------------------------------------------------------

/**
 * The metadata half of an upload. The file itself arrives as multipart and is
 * sniffed; nothing the client declares about the bytes is trusted.
 *
 * `durationSeconds` is the exception worth naming: it is read by the browser
 * from the video element and sent here, because the server has no media parser.
 * It is therefore ADVISORY and bounded - and it is only ever used as the
 * denominator of a completion ratio whose numerator the server derives itself,
 * so overstating it makes a video HARDER to complete, not easier.
 */
export const uploadContentSchema = z
  .object({
    title: z.string().trim().min(1, 'A title is required.').max(LESSON_TITLE_MAX),
    description: optionalText(DESCRIPTION_MAX),
    type: z.enum(CONTENT_TYPES),
    durationSeconds: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_VIDEO_DURATION_SECONDS)
      .optional()
      .nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .strict()
  .refine((v) => v.type !== 'video' || v.durationSeconds != null, {
    path: ['durationSeconds'],
    message: 'A video needs its duration, or its completion can never be measured.',
  });

export const updateContentSchema = z
  .object({
    title: z.string().trim().min(1).max(LESSON_TITLE_MAX).optional(),
    description: optionalText(DESCRIPTION_MAX),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const contentListQuerySchema = paginationQuery.extend({
  type: z.enum(CONTENT_TYPES).optional(),
  search: z.string().trim().max(160).optional(),
  active: z.coerce.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Learning path
// ---------------------------------------------------------------------------

/**
 * Who a path is FOR.
 *
 * Stored on the path and genuinely read: it is what "Create assignment rule"
 * prefills, and what the admin list renders in its "Applies to" column. The
 * AUTHORITY on who actually gets assigned is `AssignmentRule` - this is the
 * description, the rule is the behaviour.
 *
 * Saying so matters, because the onboarding module beside this one carries an
 * `appliesToRoleKey` that is rendered in exactly such a column and read by
 * nothing at all, and its own model file has to warn you.
 */
export const audienceSchema = z
  .object({
    departmentIds: idList(),
    locationIds: idList(),
    designations: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length).default([]),
  })
  .strict();

const dueDateBase = {
  dueDateMode: z.enum(DUE_DATE_MODES).default('none'),
  dueDays: z.number().int().min(DUE_DAYS_MIN).max(DUE_DAYS_MAX).optional().nullable(),
  dueDate: isoDay.optional().nullable(),
};

/**
 * A due-date configuration has to be internally consistent.
 *
 * Checked here rather than in the service so the form refuses it too: choosing
 * "15 days after joining" and leaving the number blank is a mistake worth
 * catching under the field, not after a round trip.
 */
const dueDateRefinement = (v, ctx) => {
  const needsDays = v.dueDateMode === 'joining_plus_days' || v.dueDateMode === 'assigned_plus_days';
  if (needsDays && v.dueDays == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueDays'],
      message: 'Say how many days.',
    });
  }
  if (v.dueDateMode === 'fixed' && !v.dueDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueDate'],
      message: 'Pick the date this is due.',
    });
  }
};

export const createPathSchema = z
  .object({
    name: z.string().trim().min(1, 'A name is required.').max(PATH_NAME_MAX),
    description: optionalText(DESCRIPTION_MAX),
    audience: audienceSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    ...dueDateBase,
    mandatory: z.boolean().default(true),
    /** Courses must be taken in order, and a later one stays locked until then. */
    sequential: z.boolean().default(false),
    requiresCertificate: z.boolean().default(false),
    /** Months. Null means the certificate does not expire. */
    certificateValidityMonths: z.number().int().min(1).max(600).optional().nullable(),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine(dueDateRefinement);

export const updatePathSchema = z
  .object({
    name: z.string().trim().min(1).max(PATH_NAME_MAX).optional(),
    description: optionalText(DESCRIPTION_MAX),
    audience: audienceSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    ...dueDateBase,
    dueDateMode: z.enum(DUE_DATE_MODES).optional(),
    mandatory: z.boolean().optional(),
    sequential: z.boolean().optional(),
    requiresCertificate: z.boolean().optional(),
    certificateValidityMonths: z.number().int().min(1).max(600).optional().nullable(),
    active: z.boolean().optional(),
  })
  .strict();

export const pathListQuerySchema = paginationQuery.extend({
  search: z.string().trim().max(160).optional(),
  active: z.coerce.boolean().optional(),
  departmentId: objectId.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  /**
   * The catalogue's three states, as the screen presents them.
   *
   * `active` is the stored flag and stays accepted; `status` is the derived
   * view over it - see `derivePathStatus` in catalogue.service.js, which is the
   * single place that derivation lives.
   */
  status: z.enum(['active', 'draft', 'archived']).optional(),
  sort: z.enum(['updated', 'name', 'assigned', 'created']).default('updated'),
});

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

export const createCourseSchema = z
  .object({
    pathId: objectId,
    name: z.string().trim().min(1, 'A name is required.').max(COURSE_NAME_MAX),
    description: optionalText(DESCRIPTION_MAX),
    estimatedMinutes: z.number().int().min(1).max(10_000).optional().nullable(),
    mandatory: z.boolean().default(true),
    /**
     * An explicit prerequisite, independent of the path's sequential flag.
     * Validated against the same path in the service - a course cannot depend
     * on one in a different path, and cannot depend on itself.
     */
    prerequisiteCourseId: objectId.optional().nullable(),
    active: z.boolean().default(true),
  })
  .strict();

export const updateCourseSchema = z
  .object({
    name: z.string().trim().min(1).max(COURSE_NAME_MAX).optional(),
    description: optionalText(DESCRIPTION_MAX),
    estimatedMinutes: z.number().int().min(1).max(10_000).optional().nullable(),
    mandatory: z.boolean().optional(),
    prerequisiteCourseId: objectId.optional().nullable(),
    active: z.boolean().optional(),
  })
  .strict();

/** Reorder is one call carrying the whole new order, not N move-up requests. */
export const reorderCoursesSchema = z
  .object({
    courseIds: z.array(objectId).min(1).max(200),
  })
  .strict();

// ---------------------------------------------------------------------------
// Lesson
// ---------------------------------------------------------------------------

/**
 * A lesson points at exactly one thing.
 *
 * A quiz lesson carries `assessmentId`; every other type carries `contentId`.
 * The refinement below is what stops a lesson carrying both, which would make
 * "what does this lesson show" a question with two answers.
 */
export const createLessonSchema = z
  .object({
    title: z.string().trim().min(1, 'A title is required.').max(LESSON_TITLE_MAX),
    description: optionalText(DESCRIPTION_MAX),
    type: z.enum(LESSON_TYPES),
    contentId: objectId.optional().nullable(),
    assessmentId: objectId.optional().nullable(),
    mandatory: z.boolean().default(true),
    videoCompletionPercent: z
      .number()
      .int()
      .min(MIN_VIDEO_COMPLETION_PERCENT)
      .max(MAX_VIDEO_COMPLETION_PERCENT)
      .default(DEFAULT_VIDEO_COMPLETION_PERCENT),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'quiz') {
      if (!v.assessmentId) {
        ctx.addIssue({ code: 'custom', path: ['assessmentId'], message: 'Pick an assessment.' });
      }
      if (v.contentId) {
        ctx.addIssue({
          code: 'custom',
          path: ['contentId'],
          message: 'A quiz lesson takes an assessment, not a content item.',
        });
      }
      return;
    }
    if (!v.contentId) {
      ctx.addIssue({ code: 'custom', path: ['contentId'], message: 'Pick a content item.' });
    }
    if (v.assessmentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['assessmentId'],
        message: 'Only a quiz lesson takes an assessment.',
      });
    }
  });

export const updateLessonSchema = z
  .object({
    title: z.string().trim().min(1).max(LESSON_TITLE_MAX).optional(),
    description: optionalText(DESCRIPTION_MAX),
    mandatory: z.boolean().optional(),
    videoCompletionPercent: z
      .number()
      .int()
      .min(MIN_VIDEO_COMPLETION_PERCENT)
      .max(MAX_VIDEO_COMPLETION_PERCENT)
      .optional(),
  })
  .strict();

export const reorderLessonsSchema = z
  .object({
    lessonIds: z.array(objectId).min(1).max(LESSONS_MAX),
  })
  .strict();

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

const optionSchema = z
  .object({
    text: z.string().trim().min(1, 'An option needs text.').max(OPTION_TEXT_MAX),
    isCorrect: z.boolean().default(false),
  })
  .strict();

/**
 * A question with no correct answer is unanswerable; a `single` question with
 * two is unmarkable. Both are caught here rather than discovered by the first
 * learner to sit the assessment.
 */
export const questionSchema = z
  .object({
    text: z.string().trim().min(1, 'A question needs text.').max(QUESTION_TEXT_MAX),
    type: z.enum(QUESTION_TYPES).default('single'),
    options: z.array(optionSchema).min(OPTIONS_MIN).max(OPTIONS_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    const correct = v.options.filter((o) => o.isCorrect).length;
    if (correct === 0) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Mark the correct answer.' });
    }
    if (v.type === 'single' && correct > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'A single-answer question can only have one correct option.',
      });
    }
  });

export const createAssessmentSchema = z
  .object({
    title: z.string().trim().min(1, 'A title is required.').max(LESSON_TITLE_MAX),
    description: optionalText(DESCRIPTION_MAX),
    passingPercent: z
      .number()
      .int()
      .min(PASSING_PERCENT_MIN)
      .max(PASSING_PERCENT_MAX)
      .default(DEFAULT_PASSING_PERCENT),
    /** Null means unlimited retries. */
    maxAttempts: z.number().int().min(1).max(MAX_ATTEMPTS_CEILING).optional().nullable(),
    scorePolicy: z.enum(SCORE_POLICIES).default('highest'),
    shuffleQuestions: z.boolean().default(false),
    questions: z.array(questionSchema).min(1, 'An assessment needs at least one question.').max(QUESTIONS_MAX),
    active: z.boolean().default(true),
  })
  .strict();

export const updateAssessmentSchema = z
  .object({
    title: z.string().trim().min(1).max(LESSON_TITLE_MAX).optional(),
    description: optionalText(DESCRIPTION_MAX),
    passingPercent: z.number().int().min(PASSING_PERCENT_MIN).max(PASSING_PERCENT_MAX).optional(),
    maxAttempts: z.number().int().min(1).max(MAX_ATTEMPTS_CEILING).optional().nullable(),
    scorePolicy: z.enum(SCORE_POLICIES).optional(),
    shuffleQuestions: z.boolean().optional(),
    questions: z.array(questionSchema).min(1).max(QUESTIONS_MAX).optional(),
    active: z.boolean().optional(),
  })
  .strict();

/**
 * An attempt submission.
 *
 * Answers only - no score, no pass flag, no timing the client controls. The
 * server marks it. `selectedOptionIds` is an array even for a single-answer
 * question so one code path marks both.
 */
export const submitAttemptSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: objectId,
            selectedOptionIds: z.array(objectId).max(OPTIONS_MAX).default([]),
          })
          .strict(),
      )
      .max(QUESTIONS_MAX),
  })
  .strict();

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

/**
 * A video heartbeat.
 *
 * `positionSeconds` is where the playhead is; `watchedDeltaSeconds` is how much
 * genuinely new material was played since the last ping. The server is the one
 * that accumulates, clamps against wall-clock elapsed, and decides completion -
 * see `recordVideoProgress`. Sending a delta rather than a running total is
 * what makes that clamp possible at all.
 */
export const videoProgressSchema = z
  .object({
    positionSeconds: z.number().min(0).max(MAX_VIDEO_DURATION_SECONDS),
    watchedDeltaSeconds: z.number().min(0).max(3600),
  })
  .strict();

/**
 * Completing a document lesson.
 *
 * The acknowledgement is required and must be true, matching the documents
 * module's own policy-acknowledgement shape: "I have read and understood this"
 * is a statement someone makes, not a checkbox the client may omit.
 */
export const completeLessonSchema = z
  .object({
    acknowledged: z.literal(true, {
      message: 'Confirm you have read this before marking it complete.',
    }),
  })
  .strict();

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export const createAssignmentSchema = z
  .object({
    employeeIds: z.array(objectId).min(1, 'Pick at least one employee.').max(500),
    pathId: objectId,
    /** Overrides whatever the path's due-date configuration would have produced. */
    dueDate: isoDay.optional().nullable(),
  })
  .strict();

export const assignmentListQuerySchema = paginationQuery.extend({
  employeeId: objectId.optional(),
  pathId: objectId.optional(),
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  /** Computed, not stored - the service turns it into a date comparison. */
  overdue: z.coerce.boolean().optional(),
  departmentId: objectId.optional(),
  search: z.string().trim().max(160).optional(),
});

export const cancelAssignmentSchema = z
  .object({
    reason: optionalText(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Assignment rules
// ---------------------------------------------------------------------------

/**
 * A rule with no criteria at all matches EVERY new employee.
 *
 * That is the "All new employees -> Company Orientation" case from section 11,
 * and it is legitimate - but it is also what an accidentally-empty form
 * produces, so `matchAll` has to be ticked deliberately. A rule cannot become
 * company-wide by omission.
 */
export const createRuleSchema = z
  .object({
    name: z.string().trim().min(1, 'A name is required.').max(PATH_NAME_MAX),
    pathId: objectId,
    matchAll: z.boolean().default(false),
    criteria: z
      .object({
        departmentIds: idList(),
        locationIds: idList(),
        designations: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
        employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length).default([]),
      })
      .strict()
      .default({}),
    trigger: z.enum(RULE_TRIGGERS).default('on_create'),
    active: z.boolean().default(true),
    /**
     * Lower runs first. Only matters for reporting which rule assigned what -
     * every matching rule fires, because a person can legitimately owe both a
     * company orientation and a department induction.
     */
    priority: z.number().int().min(0).max(999).default(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    const anyCriteria = Object.values(v.criteria ?? {}).some((c) => (c?.length ?? 0) > 0);
    if (!v.matchAll && !anyCriteria) {
      ctx.addIssue({
        code: 'custom',
        path: ['criteria'],
        message:
          'Choose at least one criterion, or tick "every new employee" to make this company-wide.',
      });
    }
    if (v.matchAll && anyCriteria) {
      ctx.addIssue({
        code: 'custom',
        path: ['matchAll'],
        message: 'A company-wide rule cannot also filter on criteria.',
      });
    }
  });

export const updateRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(PATH_NAME_MAX).optional(),
    pathId: objectId.optional(),
    matchAll: z.boolean().optional(),
    criteria: z
      .object({
        departmentIds: idList(),
        locationIds: idList(),
        designations: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
        employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length).default([]),
      })
      .strict()
      .optional(),
    trigger: z.enum(RULE_TRIGGERS).optional(),
    active: z.boolean().optional(),
    priority: z.number().int().min(0).max(999).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const academyReportQuerySchema = z
  .object({
    pathId: objectId.optional(),
    departmentId: objectId.optional(),
    status: z.enum(ASSIGNMENT_STATUSES).optional(),
  })
  .strict();

export default {
  uploadContentSchema,
  updateContentSchema,
  contentListQuerySchema,
  audienceSchema,
  createPathSchema,
  updatePathSchema,
  pathListQuerySchema,
  createCourseSchema,
  updateCourseSchema,
  reorderCoursesSchema,
  createLessonSchema,
  updateLessonSchema,
  reorderLessonsSchema,
  questionSchema,
  createAssessmentSchema,
  updateAssessmentSchema,
  submitAttemptSchema,
  videoProgressSchema,
  completeLessonSchema,
  createAssignmentSchema,
  assignmentListQuerySchema,
  cancelAssignmentSchema,
  createRuleSchema,
  updateRuleSchema,
  academyReportQuerySchema,
};
