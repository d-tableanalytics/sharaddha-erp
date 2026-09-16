/**
 * Academy progress arithmetic.
 *
 * Pure functions over plain data - no Mongoose, no `process.env`, no imports
 * beyond the vocabulary. It lives in `shared/` for the same reason the payroll
 * engine and the leave date helpers do: the server computes progress when it
 * writes a DTO, the browser recomputes it when it renders a bar, and the two
 * must not be able to disagree about what 67% means.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 * Progress is DERIVED from lesson records. It is never a number a client sends,
 * and it is never a second stored copy that can drift from the records it
 * summarises. `LearningAssignment.lessons[]` is the only fact; a percentage is
 * a view of it.
 *
 * The one thing that IS stored is `status`, and it is RECOMPUTED on every write
 * rather than latched - the same decision `checklist.service.js#closeIfSettled`
 * records for onboarding, and for the same reason: a status written once is
 * wrong the moment the thing underneath it changes.
 *
 * `overdue` is deliberately not a stored status at all. It is a function of the
 * due date and the clock, so it is computed on read by `deriveDueState`.
 */

import {
  DUE_SOON_DAYS,
  DEFAULT_VIDEO_COMPLETION_PERCENT,
} from '../constants/academy.js';

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` for an instant, in UTC. The wire format for every Academy date. */
export function toDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` + n days, staying on calendar days rather than adding 86400s. */
export function addDays(day, n) {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative means `to` is past.
 *
 * Computed on UTC midnights rather than on `Date.now()` deltas, so "due
 * tomorrow" does not become "due today" because it is 23:30 in one timezone.
 */
export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

/**
 * Has this video been watched enough to count?
 *
 * Measured on UNIQUE seconds watched against the clip's real duration, not on
 * the playhead position - the difference is the whole point. A learner who
 * drags the scrubber to the end has a position of 100% and a watched total of
 * about zero, and only the second number is evidence of anything.
 *
 * A duration of zero or null means the library never recorded one, in which
 * case there is nothing to measure against and the lesson falls back to an
 * explicit "mark complete" - failing toward asking the learner rather than
 * toward silently crediting them.
 */
export function videoIsComplete(lesson, record) {
  const duration = Number(record?.videoDurationSeconds ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) return false;

  const threshold = Number(lesson?.videoCompletionPercent ?? DEFAULT_VIDEO_COMPLETION_PERCENT);
  const watched = Number(record?.watchedSeconds ?? 0);
  if (!Number.isFinite(watched) || watched <= 0) return false;

  return (watched / duration) * 100 >= threshold;
}

/** How far through a video the learner is, capped at 100. */
export function videoPercent(record) {
  const duration = Number(record?.videoDurationSeconds ?? 0);
  const watched = Number(record?.watchedSeconds ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(watched) || watched <= 0) return 0;
  return Math.min(100, Math.round((watched / duration) * 100));
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

/**
 * Percent complete over a set of lesson records.
 *
 * MANDATORY LESSONS ONLY. Optional content is genuinely optional: it appears in
 * the course, it can be completed, and it never holds a learning path open.
 * That is the section 8 requirement, and making it the denominator here is what
 * makes it true everywhere rather than in each screen that remembers.
 *
 * A course with no mandatory lessons at all is 100% - vacuously complete rather
 * than eternally 0/0. The alternative divides by zero and renders NaN.
 */
export function percentOf(records) {
  const mandatory = records.filter((r) => r.mandatory);
  if (mandatory.length === 0) return 100;
  const done = mandatory.filter((r) => r.status === 'completed').length;
  return Math.round((done / mandatory.length) * 100);
}

/** `{ completed, total }` over mandatory lessons, for "3 of 5" captions. */
export function countsOf(records) {
  const mandatory = records.filter((r) => r.mandatory);
  return {
    completed: mandatory.filter((r) => r.status === 'completed').length,
    total: mandatory.length,
  };
}

/** Lesson records belonging to one course. */
export const lessonsOfCourse = (records, courseId) =>
  records.filter((r) => String(r.courseId) === String(courseId));

/** A course is complete when every mandatory lesson in it is. */
export const courseIsComplete = (records, courseId) =>
  percentOf(lessonsOfCourse(records, courseId)) === 100;

/**
 * Per-course rollup, in the order the courses are sequenced.
 *
 * `locked` is resolved here rather than per screen so the employee view, the
 * admin progress view and the server's own completion guard all answer it the
 * same way. See `courseIsLocked` for the rule.
 */
export function courseProgress(courses, records, { sequential = false } = {}) {
  const ordered = [...courses].sort((a, b) => a.order - b.order);

  return ordered.map((course, index) => {
    const own = lessonsOfCourse(records, course.id ?? course._id);
    const percent = percentOf(own);
    const counts = countsOf(own);
    const complete = percent === 100 && own.length > 0;

    return {
      courseId: String(course.id ?? course._id),
      name: course.name,
      order: course.order,
      mandatory: course.mandatory !== false,
      percent,
      completedLessons: counts.completed,
      totalLessons: counts.total,
      status: complete ? 'completed' : percent > 0 ? 'in_progress' : 'not_started',
      locked: courseIsLocked(ordered, records, index, { sequential }),
      lockedBy: lockedByName(ordered, records, index, { sequential }),
    };
  });
}

/**
 * Is this course locked?
 *
 * Two independent gates, and a course is locked if either applies:
 *
 *   1. SEQUENTIAL. The path requires courses in order, so everything before
 *      this one must be complete. Only MANDATORY predecessors count - an
 *      optional course that nobody took must not wall off the rest of the path,
 *      which is the bug you get by checking "all previous" without asking
 *      whether they were required.
 *
 *   2. EXPLICIT PREREQUISITE. The course names one, and it is not complete.
 *      This works whether or not the path is sequential.
 *
 * A course that is already complete is never locked. Re-reading finished
 * material is always allowed; section 9 asks for exactly that.
 */
export function courseIsLocked(orderedCourses, records, index, { sequential = false } = {}) {
  const course = orderedCourses[index];
  if (!course) return false;

  if (courseIsComplete(records, course.id ?? course._id)) return false;

  if (course.prerequisiteCourseId) {
    const prereq = orderedCourses.find(
      (c) => String(c.id ?? c._id) === String(course.prerequisiteCourseId),
    );
    // A prerequisite pointing at a course that is no longer in the path is not
    // a lock. Section 24: deleted content must not break the course - and an
    // unsatisfiable prerequisite would make the rest of the path unreachable
    // forever, with no screen able to explain why.
    if (prereq && !courseIsComplete(records, prereq.id ?? prereq._id)) return true;
  }

  if (!sequential) return false;

  return orderedCourses
    .slice(0, index)
    .filter((c) => c.mandatory !== false)
    .some((c) => !courseIsComplete(records, c.id ?? c._id));
}

/** The course a learner has to finish first, so the UI can name it. */
export function lockedByName(orderedCourses, records, index, { sequential = false } = {}) {
  const course = orderedCourses[index];
  if (!course || !courseIsLocked(orderedCourses, records, index, { sequential })) return null;

  if (course.prerequisiteCourseId) {
    const prereq = orderedCourses.find(
      (c) => String(c.id ?? c._id) === String(course.prerequisiteCourseId),
    );
    if (prereq && !courseIsComplete(records, prereq.id ?? prereq._id)) return prereq.name;
  }

  const blocking = orderedCourses
    .slice(0, index)
    .filter((c) => c.mandatory !== false)
    .find((c) => !courseIsComplete(records, c.id ?? c._id));

  return blocking?.name ?? null;
}

// ---------------------------------------------------------------------------
// Assignment status
// ---------------------------------------------------------------------------

/**
 * The status an assignment SHOULD have, given its lesson records.
 *
 * Recomputed on every write. `cancelled` is preserved untouched - it is the one
 * terminal state, set by a person, and no amount of lesson activity should move
 * a cancelled assignment back to life.
 */
export function deriveStatus(records, currentStatus) {
  if (currentStatus === 'cancelled') return 'cancelled';

  const mandatory = records.filter((r) => r.mandatory);
  const anyTouched = records.some((r) => r.status !== 'not_started');

  if (mandatory.length > 0 && mandatory.every((r) => r.status === 'completed')) {
    return 'completed';
  }
  return anyTouched ? 'in_progress' : 'assigned';
}

/**
 * What the due date says today.
 *
 * Returns the state, the day count and a phrase, because every caller wants all
 * three and formatting a date difference three different ways is how "Due in 1
 * days" ships.
 */
export function deriveDueState(dueDate, status, today = toDay(new Date())) {
  if (status === 'completed') {
    return { state: 'completed', days: null, label: 'Completed' };
  }
  if (status === 'cancelled') {
    return { state: 'none', days: null, label: 'Cancelled' };
  }
  if (!dueDate) {
    return { state: 'none', days: null, label: 'No due date' };
  }

  const days = daysBetween(today, dueDate);
  if (days === null) return { state: 'none', days: null, label: 'No due date' };

  if (days < 0) {
    const n = Math.abs(days);
    return {
      state: 'overdue',
      days,
      label: n === 1 ? 'Overdue by 1 day' : `Overdue by ${n} days`,
    };
  }
  if (days === 0) return { state: 'due_soon', days, label: 'Due today' };
  if (days === 1) return { state: 'due_soon', days, label: 'Due tomorrow' };
  if (days <= DUE_SOON_DAYS) return { state: 'due_soon', days, label: `Due in ${days} days` };
  return { state: 'upcoming', days, label: `Due in ${days} days` };
}

/** Overdue, for filters and dashboard counters. Never a stored field. */
export const isOverdue = (dueDate, status, today) =>
  deriveDueState(dueDate, status, today).state === 'overdue';

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/**
 * Where "Continue learning" should send somebody.
 *
 * The first incomplete mandatory lesson in the first unlocked, incomplete
 * course - which is the lesson they would reach by clicking through, without
 * making them click through. Returns null once there is nothing left, and the
 * caller shows the completion state instead.
 */
export function nextLesson(courses, records, { sequential = false } = {}) {
  const rollup = courseProgress(courses, records, { sequential });

  for (const course of rollup) {
    if (course.locked || course.status === 'completed') continue;

    const own = lessonsOfCourse(records, course.courseId);
    const next =
      own.find((r) => r.mandatory && r.status === 'in_progress') ??
      own.find((r) => r.mandatory && r.status === 'not_started');

    if (next) {
      return {
        courseId: course.courseId,
        courseName: course.name,
        lessonId: String(next.lessonId),
        lessonTitle: next.title ?? null,
        type: next.type,
      };
    }
  }
  return null;
}

export default {
  toDay,
  addDays,
  daysBetween,
  videoIsComplete,
  videoPercent,
  percentOf,
  countsOf,
  lessonsOfCourse,
  courseIsComplete,
  courseProgress,
  courseIsLocked,
  lockedByName,
  deriveStatus,
  deriveDueState,
  isOverdue,
  nextLesson,
};
