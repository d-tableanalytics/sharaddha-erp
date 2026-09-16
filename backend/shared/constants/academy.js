/**
 * SI Academy vocabulary.
 *
 * A file of its own, as Attendance, Leave, Payroll, Hiring and Onboarding each
 * have - `constants/hrms.js` carries the foundation values and says so; module
 * enums arrive with their module.
 *
 * Dependency-free and environment-free: this is bundled into the browser as
 * well as run in Node, so a `process.env` here would be a runtime crash in the
 * SPA (`shared/README.md` rule 1, enforced by the guard in shared-foundation).
 */

// ---------------------------------------------------------------------------
// Content library
// ---------------------------------------------------------------------------

/**
 * What a piece of learning material IS.
 *
 * `document` is the catch-all for the Office formats the storage sniffer
 * already admits; `pdf` is separated from it because the two are consumed
 * differently - a PDF is read inline in the browser, a .docx is downloaded.
 */
export const CONTENT_TYPES = Object.freeze(['video', 'pdf', 'document']);

export const CONTENT_TYPE_LABELS = Object.freeze({
  video: 'Video',
  pdf: 'PDF',
  document: 'Document',
});

/**
 * Upload ceilings, in bytes, per content type.
 *
 * A training video is the largest thing this system accepts, and 100 MB is a
 * deliberate ceiling rather than a generous one: the upload passes through the
 * API process in memory (multer's memory storage, as every other HRMS upload
 * does), so this number bounds that process's working set, not just what a
 * bucket will hold.
 *
 * The scalable shape is a presigned PUT straight from the browser to S3, which
 * the storage layer is already built for - `putObject` would become
 * `createUploadUrl` and the bytes would stop touching this process at all. That
 * is a change to two functions, and it is the right next step if the library
 * ever needs full-length recordings. It is not needed for the 5-15 minute
 * modules this module is for.
 */
export const MAX_CONTENT_BYTES = Object.freeze({
  video: 100 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  document: 20 * 1024 * 1024,
});

/** Longest video the library will record a duration for: eight hours. */
export const MAX_VIDEO_DURATION_SECONDS = 8 * 60 * 60;

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

/**
 * A lesson is one of four things.
 *
 * `video`, `pdf` and `document` each point at a ContentItem; `quiz` points at
 * an Assessment. The type is STORED on the lesson rather than inferred from
 * which id happens to be set - the same correction `DocumentModels.js` makes
 * about inferring scope from nullable ids, and for the same reason: an
 * inference silently changes meaning when a referenced row disappears.
 */
export const LESSON_TYPES = Object.freeze(['video', 'pdf', 'document', 'quiz']);

export const LESSON_TYPE_LABELS = Object.freeze({
  video: 'Video',
  pdf: 'PDF',
  document: 'Document',
  quiz: 'Quiz',
});

/** Lesson types backed by the content library. */
export const CONTENT_LESSON_TYPES = Object.freeze(['video', 'pdf', 'document']);

/**
 * How much of a video counts as having watched it.
 *
 * A default, not a constant business rule: each video lesson carries its own
 * threshold so a two-minute policy clip and a forty-minute induction can
 * differ. Nothing branches on the number below.
 */
export const DEFAULT_VIDEO_COMPLETION_PERCENT = 90;
export const MIN_VIDEO_COMPLETION_PERCENT = 50;
export const MAX_VIDEO_COMPLETION_PERCENT = 100;

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * The three states a lesson can be in.
 *
 * DERIVED for a video (watched seconds against the threshold) and EXPLICIT for
 * a document (the learner confirms they have read it). Both are written only by
 * the server - see `progress.js`, the single place a lesson state is computed.
 */
export const LESSON_STATUSES = Object.freeze(['not_started', 'in_progress', 'completed']);

/**
 * An assignment's status.
 *
 * `overdue` is NOT in this list, and that is the important decision here.
 * Overdue is a function of the due date and the clock, so storing it would mean
 * a row that is wrong until something happens to touch it - the classic
 * "status latched at write time" bug. It is computed on read by
 * `deriveDueState`, and the UI presents it as a status because to a user it is
 * one.
 */
export const ASSIGNMENT_STATUSES = Object.freeze([
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
]);

export const ASSIGNMENT_STATUS_LABELS = Object.freeze({
  assigned: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
});

/** Statuses that still count as live work. A cancelled assignment does not. */
export const ACTIVE_ASSIGNMENT_STATUSES = Object.freeze([
  'assigned',
  'in_progress',
  'completed',
]);

/** What the due date says, computed rather than stored. */
export const DUE_STATES = Object.freeze([
  'none',
  'upcoming',
  'due_soon',
  'overdue',
  'completed',
]);

/** "Due soon" starts three days out - the window a reminder is worth sending in. */
export const DUE_SOON_DAYS = 3;

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

/**
 * How a learning path decides when its work is due.
 *
 *   joining_plus_days   joining date + N. The onboarding case: "15 days from
 *                       the day they start", which is a different date per
 *                       employee and cannot be a fixed one.
 *   assigned_plus_days  assignment date + N. The refresher case: a compliance
 *                       module reassigned to existing staff, where the joining
 *                       date is years ago and would produce an assignment that
 *                       is overdue the moment it is created.
 *   fixed               one calendar date for everybody.
 *   none                no deadline.
 */
export const DUE_DATE_MODES = Object.freeze([
  'joining_plus_days',
  'assigned_plus_days',
  'fixed',
  'none',
]);

