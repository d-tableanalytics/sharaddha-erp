/**
 * Assessments: the question bank, and the marking.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE ANSWER KEY NEVER REACHES A LEARNER
 * ---------------------------------------------------------------------------
 * This is the one rule the whole file is arranged around, because it is the
 * rule almost every quiz implementation breaks. The usual shape - ship the
 * questions with an `isCorrect` flag, mark them in the browser, POST the score -
 * fails three ways at once: the answers are readable in the network tab, the
 * score is whatever the client says, and a retry limit enforced in JavaScript
 * is enforced nowhere.
 *
 * So:
 *
 *   - `toLearnerDto` strips `isCorrect` from every option. There is no endpoint
 *     that returns a marked question to anyone without `academy:edit:org`.
 *   - `markAttempt` reads the stored document and computes the score. The
 *     submission schema has no field in which a client could state one.
 *   - the attempt count is read from the assignment, server-side, and the
 *     ceiling is enforced there.
 *
 * ---------------------------------------------------------------------------
 * Editing an assessment does not re-mark old attempts
 * ---------------------------------------------------------------------------
 * Each attempt stores the `passingPercent` that applied when it was sat.
 * Raising the bar later must not retroactively fail somebody who passed under
 * the old one - that is a statement about a person, and it was true when it was
 * made. The change is audited instead.
 */

import { Assessment, AcademyCourse } from '../../../models/hrms/AcademyModels.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS } from '../../../shared/constants/hrms.js';
import {
  createAssessmentSchema,
  updateAssessmentSchema,
} from '../../../shared/schemas/academy.js';
import { paginationQuery } from '../../../shared/validation/common.js';
import { HrmsNotFoundError, HrmsConflictError } from '../hrms.errors.js';
import {
  idStr,
  oid,
  iso,
  parse,
  escapeRegex,
  assertCanManage,
  page,
  skipOf,
} from './academy.shared.js';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * The ADMIN view: questions with their answers.
 *
 * Reachable only behind `academy:edit:org`. Every route that returns this is
 * gated; every route a learner can reach returns `toLearnerDto` instead.
 */