export const DUE_DATE_MODE_LABELS = Object.freeze({
  joining_plus_days: 'Days after joining',
  assigned_plus_days: 'Days after assignment',
  fixed: 'Fixed date',
  none: 'No due date',
});

export const DUE_DAYS_MIN = 1;
export const DUE_DAYS_MAX = 730;

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

/**
 * `single` renders radio buttons, `multiple` checkboxes.
 *
 * A `multiple` question is marked all-or-nothing: every correct option chosen
 * and no incorrect one. Partial credit sounds fairer and is not - it lets
 * someone pass a four-option question by ticking all four.
 */
export const QUESTION_TYPES = Object.freeze(['single', 'multiple']);

/**
 * Which attempt counts once several exist.
 *
 * `highest` is the default because the point of allowing a retry is to let
 * someone demonstrate they have learned the material. `latest` exists for
 * assessments where the most recent answer is the one that matters.
 */
export const SCORE_POLICIES = Object.freeze(['highest', 'latest']);

export const SCORE_POLICY_LABELS = Object.freeze({
  highest: 'Best attempt counts',
  latest: 'Most recent attempt counts',
});

export const PASSING_PERCENT_MIN = 1;
export const PASSING_PERCENT_MAX = 100;
export const DEFAULT_PASSING_PERCENT = 70;

/** Null means unlimited retries. */
export const MAX_ATTEMPTS_CEILING = 20;

export const QUESTIONS_MAX = 200;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 8;

// ---------------------------------------------------------------------------
// Assignment rules
// ---------------------------------------------------------------------------

/**
 * The employee attributes a rule may match on.
 *
 * Deliberately a CLOSED list of attributes that already exist on the Employee
 * record, and deliberately NOT a list of values: a rule stores department ids
 * and designation strings chosen from the live catalogues, so nothing here
 * hardcodes "IT" or "Software Developer". Adding a matchable attribute is a
 * change to this list, the rule schema and `employeeMatchesRule` together.
 */
export const RULE_CRITERIA = Object.freeze([
  'departmentIds',
  'locationIds',
  'designations',
  'employmentTypes',
]);

export const RULE_CRITERIA_LABELS = Object.freeze({
  departmentIds: 'Department',
  locationIds: 'Location',
  designations: 'Designation',
  employmentTypes: 'Employment type',
});

/**
 * When a rule fires.
 *
 *   on_create   a new employee record is created. The section 2 flow.
 *   manual      the rule exists but runs only when somebody presses "Run now",
 *               which is how an existing workforce is backfilled onto a new
 *               compliance path without it also firing on every future hire.
 */
export const RULE_TRIGGERS = Object.freeze(['on_create', 'manual']);

export const RULE_TRIGGER_LABELS = Object.freeze({
  on_create: 'When an employee is created',
  manual: 'Only when run manually',
});

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

/**
 * Length of the public certificate identifier, in bytes before encoding.
 *
 * 16 bytes / 128 bits. It is an IDENTIFIER, not a capability: reading a
 * certificate is authorised by the same academy grants as everything else, so
 * this does not need to resist an offline attack. It needs to be unguessable
 * enough that certificate numbers cannot be enumerated - a sequence would let
 * anyone holding one work out how many were issued, and by subtraction how many
 * people did not pass.
 */
export const CERTIFICATE_ID_BYTES = 16;

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const PATH_NAME_MAX = 160;
export const COURSE_NAME_MAX = 160;
export const LESSON_TITLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const QUESTION_TEXT_MAX = 1000;
export const OPTION_TEXT_MAX = 500;

/** A course may hold this many lessons. Embedded, so the count is bounded. */
export const LESSONS_MAX = 100;

/**
 * The most assignments one rule run will create in a single call.
 *
 * A backfill across a whole company is a real operation and a runaway write is
 * a real risk; this bounds one invocation, and the caller pages.
 */
export const RULE_RUN_CHUNK = 500;

export default {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  MAX_CONTENT_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  LESSON_TYPES,
  LESSON_TYPE_LABELS,
  CONTENT_LESSON_TYPES,
  DEFAULT_VIDEO_COMPLETION_PERCENT,
  MIN_VIDEO_COMPLETION_PERCENT,
  MAX_VIDEO_COMPLETION_PERCENT,
  LESSON_STATUSES,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABELS,
  ACTIVE_ASSIGNMENT_STATUSES,
  DUE_STATES,
  DUE_SOON_DAYS,
  DUE_DATE_MODES,
  DUE_DATE_MODE_LABELS,
  DUE_DAYS_MIN,
  DUE_DAYS_MAX,
  QUESTION_TYPES,
  SCORE_POLICIES,
  SCORE_POLICY_LABELS,
  PASSING_PERCENT_MIN,
  PASSING_PERCENT_MAX,
  DEFAULT_PASSING_PERCENT,
  MAX_ATTEMPTS_CEILING,
  QUESTIONS_MAX,
  OPTIONS_MIN,
  OPTIONS_MAX,
  RULE_CRITERIA,
  RULE_CRITERIA_LABELS,
  RULE_TRIGGERS,
  RULE_TRIGGER_LABELS,
  CERTIFICATE_ID_BYTES,
  PATH_NAME_MAX,
  COURSE_NAME_MAX,
  LESSON_TITLE_MAX,
  DESCRIPTION_MAX,
  QUESTION_TEXT_MAX,
  OPTION_TEXT_MAX,
  LESSONS_MAX,
  RULE_RUN_CHUNK,
};