export function toAdminDto(row) {
  return {
    id: idStr(row._id),
    title: row.title,
    description: row.description ?? null,
    passingPercent: row.passingPercent,
    maxAttempts: row.maxAttempts ?? null,
    scorePolicy: row.scorePolicy,
    shuffleQuestions: row.shuffleQuestions === true,
    active: row.active !== false,
    questionCount: (row.questions ?? []).length,
    questions: [...(row.questions ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((q) => ({
        id: idStr(q._id),
        text: q.text,
        type: q.type,
        order: q.order,
        options: (q.options ?? []).map((o) => ({
          id: idStr(o._id),
          text: o.text,
          isCorrect: o.isCorrect === true,
        })),
      })),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * The LEARNER view: the same questions with the answers removed.
 *
 * `isCorrect` is not set to false here - the key is absent entirely. A `false`
 * on every option is still a shape that invites somebody to look for the one
 * that is `true`, and an absent field cannot be leaked by a later refactor that
 * forgets to overwrite it.
 */
export function toLearnerDto(row, { shuffleSeed = null } = {}) {
  let questions = [...(row.questions ?? [])].sort((a, b) => a.order - b.order);

  if (row.shuffleQuestions) questions = shuffle(questions, shuffleSeed);

  return {
    id: idStr(row._id),
    title: row.title,
    description: row.description ?? null,
    passingPercent: row.passingPercent,
    maxAttempts: row.maxAttempts ?? null,
    questionCount: questions.length,
    questions: questions.map((q) => ({
      id: idStr(q._id),
      text: q.text,
      type: q.type,
      options: (q.options ?? []).map((o) => ({ id: idStr(o._id), text: o.text })),
    })),
  };
}

/**
 * Deterministic shuffle.
 *
 * Seeded on the ATTEMPT rather than random per request, so refreshing the page
 * mid-assessment does not reshuffle the questions underneath someone who has
 * already answered half of them - which loses their place and, if the client
 * were tracking by index rather than by id, their answers.
 */
function shuffle(items, seed) {
  if (!seed) return items;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;

  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(1103515245, h) + 12345) & 0x7fffffff;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listAssessments(actor, query) {
  assertCanManage(actor, 'assessments');
  const q = parse(paginationQuery, query, 'assessment query');

  const filter = { deletedAt: null };
  if (q.search) filter.title = new RegExp(escapeRegex(q.search), 'i');

  const [rows, total] = await Promise.all([
    Assessment.find(filter)
      .sort({ active: -1, title: 1 })
      .skip(skipOf(q))
      .limit(q.pageSize)
      .lean(),
    Assessment.countDocuments(filter),
  ]);

  return page(rows.map(toAdminDto), total, q);
}

export async function getAssessment(id, actor) {
  assertCanManage(actor, 'assessments');
  const row = await Assessment.findOne({ _id: id, deletedAt: null }).lean();
  if (!row) throw new HrmsNotFoundError('Assessment');
  return toAdminDto(row);
}

/** Load one for marking or for presentation. Not exported to any route directly. */
export async function loadAssessment(id) {
  return Assessment.findOne({ _id: id, deletedAt: null }).lean().catch(() => null);
}

/**
 * Several, by id, for a screen that renders a whole path at once.
 *
 * One query rather than one per quiz lesson. Only the fields the ATTEMPT
 * summary needs — never `questions`, which carry the answer key and have no
 * business travelling to a screen that is not presenting the assessment.
 */
export async function assessmentsByIds(ids) {
  const unique = [...new Set(ids.map((id) => (id ? String(id) : null)).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await Assessment.find({ _id: { $in: unique.map(oid) } })
    /**
     * 🔴 `questions._id` AND NOTHING ELSE FROM `questions`.
     *
     * The learner-facing screens need to say how many questions an assessment
     * has before it is started. They must never see the questions themselves,
     * and above all not `options.isCorrect`.
     *
     * So the projection takes the ids only - enough to count, carrying no text
     * and no correctness - and the array is replaced by its length below, so
     * nothing downstream can accidentally forward it.
     */
    .select('title passingPercent maxAttempts scorePolicy active deletedAt questions._id')
    .lean()
    .catch(() => []);

  return new Map(
    rows.map((r) => {
      const { questions, ...rest } = r;
      return [idStr(r._id), { ...rest, questionCount: (questions ?? []).length }];
    }),
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const withOrder = (questions) => questions.map((q, index) => ({ ...q, order: index }));

export async function createAssessment(body, actor, context = {}) {
  assertCanManage(actor, 'assessments');
  const dto = parse(createAssessmentSchema, body, 'assessment');

  const row = await Assessment.create({
    ...dto,
    questions: withOrder(dto.questions),
    createdByUserId: actor.userId ?? null,
  });

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_ASSESSMENT_CREATED,
    `Created assessment "${dto.title}"`,
    context.req,
    {
      meta: {
        assessmentId: idStr(row._id),
        questions: dto.questions.length,
        passingPercent: dto.passingPercent,
      },
    },
  );

  return toAdminDto(row.toObject());
}

/**
 * Update an assessment.
 *
 * Replacing `questions` replaces the whole set, which is what the editor sends.
 * Question ids are therefore NEW - and that is why a stored attempt keeps its
 * own `questionCount` and `passingPercent` rather than recomputing from the
 * live document. An attempt is a record of a sitting, not a view over the
 * current questions.
 */
export async function updateAssessment(id, body, actor, context = {}) {
  assertCanManage(actor, 'assessments');
  const dto = parse(updateAssessmentSchema, body, 'assessment');

  const row = await Assessment.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Assessment');

  const before = {
    passingPercent: row.passingPercent,
    questionCount: (row.questions ?? []).length,
  };

  for (const key of [
    'title', 'description', 'passingPercent', 'maxAttempts',
    'scorePolicy', 'shuffleQuestions', 'active',
  ]) {
    if (dto[key] !== undefined) row[key] = dto[key];
  }
  if (dto.questions !== undefined) row.questions = withOrder(dto.questions);

  await row.save();

  /**
   * Audited with BEFORE and AFTER for the two fields that change what a score
   * means. An auditor asking "why did the pass rate drop in March" needs to be
   * able to see that the bar moved, and when.
   */
  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_ASSESSMENT_UPDATED,
    `Updated assessment "${row.title}"`,
    context.req,
    {
      meta: {
        assessmentId: idStr(row._id),
        fields: Object.keys(dto),
        passingPercent: { from: before.passingPercent, to: row.passingPercent },
        questionCount: { from: before.questionCount, to: (row.questions ?? []).length },
      },
    },
  );

  return toAdminDto(row.toObject());
}

export async function deleteAssessment(id, actor, context = {}) {
  assertCanManage(actor, 'assessments');

  const row = await Assessment.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Assessment');

  const inUse = await AcademyCourse.find({
    deletedAt: null,
    lessons: { $elemMatch: { assessmentId: row._id } },
  })
    .select('name')
    .limit(10)
    .lean();

  if (inUse.length > 0) {
    throw new HrmsConflictError(
      `"${row.title}" is used by ${inUse.length} course(s) and cannot be removed.`,
      {
        code: 'ASSESSMENT_IN_USE',
        details: { courses: inUse.map((c) => ({ id: idStr(c._id), name: c.name })) },
      },
    );
  }

  row.deletedAt = new Date();
  row.active = false;
  await row.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_ASSESSMENT_DELETED,
    `Deleted assessment "${row.title}"`,
    context.req,
    { meta: { assessmentId: idStr(row._id) } },
  );

  return { id: idStr(row._id), deleted: true };
}

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------

/**
 * Is one answer right?
 *
 * ALL-OR-NOTHING for a multiple-answer question: every correct option chosen
 * and no incorrect one. Partial credit sounds fairer and is not - it lets
 * somebody pass a four-option question by ticking all four, which is the
 * opposite of demonstrating they know the answer.
 */
export function answerIsCorrect(question, selectedOptionIds) {
  const selected = new Set((selectedOptionIds ?? []).map(idStr));
  const correct = new Set(
    (question.options ?? []).filter((o) => o.isCorrect).map((o) => idStr(o._id)),
  );

  // Nothing ticked is wrong, not vacuously right.
  if (selected.size === 0) return false;
  if (selected.size !== correct.size) return false;
  for (const id of selected) if (!correct.has(id)) return false;
  return true;
}

/**
 * Mark a submission against the STORED assessment.
 *
 * Every number in the result is computed here. The submission carries only
 * which options were ticked - `submitAttemptSchema` gives a client no
 * vocabulary for a score, a pass flag or a question count, which is the
 * cheapest way to guarantee section 25's "do not trust client-side progress".
 *
 * Unanswered questions are marked wrong rather than skipped. Skipping them
 * would shrink the denominator, so answering one question correctly and
 * ignoring nineteen would score 100%.
 */
export function markAttempt(assessment, answers) {
  const byId = new Map((assessment.questions ?? []).map((q) => [idStr(q._id), q]));
  const submitted = new Map(
    (answers ?? []).map((a) => [idStr(a.questionId), a.selectedOptionIds ?? []]),
  );

  const marked = [];
  let correctCount = 0;

  for (const question of assessment.questions ?? []) {
    const qid = idStr(question._id);
    const selected = submitted.get(qid) ?? [];

    // Options that do not belong to this question are discarded rather than
    // counted - a submission naming an option id from a different question
    // would otherwise change the size comparison in `answerIsCorrect`.
    const valid = selected.filter((oid_) =>
      (question.options ?? []).some((o) => idStr(o._id) === idStr(oid_)),
    );

    const correct = answerIsCorrect(question, valid);
    if (correct) correctCount += 1;

    marked.push({ questionId: question._id, selectedOptionIds: valid.map(oid), correct });
  }

  // An answer naming a question that is not in this assessment is ignored
  // entirely; it cannot add to the denominator or the numerator.
  for (const qid of submitted.keys()) {
    if (!byId.has(qid)) continue;
  }

  const questionCount = (assessment.questions ?? []).length;
  const score = questionCount === 0 ? 0 : Math.round((correctCount / questionCount) * 100);

  return {
    score,
    correctCount,
    questionCount,
    passed: score >= assessment.passingPercent,
    passingPercent: assessment.passingPercent,
    answers: marked,
  };
}

/**
 * Which attempt counts, under the assessment's policy.
 *
 * Exported because both the progress rollup and the admin report need the same
 * answer, and two implementations of "best attempt" is how a learner's course
 * page and HR's report end up disagreeing about whether they passed.
 */
export function effectiveAttempt(attempts, scorePolicy = 'highest') {
  if (!attempts?.length) return null;
  if (scorePolicy === 'latest') {
    return attempts.reduce((a, b) => (a.attemptNo >= b.attemptNo ? a : b));
  }
  return attempts.reduce((a, b) => (a.score >= b.score ? a : b));
}

/**
 * How many attempts remain, or null for unlimited.
 *
 * A PASSED assessment has none left - not because the ceiling was reached, but
 * because there is nothing to retry. Offering "retry" after a pass invites
 * somebody to lower their own recorded score under a `latest` policy.
 */
export function attemptsRemaining(assessment, attempts) {
  const used = attempts?.length ?? 0;
  if (attempts?.some((a) => a.passed)) return 0;
  if (assessment.maxAttempts == null) return null;
  return Math.max(0, assessment.maxAttempts - used);
}

export function assertAttemptAllowed(assessment, attempts) {
  if (attempts?.some((a) => a.passed)) {
    throw new HrmsConflictError('You have already passed this assessment.', {
      code: 'ASSESSMENT_ALREADY_PASSED',
    });
  }
  const remaining = attemptsRemaining(assessment, attempts);
  if (remaining === 0) {
    throw new HrmsConflictError(
      `You have used all ${assessment.maxAttempts} attempt(s) at this assessment.`,
      { code: 'ASSESSMENT_NO_ATTEMPTS_LEFT' },
    );
  }
}

export default {
  toAdminDto,
  toLearnerDto,
  listAssessments,
  getAssessment,
  loadAssessment,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  answerIsCorrect,
  markAttempt,
  effectiveAttempt,
  attemptsRemaining,
  assertAttemptAllowed,
};
