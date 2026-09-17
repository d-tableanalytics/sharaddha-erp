/**
 * SI Academy — the HTTP layer, the progress engine, and the rule engine.
 *
 * A real Express app over a real MongoDB, following the pattern Employee
 * Master, Onboarding, Payroll and Hiring established. Only `protect` is
 * stubbed; the permission chain, the validator, the services and the error
 * handler are the genuine article.
 *
 * The assertions that carry the most weight are the ones about things a learner
 * must NOT be able to do: report more watch time than has elapsed, read the
 * answer key out of a quiz, complete a locked lesson, complete somebody else's
 * lesson, or obtain a certificate for an unfinished path. Those are the claims
 * sections 25 and 26 make, and a comment asserting them is not a test.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';

import Employee from '../models/hrms/Employee.js';
import User from '../models/User.js';
import Department from '../models/hrms/Department.js';
import AuditLog from '../models/AuditLog.js';
import { InboxItem } from '../models/hrms/InboxItem.js';
import {
  AcademyContent,
  LearningPath,
  AcademyCourse,
  Assessment,
  LearningAssignment,
  AcademyCertificate,
  AssignmentRule,
} from '../models/hrms/AcademyModels.js';

import academyRoutes from '../modules/hrms/academy/academy.routes.js';
import { derivePathStatus } from '../modules/hrms/academy/catalogue.service.js';
import employeeRoutes from '../modules/hrms/employees/employee.routes.js';
import { hrmsAuthorizationChain, setEmployeeResolver } from '../middlewares/hrmsAuth.js';
import { hrmsErrorHandler } from '../modules/hrms/hrms.errors.js';
import {
  registerReferenceProvider,
  __resetReferenceProviders,
} from '../modules/hrms/references/reference.service.js';
import { employeeReferenceProvider } from '../modules/hrms/employees/employee.provider.js';
import {
  departmentReferenceProvider,
  locationReferenceProvider,
} from '../modules/hrms/org/org.provider.js';
import {
  registerFileAccessRule,
  __resetFileAccessRules,
} from '../modules/hrms/storage/storage.service.js';
import { resolveContentAccess } from '../modules/hrms/academy/content.service.js';
import { resolveCertificateAccess } from '../modules/hrms/academy/certificate.service.js';
import { runRulesForEmployee, employeeMatchesRule } from '../modules/hrms/academy/rule.service.js';
import { runAcademyReminderSweep } from '../modules/hrms/academy/reminder.service.js';
import { HRMS_ROLES as R } from '../shared/permissions/constants.js';
import { AUDIT_ACTIONS, STORAGE_CATEGORIES } from '../shared/constants/hrms.js';
import { INBOX_TYPES } from '../shared/constants/inbox.js';
import {
  deriveDueState,
  deriveStatus,
  percentOf,
  courseProgress,
  videoIsComplete,
  addDays,
  toDay,
} from '../shared/academy/progress.js';
import { buildTestApp, stubProtect, withServer, get, post, patch, del } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const P = '/api/v1/hrms/academy';

const dayIn = (n) => addDays(toDay(new Date()), n);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

before(async () => {
  await startTestMongo();
  await syncIndexes(
    Employee,
    User,
    Department,
    AcademyContent,
    LearningPath,
    AcademyCourse,
    Assessment,
    LearningAssignment,
    AcademyCertificate,
    AssignmentRule,
  );
});

after(async () => {
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections();
  __resetReferenceProviders();
  registerReferenceProvider('employee', employeeReferenceProvider);
  registerReferenceProvider('department', departmentReferenceProvider);
  registerReferenceProvider('location', locationReferenceProvider);
  setEmployeeResolver((userId) => employeeReferenceProvider.byUserId(userId));

  __resetFileAccessRules();
  registerFileAccessRule(STORAGE_CATEGORIES.ACADEMY_CONTENT, {
    resolve: resolveContentAccess,
    auditAction: AUDIT_ACTIONS.ACADEMY_CONTENT_VIEWED,
  });
  registerFileAccessRule(STORAGE_CATEGORIES.ACADEMY_CERTIFICATE, {
    resolve: resolveCertificateAccess,
    auditAction: AUDIT_ACTIONS.ACADEMY_CERTIFICATE_VIEWED,
  });
});

function appFor(user) {
  return buildTestApp({
    mount: (app) => {
      const router = express.Router();
      router.use(stubProtect(user));
      router.use(hrmsAuthorizationChain);
      router.use('/academy', academyRoutes);
      // Mounted so the section 2 integration can be exercised through the REAL
      // employee endpoint rather than by calling the rule engine directly.
      router.use('/employees', employeeRoutes);
      router.use(hrmsErrorHandler);
      app.use('/api/v1/hrms', router);
    },
  });
}

let seq = 0;

async function makeEmployee({
  roles = [R.EMPLOYEE],
  departmentId = null,
  designation = null,
  employmentType = 'full_time',
  reportingManagerId = null,
  managerChain = [],
  dateOfJoining = new Date('2026-09-16T00:00:00Z'),
  status = 'active',
} = {}) {
  seq += 1;
  const user = await User.create({
    email: `academy${seq}@example.com`,
    password: 'x'.repeat(60),
    user: `Academy Tester ${seq}`,
    role: 'Management',
    roles,
    status: 'Active',
  });

  const employee = await Employee.create({
    userId: user._id,
    employeeCode: `ACA${String(seq).padStart(4, '0')}`,
    firstName: 'Test',
    lastName: `Learner${seq}`,
    dateOfJoining,
    employmentType,
    designation,
    departmentId,
    reportingManagerId,
    managerChain,
    status,
    probationMonths: 3,
    probationStartDate: dateOfJoining,
    probationEndDate: dateOfJoining,
  });

  return { user: { ...user.toObject(), _id: user._id }, employee };
}

/** A content item, written straight to the collection — uploads are tested apart. */
async function makeContent({ type = 'video', durationSeconds = 600, title = 'Clip' } = {}) {
  return AcademyContent.create({
    title,
    type,
    storageKey: `hrms/academy/content/${type}/${new mongoose.Types.ObjectId()}.bin`,
    storageCategory: STORAGE_CATEGORIES.ACADEMY_CONTENT,
    mimeType: type === 'video' ? 'video/mp4' : 'application/pdf',
    fileSize: 1024,
    durationSeconds: type === 'video' ? durationSeconds : null,
  });
}

async function makeAssessment({ passingPercent = 70, maxAttempts = null } = {}) {
  return Assessment.create({
    title: 'Security Assessment',
    passingPercent,
    maxAttempts,
    scorePolicy: 'highest',
    questions: [
      {
        text: 'What should you do with a suspicious email?',
        type: 'single',
        order: 0,
        options: [
          { text: 'Report it', isCorrect: true },
          { text: 'Click every link', isCorrect: false },
          { text: 'Forward it to everyone', isCorrect: false },
        ],
      },
      {
        text: 'Which are good password habits?',
        type: 'multiple',
        order: 1,
        options: [
          { text: 'Use a manager', isCorrect: true },
          { text: 'Make them long', isCorrect: true },
          { text: 'Reuse one everywhere', isCorrect: false },
        ],
      },
    ],
  });
}

/**
 * The section 28 fixture: a two-course path with a video, a PDF and a quiz.
 */
async function makePath({
  sequential = true,
  requiresCertificate = true,
  dueDateMode = 'joining_plus_days',
  dueDays = 15,
} = {}) {
  const path = await LearningPath.create({
    name: 'IT — New Employee Onboarding',
    description: 'Everything a new IT hire needs in their first fortnight.',
    dueDateMode,
    dueDays,
    dueDate: null,
    mandatory: true,
    sequential,
    requiresCertificate,
    active: true,
  });

  const video = await makeContent({ type: 'video', durationSeconds: 600, title: 'Password Security' });
  const pdf = await makeContent({ type: 'pdf', title: 'Data Protection Policy' });
  const assessment = await makeAssessment();

  const courseOne = await AcademyCourse.create({
    pathId: path._id,
    name: 'IT Security Awareness',
    order: 0,
    mandatory: true,
    active: true,
    lessons: [
      {
        title: 'Password Security',
        type: 'video',
        contentId: video._id,
        mandatory: true,
        videoCompletionPercent: 90,
        order: 0,
      },
      {
        title: 'Data Protection',
        type: 'pdf',
        contentId: pdf._id,
        mandatory: true,
        order: 1,
      },
    ],
  });

  const courseTwo = await AcademyCourse.create({
    pathId: path._id,
    name: 'Final Assessment',
    order: 1,
    mandatory: true,
    active: true,
    lessons: [
      {
        title: 'Security Assessment',
        type: 'quiz',
        assessmentId: assessment._id,
        mandatory: true,
        order: 0,
      },
    ],
  });

  return { path, courseOne, courseTwo, video, pdf, assessment };
}

// ===========================================================================
// The progress engine — pure, so it is tested without a server
// ===========================================================================

describe('progress arithmetic', () => {
  test('percent counts MANDATORY lessons only', () => {
    const records = [
      { mandatory: true, status: 'completed' },
      { mandatory: true, status: 'not_started' },
      { mandatory: false, status: 'not_started' },
    ];
    // 1 of 2 mandatory — the optional one is neither numerator nor denominator.
    assert.equal(percentOf(records), 50);
  });

  test('a set with no mandatory lessons is 100, not NaN', () => {
    assert.equal(percentOf([{ mandatory: false, status: 'not_started' }]), 100);
    assert.equal(percentOf([]), 100);
  });

  test('optional content never holds a path open', () => {
    const records = [
      { mandatory: true, status: 'completed' },
      { mandatory: false, status: 'not_started' },
    ];
    assert.equal(deriveStatus(records, 'in_progress'), 'completed');
  });

  test('a cancelled assignment is never revived by lesson activity', () => {
    const records = [{ mandatory: true, status: 'completed' }];
    assert.equal(deriveStatus(records, 'cancelled'), 'cancelled');
  });

  test('🔴 video completion is measured on WATCHED seconds, not on position', () => {
    const lesson = { videoCompletionPercent: 90 };

    // Dragged to the end: position is 100%, watched is nothing.
    assert.equal(
      videoIsComplete(lesson, {
        videoDurationSeconds: 600,
        watchedSeconds: 5,
        lastPositionSeconds: 600,
      }),
      false,
    );

    assert.equal(
      videoIsComplete(lesson, { videoDurationSeconds: 600, watchedSeconds: 540 }),
      true,
    );
  });

  test('a video with no recorded duration is never auto-completed', () => {
    // Nothing to measure against, so it falls back to an explicit action rather
    // than silently crediting the learner.
    assert.equal(
      videoIsComplete({ videoCompletionPercent: 90 }, { videoDurationSeconds: null, watchedSeconds: 9999 }),
      false,
    );
  });

  test('overdue is derived from the date, never stored', () => {
    assert.equal(deriveDueState(dayIn(-2), 'in_progress').state, 'overdue');
    assert.equal(deriveDueState(dayIn(-2), 'in_progress').label, 'Overdue by 2 days');
    assert.equal(deriveDueState(dayIn(1), 'in_progress').label, 'Due tomorrow');
    assert.equal(deriveDueState(dayIn(2), 'assigned').state, 'due_soon');
    assert.equal(deriveDueState(dayIn(30), 'assigned').state, 'upcoming');
    assert.equal(deriveDueState(null, 'assigned').state, 'none');
    // A completed path is never overdue, however long ago the deadline was.
    assert.equal(deriveDueState(dayIn(-99), 'completed').state, 'completed');
  });

  test('sequential locking skips OPTIONAL predecessors', () => {
    const courses = [
      { _id: 'a', name: 'A', order: 0, mandatory: true },
      { _id: 'b', name: 'B', order: 1, mandatory: false },
      { _id: 'c', name: 'C', order: 2, mandatory: true },
    ];
    const records = [
      { courseId: 'a', mandatory: true, status: 'completed' },
      { courseId: 'b', mandatory: true, status: 'not_started' },
      { courseId: 'c', mandatory: true, status: 'not_started' },
    ];

    const rollup = courseProgress(courses, records, { sequential: true });
    // B is optional and untouched, so it must not wall off C.
    assert.equal(rollup[2].locked, false);
  });

  test('a completed course is never locked, so finished material stays readable', () => {
    const courses = [
      { _id: 'a', name: 'A', order: 0, mandatory: true },
      { _id: 'b', name: 'B', order: 1, mandatory: true },
    ];
    const records = [
      { courseId: 'a', mandatory: true, status: 'not_started' },
      { courseId: 'b', mandatory: true, status: 'completed' },
    ];
    const rollup = courseProgress(courses, records, { sequential: true });
    assert.equal(rollup[1].locked, false);
  });
});

// ===========================================================================
// The rule engine
// ===========================================================================

describe('assignment rules', () => {
  test('within a criterion is OR, across criteria is AND', () => {
    const it = new mongoose.Types.ObjectId();
    const sales = new mongoose.Types.ObjectId();

    const rule = {
      active: true,
      matchAll: false,
      criteria: {
        departmentIds: [it, sales],
        designations: ['Software Developer'],
        employmentTypes: ['full_time'],
        locationIds: [],
      },
    };

    // IT + developer + full time.
    assert.equal(
      employeeMatchesRule(
        { departmentId: it, designation: 'Software Developer', employmentType: 'full_time' },
        rule,
      ),
      true,
    );
    // Sales also matches the department criterion — it is an OR within the field.
    assert.equal(
      employeeMatchesRule(
        { departmentId: sales, designation: 'Software Developer', employmentType: 'full_time' },
        rule,
      ),
      true,
    );
    // Right department, wrong employment type — the AND across fields fails.
    assert.equal(
      employeeMatchesRule(
        { departmentId: it, designation: 'Software Developer', employmentType: 'intern' },
        rule,
      ),
      false,
    );
  });

  test('an empty criterion means "any", not "none"', () => {
    const rule = {
      active: true,
      matchAll: false,
      criteria: { departmentIds: [], locationIds: [], designations: [], employmentTypes: ['full_time'] },
    };
    assert.equal(employeeMatchesRule({ departmentId: null, employmentType: 'full_time' }, rule), true);
  });

  test('designation matching ignores case and surrounding space', () => {
    const rule = {
      active: true,
      matchAll: false,
      criteria: { departmentIds: [], locationIds: [], designations: ['Software Developer'], employmentTypes: [] },
    };
    assert.equal(employeeMatchesRule({ designation: '  software developer ' }, rule), true);
    assert.equal(employeeMatchesRule({ designation: 'Sales Executive' }, rule), false);
  });

  test('an inactive rule matches nobody', () => {
    assert.equal(employeeMatchesRule({ designation: 'x' }, { active: false, matchAll: true }), false);
  });
});

// ===========================================================================
// 🔴 THE SECTION 28 END-TO-END FLOW
// ===========================================================================

describe('the full onboarding-to-certificate flow', () => {
  test('a new employee is assigned, learns, passes, and is certified', async () => {
    const department = await Department.create({ name: 'IT', code: 'IT' });
    const { path, courseOne, courseTwo, assessment } = await makePath();

    await AssignmentRule.create({
      name: 'IT developers — onboarding',
      pathId: path._id,
      pathName: path.name,
      matchAll: false,
      criteria: {
        departmentIds: [department._id],
        designations: ['Software Developer'],
        employmentTypes: ['full_time'],
        locationIds: [],
      },
      trigger: 'on_create',
      active: true,
    });

    // ---- employee created -> the rule fires ------------------------------
    const { user, employee } = await makeEmployee({
      departmentId: department._id,
      designation: 'Software Developer',
      employmentType: 'full_time',
      dateOfJoining: new Date('2026-09-16T00:00:00Z'),
    });

    const outcome = await runRulesForEmployee(employee.toObject(), {});
    assert.equal(outcome.matched, 1);
    assert.equal(outcome.assigned, 1);
    assert.deepEqual(outcome.errors, []);

    const assignment = await LearningAssignment.findOne({ employeeId: employee._id });
    assert.ok(assignment, 'the rule created an assignment');
    assert.equal(assignment.source, 'rule');
    assert.equal(assignment.lessons.length, 3, 'all three lessons were snapshot');

    // Joining 16 Sep + 15 days = 1 Oct. The section 10 arithmetic.
    assert.equal(assignment.dueDate, '2026-10-01');

    // ---- the employee is told ---------------------------------------------
    const inbox = await InboxItem.findOne({ recipientEmployeeId: employee._id });
    assert.ok(inbox, 'a notification was filed');
    assert.equal(inbox.type, INBOX_TYPES.ACADEMY_ASSIGNED);

    const app = appFor(user);

    await withServer(app, async (url) => {
      // ---- it appears in My Learning ------------------------------------
      const mine = await get(url, `${P}/my-learning`);
      assert.equal(mine.status, 200);
      assert.equal(mine.body.data.assignments.length, 1);
      assert.equal(mine.body.data.summary.notStarted, 1);
      assert.equal(mine.body.data.continue.nextLesson.lessonTitle, 'Password Security');

      const id = assignment._id.toString();
      const videoLesson = courseOne.lessons[0]._id.toString();
      const pdfLesson = courseOne.lessons[1]._id.toString();
      const quizLesson = courseTwo.lessons[0]._id.toString();

      // ---- the second course is LOCKED behind the first ------------------
      const before = await get(url, `${P}/assignments/${id}`);
      assert.equal(before.status, 200);
      assert.equal(before.body.data.courses[1].locked, true);
      assert.equal(before.body.data.courses[1].lockedBy, 'IT Security Awareness');

      // ...and the lock is enforced by the SERVER, not only drawn by the UI.
      const jumpAhead = await get(url, `${P}/assignments/${id}/lessons/${quizLesson}/attempt`);
      assert.equal(jumpAhead.status, 403);
      assert.equal(jumpAhead.body.code, 'COURSE_LOCKED');

      // ---- watch the video ------------------------------------------------
      const firstPing = await post(url, `${P}/assignments/${id}/lessons/${videoLesson}/video-progress`, {
        positionSeconds: 10,
        watchedDeltaSeconds: 10,
      });
      assert.equal(firstPing.status, 200);
      assert.equal(firstPing.body.data.status, 'in_progress');

      /**
       * The cumulative ceiling means real time has to pass before a learner can
       * be credited with the whole clip — which is the point of it. Rather than
       * sleeping for five minutes, the lesson's `startedAt` is wound back to
       * simulate somebody who opened it twenty minutes ago.
       *
       * This is the honest way to test a wall-clock bound: move the clock, not
       * the bound.
       */
      await LearningAssignment.updateOne(
        { _id: assignment._id, 'lessons.lessonId': courseOne.lessons[0]._id },
        { $set: { 'lessons.$.startedAt': new Date(Date.now() - 20 * 60 * 1000) } },
      );

      await post(url, `${P}/assignments/${id}/lessons/${videoLesson}/video-progress`, {
        positionSeconds: 600,
        watchedDeltaSeconds: 560,
      });

      const watched = await get(url, `${P}/assignments/${id}`);
      const videoRecord = watched.body.data.courses[0].lessons[0];
      assert.equal(videoRecord.status, 'completed', 'the video completed once genuinely watched');

      // ---- read the PDF ---------------------------------------------------
      const pdfDone = await post(url, `${P}/assignments/${id}/lessons/${pdfLesson}/complete`, {
        acknowledged: true,
      });
      assert.equal(pdfDone.status, 200);
      assert.equal(pdfDone.body.data.status, 'completed');

      // ---- the next course unlocks ----------------------------------------
      const unlocked = await get(url, `${P}/assignments/${id}`);
      assert.equal(unlocked.body.data.courses[1].locked, false);

      // ---- the quiz: answers are NOT in the response ----------------------
      const quiz = await get(url, `${P}/assignments/${id}/lessons/${quizLesson}/attempt`);
      assert.equal(quiz.status, 200);
      const serialised = JSON.stringify(quiz.body);
      assert.equal(
        serialised.includes('isCorrect'),
        false,
        '🔴 the answer key must never reach a learner',
      );

      // ---- fail, then retry -----------------------------------------------
      const q1 = assessment.questions[0];
      const q2 = assessment.questions[1];

      const failed = await post(url, `${P}/assignments/${id}/lessons/${quizLesson}/attempt`, {
        answers: [
          { questionId: q1._id.toString(), selectedOptionIds: [q1.options[1]._id.toString()] },
          { questionId: q2._id.toString(), selectedOptionIds: [q2.options[2]._id.toString()] },
        ],
      });
      assert.equal(failed.status, 201);
      assert.equal(failed.body.data.score, 0);
      assert.equal(failed.body.data.passed, false);
      assert.equal(failed.body.data.attemptNo, 1);

      // A failed quiz leaves the path incomplete.
      assert.equal(failed.body.data.pathCompleted, false);

      const passed = await post(url, `${P}/assignments/${id}/lessons/${quizLesson}/attempt`, {
        answers: [
          { questionId: q1._id.toString(), selectedOptionIds: [q1.options[0]._id.toString()] },
          {
            questionId: q2._id.toString(),
            selectedOptionIds: [q2.options[0]._id.toString(), q2.options[1]._id.toString()],
          },
        ],
      });
      assert.equal(passed.status, 201);
      assert.equal(passed.body.data.score, 100);
      assert.equal(passed.body.data.passed, true);
      assert.equal(passed.body.data.attemptNo, 2);
      assert.equal(passed.body.data.assignmentStatus, 'completed');
      assert.equal(passed.body.data.pathCompleted, true);

      // ---- the certificate ------------------------------------------------
      const certificate = await AcademyCertificate.findOne({ employeeId: employee._id });
      assert.ok(certificate, 'a certificate was issued on completion');
      assert.match(certificate.certificateNo, /^SIA-/);
      assert.ok(certificate.storageKey, 'the document was rendered and stored');

      const mineCerts = await get(url, `${P}/certificates/mine`);
      assert.equal(mineCerts.status, 200);
      assert.equal(mineCerts.body.data.length, 1);

      const link = await get(url, `${P}/certificates/${certificate._id}/document-url`);
      assert.equal(link.status, 200);
      assert.ok(link.body.data.url, 'a presigned URL is issued');

      // ---- both attempts survive -------------------------------------------
      const finished = await get(url, `${P}/assignments/${id}`);
      const quizRecord = finished.body.data.courses[1].lessons[0];
      assert.equal(quizRecord.assessment.attemptCount, 2);
      assert.equal(quizRecord.assessment.bestScore, 100);
      assert.equal(finished.body.data.percent, 100);
      assert.equal(finished.body.data.status, 'completed');
    });

    // ---- HR sees the completion ------------------------------------------
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    await withServer(appFor(hrUser), async (url) => {
      const report = await get(url, `${P}/reports/employee-status`);
      assert.equal(report.status, 200);
      const row = report.body.data.rows.find((r) => r.employeeId === employee._id.toString());
      assert.equal(row.status, 'completed');
      assert.equal(row.percent, 100);

      const dashboard = await get(url, `${P}/dashboard`);
      assert.equal(dashboard.body.data.metrics.completed, 1);
      assert.equal(dashboard.body.data.metrics.overdue, 0);
    });
  });
});

// ===========================================================================
// 🔴 THE SECTION 2 INTEGRATION: creating an employee assigns their training
// ===========================================================================

describe('employee creation triggers assignment', () => {
  test('POST /employees fires the rules and reports what was assigned', async () => {
    const department = await Department.create({ name: 'IT', code: 'IT' });
    const { path } = await makePath({ requiresCertificate: false });

    await AssignmentRule.create({
      name: 'IT full-time — onboarding',
      pathId: path._id,
      pathName: path.name,
      matchAll: false,
      criteria: {
        departmentIds: [department._id],
        locationIds: [],
        designations: ['Software Developer'],
        employmentTypes: ['full_time'],
      },
      trigger: 'on_create',
      active: true,
    });

    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(hrUser), async (url) => {
      const res = await post(url, '/api/v1/hrms/employees', {
        employeeCode: 'DEV0001',
        firstName: 'Priya',
        lastName: 'Sharma',
        email: 'priya.sharma@example.com',
        dateOfJoining: '2026-09-16',
        employmentType: 'full_time',
        designation: 'Software Developer',
        departmentId: department._id.toString(),
        status: 'active',
      });

      assert.equal(res.status, 201, JSON.stringify(res.body));

      // The employee was created, and the response still carries what it always
      // did — the academy field is additive.
      assert.ok(res.body.data.employee.id);
      assert.ok(res.body.data.tempPassword);

      // ...and it reports the training that was assigned as a consequence.
      assert.equal(res.body.data.academy.assigned, 1);
      assert.equal(res.body.data.academy.matched, 1);
      assert.deepEqual(res.body.data.academy.errors, []);
    });

    const assignment = await LearningAssignment.findOne({ pathId: path._id });
    assert.ok(assignment, 'the assignment exists in the database');
    assert.equal(assignment.source, 'rule');
    assert.equal(assignment.ruleName, 'IT full-time — onboarding');
    // Joining 16 Sep 2026 + 15 days.
    assert.equal(assignment.dueDate, '2026-10-01');

    // The new employee can see it immediately, with no further setup.
    const learner = await Employee.findById(assignment.employeeId).lean();
    const learnerUser = await User.findById(learner.userId).lean();

    await withServer(appFor(learnerUser), async (url) => {
      const mine = await get(url, `${P}/my-learning`);
      assert.equal(mine.status, 200);
      assert.equal(mine.body.data.assignments.length, 1);
      assert.equal(mine.body.data.assignments[0].pathName, path.name);
    });
  });

  test('an employee who matches NO rule is still created, with nothing assigned', async () => {
    const department = await Department.create({ name: 'Sales', code: 'SALES' });
    const { path } = await makePath({ requiresCertificate: false });

    await AssignmentRule.create({
      name: 'IT only',
      pathId: path._id,
      pathName: path.name,
      matchAll: false,
      criteria: {
        departmentIds: [new mongoose.Types.ObjectId()],
        locationIds: [],
        designations: [],
        employmentTypes: [],
      },
      trigger: 'on_create',
      active: true,
    });

    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(hrUser), async (url) => {
      const res = await post(url, '/api/v1/hrms/employees', {
        employeeCode: 'SAL0001',
        firstName: 'Rahul',
        lastName: 'Verma',
        email: 'rahul.verma@example.com',
        dateOfJoining: '2026-09-16',
        employmentType: 'full_time',
        departmentId: department._id.toString(),
        status: 'active',
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.academy.matched, 0);
      assert.equal(res.body.data.academy.assigned, 0);
    });

    assert.equal(await LearningAssignment.countDocuments({}), 0);
  });

  test('🔴 a rule pointing at a deleted path does not break employee creation', async () => {
    // The guarantee that makes the hook safe to add to a write path HR depends
    // on. A misconfigured rule costs a missing assignment, never an employee.
    const ghost = await LearningPath.create({ name: 'Ghost path', active: true });
    await AssignmentRule.create({
      name: 'Points at nothing',
      pathId: ghost._id,
      pathName: ghost.name,
      matchAll: true,
      trigger: 'on_create',
      active: true,
    });
    await LearningPath.deleteOne({ _id: ghost._id });

    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(hrUser), async (url) => {
      const res = await post(url, '/api/v1/hrms/employees', {
        employeeCode: 'GHO0001',
        firstName: 'Anita',
        lastName: 'Desai',
        email: 'anita.desai@example.com',
        dateOfJoining: '2026-09-16',
        employmentType: 'full_time',
        status: 'active',
      });

      assert.equal(res.status, 201, 'the employee is created regardless');
      assert.equal(res.body.data.academy.assigned, 0);
      assert.equal(res.body.data.academy.skipped[0].reason, 'PATH_UNAVAILABLE');
    });

    assert.ok(await Employee.findOne({ employeeCode: 'GHO0001' }), 'the employee record survived');
  });
});

// ===========================================================================
// Data integrity — section 26
// ===========================================================================

describe('data integrity', () => {
  test('🔴 an employee cannot complete somebody else\'s lesson', async () => {
    const { path, courseOne } = await makePath({ sequential: false, requiresCertificate: false });
    const { employee: owner } = await makeEmployee();
    const { user: strangerUser } = await makeEmployee();

    const courses = await AcademyCourse.find({ pathId: path._id }).lean();
    const assignment = await LearningAssignment.create({
      employeeId: owner._id,
      employeeName: 'Owner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: courses.flatMap((c) =>
        c.lessons.map((l) => ({
          courseId: c._id,
          lessonId: l._id,
          title: l.title,
          type: l.type,
          mandatory: true,
          status: 'not_started',
        })),
      ),
    });

    await withServer(appFor(strangerUser), async (url) => {
      const attempt = await post(
        url,
        `${P}/assignments/${assignment._id}/lessons/${courseOne.lessons[1]._id}/complete`,
        { acknowledged: true },
      );
      assert.equal(attempt.status, 403);
    });

    const after = await LearningAssignment.findById(assignment._id);
    assert.equal(after.lessons[1].status, 'not_started', 'nothing was written');
  });

  test('🔴 an HR admin may READ anybody\'s progress but not complete their lesson', async () => {
    const { path, courseOne } = await makePath({ sequential: false, requiresCertificate: false });
    const { employee: learner } = await makeEmployee();
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    const courses = await AcademyCourse.find({ pathId: path._id }).lean();
    const assignment = await LearningAssignment.create({
      employeeId: learner._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: courses.flatMap((c) =>
        c.lessons.map((l) => ({
          courseId: c._id,
          lessonId: l._id,
          title: l.title,
          type: l.type,
          mandatory: true,
          status: 'not_started',
        })),
      ),
    });

    await withServer(appFor(hrUser), async (url) => {
      // Reading is fine — `academy:view:org`.
      const read = await get(url, `${P}/assignments/${assignment._id}`);
      assert.equal(read.status, 200);

      // Completing is not. A wider grant does NOT satisfy "I am the learner".
      const write = await post(
        url,
        `${P}/assignments/${assignment._id}/lessons/${courseOne.lessons[1]._id}/complete`,
        { acknowledged: true },
      );
      assert.equal(write.status, 403);
    });
  });

  test('🔴 a video cannot be marked complete by hand without being watched', async () => {
    const { path, courseOne } = await makePath({ sequential: false, requiresCertificate: false });
    const { user, employee } = await makeEmployee();

    const courses = await AcademyCourse.find({ pathId: path._id }).lean();
    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: courses.flatMap((c) =>
        c.lessons.map((l) => ({
          courseId: c._id,
          lessonId: l._id,
          title: l.title,
          type: l.type,
          mandatory: true,
          status: 'not_started',
          videoDurationSeconds: l.type === 'video' ? 600 : null,
        })),
      ),
    });

    await withServer(appFor(user), async (url) => {
      const cheat = await post(
        url,
        `${P}/assignments/${assignment._id}/lessons/${courseOne.lessons[0]._id}/complete`,
        { acknowledged: true },
      );
      assert.equal(cheat.status, 403);
      assert.equal(cheat.body.code, 'VIDEO_NOT_WATCHED');
    });
  });

  test('🔴 watch time is clamped against elapsed wall-clock', async () => {
    const { path, courseOne } = await makePath({ sequential: false, requiresCertificate: false });
    const { user, employee } = await makeEmployee();

    const courses = await AcademyCourse.find({ pathId: path._id }).lean();
    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: courses.flatMap((c) =>
        c.lessons.map((l) => ({
          courseId: c._id,
          lessonId: l._id,
          title: l.title,
          type: l.type,
          mandatory: true,
          status: 'not_started',
        })),
      ),
    });

    const videoLesson = courseOne.lessons[0]._id.toString();

    await withServer(appFor(user), async (url) => {
      // ONE request claiming an hour, with no prior ping at all. This is the
      // first-ping hole: there is no previous timestamp to clamp against, so a
      // per-request check would have credited the lot.
      const oneShot = await post(
        url,
        `${P}/assignments/${assignment._id}/lessons/${videoLesson}/video-progress`,
        { positionSeconds: 600, watchedDeltaSeconds: 3600 },
      );

      assert.equal(oneShot.status, 200);
      assert.equal(
        oneShot.body.data.status,
        'in_progress',
        'a single 3600s claim cannot complete a 600s video',
      );
      assert.ok(
        oneShot.body.data.watchedSeconds <= 20,
        `expected only the grace to be credited, got ${oneShot.body.data.watchedSeconds}`,
      );

      /**
       * ...and a hundred requests earn no more than the clock allows, because
       * the ceiling moves with time rather than with the request count.
       *
       * The bound is asserted against MEASURED elapsed time rather than a fixed
       * number. A hundred round trips take milliseconds on an idle machine and
       * twenty-five seconds when the whole suite is running in parallel, and a
       * magic number turns the second case into a failure that looks like a
       * regression. What is actually being claimed is the invariant:
       *
       *     watchedSeconds <= elapsed x 2 + one heartbeat of grace
       */
      const startedAt = Date.now();
      for (let i = 0; i < 100; i += 1) {
        await post(
          url,
          `${P}/assignments/${assignment._id}/lessons/${videoLesson}/video-progress`,
          { positionSeconds: 600, watchedDeltaSeconds: 600 },
        );
      }
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const ceiling = elapsedSeconds * 2 + 15;

      const after = await LearningAssignment.findById(assignment._id);
      const record = after.lessons.find((l) => String(l.lessonId) === videoLesson);

      assert.ok(
        record.watchedSeconds <= ceiling + 1,
        `credited ${record.watchedSeconds}s against a ceiling of ${ceiling.toFixed(1)}s `
          + `after ${elapsedSeconds.toFixed(1)}s of real time`,
      );
      assert.ok(
        record.watchedSeconds < 540,
        `60,000 claimed seconds must not reach the 90% mark of a 600s clip; got ${record.watchedSeconds}s`,
      );
      assert.equal(record.status, 'in_progress', 'the video is still not complete');
    });
  });

  test('🔴 no certificate is issued for an unfinished path', async () => {
    const { path } = await makePath({ sequential: false, requiresCertificate: true });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee } = await makeEmployee();

    const courses = await AcademyCourse.find({ pathId: path._id }).lean();
    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      requiresCertificate: true,
      // Claim completion in the STORED status while the lessons say otherwise —
      // the case `issue()` re-verifies against.
      status: 'completed',
      lessons: courses.flatMap((c) =>
        c.lessons.map((l) => ({
          courseId: c._id,
          lessonId: l._id,
          title: l.title,
          type: l.type,
          mandatory: true,
          status: 'not_started',
        })),
      ),
    });

    await withServer(appFor(hrUser), async (url) => {
      const res = await post(url, `${P}/assignments/${assignment._id}/certificate`, {});
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'ASSIGNMENT_NOT_COMPLETE');
    });

    assert.equal(await AcademyCertificate.countDocuments({}), 0);
  });

  test('a duplicate assignment is refused by the index, not merely by a check', async () => {
    const { path } = await makePath({ requiresCertificate: false });
    const { employee } = await makeEmployee();

    const base = {
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [],
    };

    await LearningAssignment.create(base);
    await assert.rejects(
      () => LearningAssignment.create(base),
      (err) => err.code === 11000,
      'the unique partial index is the guarantee',
    );

    // ...but a CANCELLED one does not block re-assignment.
    await LearningAssignment.updateOne({ employeeId: employee._id }, { $set: { status: 'cancelled' } });
    const again = await LearningAssignment.create(base);
    assert.ok(again._id);
  });
});

// ===========================================================================
// Duplicates, empty paths and the assignment API
// ===========================================================================

describe('assigning', () => {
  test('a bulk assign reports per-employee outcomes rather than failing', async () => {
    const { path } = await makePath({ requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee: a } = await makeEmployee();
    const { employee: b } = await makeEmployee();

    await withServer(appFor(hrUser), async (url) => {
      const first = await post(url, `${P}/assignments`, {
        employeeIds: [a._id.toString()],
        pathId: path._id.toString(),
      });
      assert.equal(first.status, 201);
      assert.equal(first.body.data.assigned, 1);

      // `a` already has it; `b` does not. One request, both handled.
      const second = await post(url, `${P}/assignments`, {
        employeeIds: [a._id.toString(), b._id.toString()],
        pathId: path._id.toString(),
      });
      assert.equal(second.status, 201);
      assert.equal(second.body.data.assigned, 1);
      assert.equal(second.body.data.skipped.length, 1);
      assert.equal(second.body.data.skipped[0].reason, 'ALREADY_ASSIGNED');
    });
  });

  test('an empty path cannot be assigned — it could never complete', async () => {
    const empty = await LearningPath.create({ name: 'Empty path', active: true });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee } = await makeEmployee();

    await withServer(appFor(hrUser), async (url) => {
      const res = await post(url, `${P}/assignments`, {
        employeeIds: [employee._id.toString()],
        pathId: empty._id.toString(),
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'PATH_EMPTY');
    });
  });

  test('somebody who has left is not assigned new training', async () => {
    const { path } = await makePath({ requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee } = await makeEmployee({ status: 'exited' });

    await withServer(appFor(hrUser), async (url) => {
      const res = await post(url, `${P}/assignments`, {
        employeeIds: [employee._id.toString()],
        pathId: path._id.toString(),
      });
      assert.equal(res.body.data.assigned, 0);
      assert.equal(res.body.data.skipped[0].reason, 'EMPLOYEE_NOT_ACTIVE');
    });
  });

  test('an assignment is created even when a rule points at a broken path', async () => {
    // A rule whose path was deactivated must not break employee creation; it is
    // reported instead. This is the guarantee `createEmployee` depends on.
    const path = await LearningPath.create({ name: 'Deactivated', active: false });
    await AssignmentRule.create({
      name: 'Broken rule',
      pathId: path._id,
      pathName: path.name,
      matchAll: true,
      trigger: 'on_create',
      active: true,
    });

    const { employee } = await makeEmployee();
    const outcome = await runRulesForEmployee(employee.toObject(), {});

    assert.equal(outcome.matched, 1);
    assert.equal(outcome.assigned, 0);
    assert.equal(outcome.skipped[0].reason, 'PATH_UNAVAILABLE');
    assert.deepEqual(outcome.errors, [], 'a broken rule is reported, never thrown');
  });
});

// ===========================================================================
// Permissions — section 19
// ===========================================================================

describe('permissions', () => {
  test('an ordinary employee cannot reach the admin surface', async () => {
    const { user } = await makeEmployee();

    await withServer(appFor(user), async (url) => {
      for (const path of ['/content', '/assessments', '/rules', '/dashboard']) {
        const res = await get(url, `${P}${path}`);
        assert.equal(res.status, 403, `${path} must be refused`);
      }

      const write = await post(url, `${P}/paths`, { name: 'Mine' });
      assert.equal(write.status, 403);
    });
  });

  test('an employee sees only their own assignments', async () => {
    const { path } = await makePath({ requiresCertificate: false });
    const { user: mineUser, employee: mine } = await makeEmployee();
    const { employee: theirs } = await makeEmployee();

    for (const employee of [mine, theirs]) {
      await LearningAssignment.create({
        employeeId: employee._id,
        employeeName: 'Someone',
        pathId: path._id,
        pathName: path.name,
        source: 'manual',
        lessons: [],
      });
    }

    await withServer(appFor(mineUser), async (url) => {
      const res = await get(url, `${P}/assignments`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.total, 1, 'the scope filter narrows the QUERY, so total is honest');
      assert.equal(res.body.data.data[0].employeeId, mine._id.toString());
    });
  });

  test('a manager sees their reports, and nobody else', async () => {
    const { path } = await makePath({ requiresCertificate: false });
    const { user: managerUser, employee: manager } = await makeEmployee({ roles: [R.MANAGER] });
    const { employee: report } = await makeEmployee({ managerChain: [manager._id] });
    const { employee: stranger } = await makeEmployee();

    for (const employee of [report, stranger]) {
      await LearningAssignment.create({
        employeeId: employee._id,
        employeeName: 'Someone',
        pathId: path._id,
        pathName: path.name,
        source: 'manual',
        lessons: [],
      });
    }

    await withServer(appFor(managerUser), async (url) => {
      const res = await get(url, `${P}/assignments`);
      assert.equal(res.status, 200);
      const ids = res.body.data.data.map((r) => r.employeeId);
      assert.ok(ids.includes(report._id.toString()));
      assert.equal(ids.includes(stranger._id.toString()), false);
    });
  });

  test('a manager cannot author the catalogue', async () => {
    const { user } = await makeEmployee({ roles: [R.MANAGER] });
    await withServer(appFor(user), async (url) => {
      assert.equal((await post(url, `${P}/paths`, { name: 'x' })).status, 403);
      assert.equal((await get(url, `${P}/assessments`)).status, 403);
    });
  });
});

// ===========================================================================
// The catalogue — editing without rewriting history
// ===========================================================================

describe('catalogue edits and live assignments', () => {
  test('adding a lesson adds it to live assignments and reopens a completed path', async () => {
    const { path, courseOne } = await makePath({ sequential: false, requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      status: 'completed',
      completedAt: new Date(),
      lessons: courseOne.lessons.map((l) => ({
        courseId: courseOne._id,
        lessonId: l._id,
        title: l.title,
        type: l.type,
        mandatory: true,
        status: 'completed',
      })),
    });

    const extra = await makeContent({ type: 'pdf', title: 'New compliance note' });

    await withServer(appFor(hrUser), async (url) => {
      const res = await post(url, `${P}/courses/${courseOne._id}/lessons`, {
        title: 'New compliance note',
        type: 'pdf',
        contentId: extra._id.toString(),
        mandatory: true,
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.assignmentsUpdated, 1);
    });

    const after = await LearningAssignment.findById(assignment._id);
    assert.equal(after.lessons.length, 3, 'the new lesson was added');
    assert.equal(
      after.status,
      'in_progress',
      'new mandatory material reopens a completed compliance path',
    );
    assert.equal(after.completedAt, null, 'the stale completion date is cleared');
  });

  test('making a lesson optional does NOT retroactively complete it for anyone', async () => {
    const { path, courseOne } = await makePath({ sequential: false, requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: courseOne.lessons.map((l) => ({
        courseId: courseOne._id,
        lessonId: l._id,
        title: l.title,
        type: l.type,
        mandatory: true,
        status: 'not_started',
      })),
    });

    await withServer(appFor(hrUser), async (url) => {
      const res = await patch(
        url,
        `${P}/courses/${courseOne._id}/lessons/${courseOne.lessons[0]._id}`,
        { mandatory: false },
      );
      assert.equal(res.status, 200);
    });

    const after = await LearningAssignment.findById(assignment._id);
    assert.equal(
      after.lessons[0].mandatory,
      true,
      'the snapshot on the live assignment is untouched',
    );
    assert.equal(after.status, 'assigned');
  });

  test('content still used by a course cannot be deleted, and says which', async () => {
    const { video } = await makePath({ requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(hrUser), async (url) => {
      const res = await del(url, `${P}/content/${video._id}`);
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'CONTENT_IN_USE');
      assert.equal(res.body.details.courses[0].name, 'IT Security Awareness');
    });

    // makePath seeds two content items — a video and a PDF. Neither was removed.
    assert.equal(await AcademyContent.countDocuments({ deletedAt: null }), 2);
  });

  test('a path somebody is mid-way through cannot be deleted', async () => {
    const { path } = await makePath({ requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee } = await makeEmployee();

    await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      status: 'in_progress',
      lessons: [],
    });

    await withServer(appFor(hrUser), async (url) => {
      const res = await del(url, `${P}/paths/${path._id}`);
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'PATH_IN_USE');
    });
  });

  test('a reorder clears a prerequisite it would have made unsatisfiable', async () => {
    const { path, courseOne, courseTwo } = await makePath({ requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    // Course two depends on course one, which is legal while one comes first.
    await AcademyCourse.updateOne(
      { _id: courseTwo._id },
      { $set: { prerequisiteCourseId: courseOne._id } },
    );

    await withServer(appFor(hrUser), async (url) => {
      // Swap them. The dependency now points forwards, which nobody could satisfy.
      const res = await patch(url, `${P}/paths/${path._id}/courses/reorder`, {
        courseIds: [courseTwo._id.toString(), courseOne._id.toString()],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.prerequisitesCleared.length, 1);
      assert.equal(res.body.data.prerequisitesCleared[0].name, 'Final Assessment');
    });

    const after = await AcademyCourse.findById(courseTwo._id);
    assert.equal(after.prerequisiteCourseId, null);
  });

  test('a partial reorder is refused rather than half-applied', async () => {
    const { path, courseOne } = await makePath({ requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(hrUser), async (url) => {
      const res = await patch(url, `${P}/paths/${path._id}/courses/reorder`, {
        courseIds: [courseOne._id.toString()],
      });
      assert.equal(res.status, 400);
    });
  });
});

// ===========================================================================
// Assessments
// ===========================================================================

describe('assessments', () => {
  test('a multiple-answer question is marked all-or-nothing', async () => {
    const { path, courseTwo, assessment } = await makePath({
      sequential: false,
      requiresCertificate: false,
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: courseTwo._id,
          lessonId: courseTwo.lessons[0]._id,
          title: 'Security Assessment',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    const q1 = assessment.questions[0];
    const q2 = assessment.questions[1];

    await withServer(appFor(user), async (url) => {
      // Right on q1; ticking EVERYTHING on q2 must not earn the mark.
      const res = await post(
        url,
        `${P}/assignments/${assignment._id}/lessons/${courseTwo.lessons[0]._id}/attempt`,
        {
          answers: [
            { questionId: q1._id.toString(), selectedOptionIds: [q1.options[0]._id.toString()] },
            {
              questionId: q2._id.toString(),
              selectedOptionIds: q2.options.map((o) => o._id.toString()),
            },
          ],
        },
      );
      assert.equal(res.status, 201);
      assert.equal(res.body.data.correctCount, 1);
      assert.equal(res.body.data.score, 50);
    });
  });

  test('an unanswered question counts as wrong, not as absent', async () => {
    const { path, courseTwo, assessment } = await makePath({
      sequential: false,
      requiresCertificate: false,
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: courseTwo._id,
          lessonId: courseTwo.lessons[0]._id,
          title: 'Security Assessment',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    await withServer(appFor(user), async (url) => {
      const res = await post(
        url,
        `${P}/assignments/${assignment._id}/lessons/${courseTwo.lessons[0]._id}/attempt`,
        {
          answers: [
            {
              questionId: assessment.questions[0]._id.toString(),
              selectedOptionIds: [assessment.questions[0].options[0]._id.toString()],
            },
          ],
        },
      );
      // One right out of TWO, not one out of one.
      assert.equal(res.body.data.questionCount, 2);
      assert.equal(res.body.data.score, 50);
    });
  });

  test('the attempt ceiling is enforced server-side', async () => {
    const assessment = await makeAssessment({ maxAttempts: 1, passingPercent: 100 });
    const path = await LearningPath.create({ name: 'Quiz only', active: true });
    const course = await AcademyCourse.create({
      pathId: path._id,
      name: 'Quiz',
      order: 0,
      lessons: [{ title: 'Quiz', type: 'quiz', assessmentId: assessment._id, mandatory: true, order: 0 }],
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: course._id,
          lessonId: course.lessons[0]._id,
          title: 'Quiz',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    const lessonPath = `${P}/assignments/${assignment._id}/lessons/${course.lessons[0]._id}/attempt`;

    await withServer(appFor(user), async (url) => {
      const first = await post(url, lessonPath, { answers: [] });
      assert.equal(first.status, 201);
      assert.equal(first.body.data.passed, false);
      assert.equal(first.body.data.attemptsRemaining, 0);

      const second = await post(url, lessonPath, { answers: [] });
      assert.equal(second.status, 409);
      assert.equal(second.body.code, 'ASSESSMENT_NO_ATTEMPTS_LEFT');
    });
  });

  test('🔴 the lesson says how many attempts are LEFT, so the UI cannot offer one that is refused', async () => {
    const assessment = await makeAssessment({ maxAttempts: 2, passingPercent: 100 });
    const path = await LearningPath.create({ name: 'Quiz only', active: true });
    const course = await AcademyCourse.create({
      pathId: path._id,
      name: 'Quiz',
      order: 0,
      lessons: [{ title: 'Quiz', type: 'quiz', assessmentId: assessment._id, mandatory: true, order: 0 }],
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: course._id,
          lessonId: course.lessons[0]._id,
          title: 'Quiz',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    const lessonPath = `${P}/assignments/${assignment._id}/lessons/${course.lessons[0]._id}/attempt`;
    const quizOf = async (url) => {
      const res = await get(url, `${P}/assignments/${assignment._id}`);
      return res.body.data.courses[0].lessons[0].assessment;
    };

    await withServer(appFor(user), async (url) => {
      // Before anything: two attempts, and the limit itself so the screen can
      // say "2 attempts left" rather than just enabling a button.
      let quiz = await quizOf(url);
      assert.equal(quiz.maxAttempts, 2);
      assert.equal(quiz.attemptsRemaining, 2);

      await post(url, lessonPath, { answers: [] });
      quiz = await quizOf(url);
      assert.equal(quiz.attemptsRemaining, 1);

      await post(url, lessonPath, { answers: [] });
      quiz = await quizOf(url);

      /*
       * THE BUG THIS PINS.
       *
       * The summary used to carry only what the learner had already DONE, never
       * what they were still allowed to do. So the lesson's landing screen had
       * nothing to gate on, offered "Try again" after the last attempt, and the
       * server refused the click — a control offered, accepted, then refused.
       */
      assert.equal(quiz.attemptsRemaining, 0);
      assert.equal(quiz.passed, false);

      // ...and the refusal still stands, so the two agree.
      const refused = await post(url, lessonPath, { answers: [] });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.code, 'ASSESSMENT_NO_ATTEMPTS_LEFT');
    });
  });

  test('an unlimited assessment reports null, not a number', async () => {
    const assessment = await makeAssessment({ maxAttempts: null });
    const path = await LearningPath.create({ name: 'Quiz only', active: true });
    const course = await AcademyCourse.create({
      pathId: path._id,
      name: 'Quiz',
      order: 0,
      lessons: [{ title: 'Quiz', type: 'quiz', assessmentId: assessment._id, mandatory: true, order: 0 }],
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: course._id,
          lessonId: course.lessons[0]._id,
          title: 'Quiz',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/assignments/${assignment._id}`);
      const quiz = res.body.data.courses[0].lessons[0].assessment;

      // Null is "unlimited". A zero here would hide the button forever, which
      // is the opposite of what an unlimited assessment means.
      assert.equal(quiz.maxAttempts, null);
      assert.equal(quiz.attemptsRemaining, null);
    });
  });

  test('🔴 the answer key never rides along on the attempt summary', async () => {
    const assessment = await makeAssessment({ maxAttempts: 2 });
    const path = await LearningPath.create({ name: 'Quiz only', active: true });
    const course = await AcademyCourse.create({
      pathId: path._id,
      name: 'Quiz',
      order: 0,
      lessons: [{ title: 'Quiz', type: 'quiz', assessmentId: assessment._id, mandatory: true, order: 0 }],
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: course._id,
          lessonId: course.lessons[0]._id,
          title: 'Quiz',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/assignments/${assignment._id}`);
      // The batch loader that fetches maxAttempts selects named fields only —
      // `questions` is not among them, so widening this DTO cannot leak them.
      assert.equal(JSON.stringify(res.body).includes('isCorrect'), false);
      assert.equal(JSON.stringify(res.body).includes('suspicious email'), false);
    });
  });

  test('a passed assessment cannot be re-sat and its score lowered', async () => {
    const assessment = await makeAssessment({ passingPercent: 50 });
    const path = await LearningPath.create({ name: 'Quiz only', active: true });
    const course = await AcademyCourse.create({
      pathId: path._id,
      name: 'Quiz',
      order: 0,
      lessons: [{ title: 'Quiz', type: 'quiz', assessmentId: assessment._id, mandatory: true, order: 0 }],
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: course._id,
          lessonId: course.lessons[0]._id,
          title: 'Quiz',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    const q1 = assessment.questions[0];
    const q2 = assessment.questions[1];
    const lessonPath = `${P}/assignments/${assignment._id}/lessons/${course.lessons[0]._id}/attempt`;

    await withServer(appFor(user), async (url) => {
      const pass = await post(url, lessonPath, {
        answers: [
          { questionId: q1._id.toString(), selectedOptionIds: [q1.options[0]._id.toString()] },
          {
            questionId: q2._id.toString(),
            selectedOptionIds: [q2.options[0]._id.toString(), q2.options[1]._id.toString()],
          },
        ],
      });
      assert.equal(pass.body.data.passed, true);

      const again = await post(url, lessonPath, { answers: [] });
      assert.equal(again.status, 409);
      assert.equal(again.body.code, 'ASSESSMENT_ALREADY_PASSED');
    });
  });
});

// ===========================================================================
// Reminders
// ===========================================================================

describe('the reminder sweep', () => {
  async function seedDueAssignment(dueDate) {
    const path = await LearningPath.create({ name: `Path ${Math.random()}`, active: true });
    const { employee } = await makeEmployee();
    return LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      status: 'in_progress',
      dueDate,
      lessons: [],
    });
  }

  test('it notifies on a due-soon and an overdue transition', async () => {
    await seedDueAssignment(dayIn(2));
    await seedDueAssignment(dayIn(-5));

    const result = await runAcademyReminderSweep();
    assert.equal(result.dueSoon, 1);
    assert.equal(result.overdue, 1);

    const types = (await InboxItem.find({}).lean()).map((i) => i.type).sort();
    assert.deepEqual(types, [INBOX_TYPES.ACADEMY_DUE_SOON, INBOX_TYPES.ACADEMY_OVERDUE].sort());
  });

  test('🔴 running it twice does not send the same reminder twice', async () => {
    await seedDueAssignment(dayIn(-5));

    await runAcademyReminderSweep();
    const second = await runAcademyReminderSweep();

    assert.equal(second.overdue, 0, 'the state has not changed, so nothing is sent');
    assert.equal(await InboxItem.countDocuments({}), 1);
  });

  test('a due-soon assignment that becomes overdue IS reminded again', async () => {
    const assignment = await seedDueAssignment(dayIn(2));
    await runAcademyReminderSweep();
    assert.equal(await InboxItem.countDocuments({}), 1);

    // The deadline passes.
    await LearningAssignment.updateOne({ _id: assignment._id }, { $set: { dueDate: dayIn(-1) } });
    const after = await runAcademyReminderSweep();

    assert.equal(after.overdue, 1);
    assert.equal(await InboxItem.countDocuments({}), 2);
  });

  test('completed and undated assignments are never reminded about', async () => {
    const done = await seedDueAssignment(dayIn(-10));
    await LearningAssignment.updateOne({ _id: done._id }, { $set: { status: 'completed' } });
    await seedDueAssignment(null);

    const result = await runAcademyReminderSweep();
    assert.equal(result.dueSoon + result.overdue, 0);
    assert.equal(await InboxItem.countDocuments({}), 0);
  });

  test('a dry run counts without writing or notifying', async () => {
    await seedDueAssignment(dayIn(-1));
    const result = await runAcademyReminderSweep({ dryRun: true });

    assert.equal(result.overdue, 1);
    assert.equal(await InboxItem.countDocuments({}), 0);
    const row = await LearningAssignment.findOne({});
    assert.equal(row.lastReminderState, null);
  });
});

// ===========================================================================
// Auditing — section 25
// ===========================================================================

describe('auditing', () => {
  test('assigning, submitting an attempt and issuing a certificate are all recorded', async () => {
    const { path } = await makePath({ sequential: false, requiresCertificate: false });
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { employee } = await makeEmployee();

    await withServer(appFor(hrUser), async (url) => {
      await post(url, `${P}/assignments`, {
        employeeIds: [employee._id.toString()],
        pathId: path._id.toString(),
      });
    });

    const entry = await AuditLog.findOne({ action: AUDIT_ACTIONS.ACADEMY_ASSIGNED });
    assert.ok(entry, 'the assignment was audited');
    assert.equal(entry.meta.employeeId, employee._id.toString());
    assert.equal(entry.meta.source, 'manual');
  });

  test('a report run records the filters and the row count, never the rows', async () => {
    const { user: hrUser } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(hrUser), async (url) => {
      const res = await get(url, `${P}/reports/employee-status`);
      assert.equal(res.status, 200);
    });

    const entry = await AuditLog.findOne({ action: AUDIT_ACTIONS.REPORT_RUN });
    assert.ok(entry);
    assert.equal(entry.meta.report, 'academy.employee_status');
    assert.equal(typeof entry.meta.rows, 'number');
    assert.equal(
      JSON.stringify(entry.meta).includes('employeeName'),
      false,
      'an audit row must not become a second copy of the report',
    );
  });
});

// ===========================================================================
// What the screens are given to draw with
// ===========================================================================

describe('the fields the Academy screens render', () => {
  /** A learner with the two-course path assigned, every lesson recorded. */
  async function assignedLearner() {
    const { path, courseOne, courseTwo, assessment } = await makePath({
      sequential: false,
      requiresCertificate: false,
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        ...courseOne.lessons.map((lesson) => ({
          courseId: courseOne._id,
          lessonId: lesson._id,
          title: lesson.title,
          type: lesson.type,
          mandatory: true,
          status: 'not_started',
        })),
        {
          courseId: courseTwo._id,
          lessonId: courseTwo.lessons[0]._id,
          title: 'Security Assessment',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    return { user, employee, assignment, path, courseOne, courseTwo, assessment };
  }

  test('my-learning states how many COURSES a path spans, not only its lessons', async () => {
    const { user, assignment } = await assignedLearner();

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/my-learning`);
      assert.equal(res.status, 200);

      const row = res.body.data.assignments.find((a) => a.id === assignment._id.toString());
      // Two courses - the card reads "2 Courses" beside the lesson count.
      assert.equal(row.totalCourses, 2);
      assert.ok(row.totalLessons >= 2);
    });
  });

  test('a quiz lesson carries the rules of its assessment before it is started', async () => {
    const { user, assignment } = await assignedLearner();

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/assignments/${assignment._id}`);
      assert.equal(res.status, 200);

      const quiz = res.body.data.courses.flatMap((c) => c.lessons).find((l) => l.type === 'quiz');

      // The panel the learner reads before committing to an attempt.
      assert.equal(quiz.assessment.passingPercent, 70);
      assert.equal(quiz.assessment.questionCount, 2);
      assert.equal(quiz.assessment.scorePolicy, 'highest');
      assert.equal(quiz.assessment.attemptCount, 0);
    });
  });

  test('the question COUNT arrives without any question reaching the wire', async () => {
    const { user, assignment } = await assignedLearner();

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/assignments/${assignment._id}`);
      assert.equal(res.status, 200);

      const quiz = res.body.data.courses.flatMap((c) => c.lessons).find((l) => l.type === 'quiz');

      assert.equal(quiz.assessment.questionCount, 2);

      /**
       * The projection behind that count selects `questions._id` and nothing
       * else, and replaces the array with its length. If it is ever widened,
       * this is what catches it: no question text, no option text and above all
       * no `isCorrect` may appear anywhere in this response.
       */
      assert.equal(quiz.assessment.questions, undefined);

      const wire = JSON.stringify(res.body);
      assert.ok(!wire.includes('isCorrect'), 'correctness must never be serialised');
    });
  });

  /**
   * The path's blurb reaches the hero and the About tab.
   *
   * It was missing from this DTO and neither screen noticed, because the
   * frontend fixture supplied a description the server never sent. That is the
   * shape of bug a fixture hides, so the round trip is asserted here against a
   * real path rather than a hand-written object.
   */
  test('the path detail carries the path description, read live', async () => {
    const { user, assignment, path } = await assignedLearner();

    await withServer(appFor(user), async (url) => {
      const before = await get(url, `${P}/assignments/${assignment._id}`);
      assert.equal(before.body.data.description, path.description);
      assert.ok(path.description, 'the fixture path must actually have one');
    });

    // Edited by HR: every learner sees the new wording, not the wording as it
    // was on the day they were assigned.
    await LearningPath.updateOne({ _id: path._id }, { $set: { description: 'Revised blurb.' } });

    await withServer(appFor(user), async (url) => {
      const after = await get(url, `${P}/assignments/${assignment._id}`);
      assert.equal(after.body.data.description, 'Revised blurb.');
    });
  });

  test('the content library says how many courses depend on each item', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    await makePath({ sequential: false, requiresCertificate: false });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/content`);
      assert.equal(res.status, 200);

      // Every item makePath uploads is wired into its one content course, so
      // each reports a single dependent course.
      const rows = res.body.data.data;
      assert.ok(rows.length >= 2);
      for (const row of rows) assert.equal(row.usedIn, 1);
    });
  });

  test('an unused content item reports zero rather than nothing', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    await AcademyContent.create({
      title: 'Orphan handbook',
      type: 'pdf',
      storageKey: 'academy/orphan.pdf',
      storageCategory: STORAGE_CATEGORIES.ACADEMY_CONTENT,
      mimeType: 'application/pdf',
      fileSize: 2048,
      active: true,
    });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/content`);
      const orphan = res.body.data.data.find((r) => r.title === 'Orphan handbook');
      assert.equal(orphan.usedIn, 0);
    });
  });

  test('the dashboard breaks completion down by department and lists recent activity', async () => {
    const { user: hr } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { path } = await makePath({ sequential: false, requiresCertificate: false });
    const { employee } = await makeEmployee();

    const department = await Department.create({ name: `Sales ${seq++}`, code: `SAL${seq}` });

    await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Asha Verma',
      departmentId: department._id,
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      status: 'completed',
      completedAt: new Date(),
      lessons: [],
    });

    await withServer(appFor(hr), async (url) => {
      const res = await get(url, `${P}/dashboard`);
      assert.equal(res.status, 200);

      const sales = res.body.data.byDepartment.find((d) => d.departmentId === department._id.toString());
      assert.equal(sales.assigned, 1);
      assert.equal(sales.completed, 1);
      assert.equal(sales.completionPercent, 100);
      assert.equal(sales.departmentName, department.name);

      const completion = res.body.data.recentActivity.find((a) => a.kind === 'completed');
      assert.equal(completion.employeeName, 'Asha Verma');
      assert.equal(completion.pathName, path.name);
    });
  });

  test('a failed attempt appears in the activity feed, named and scored', async () => {
    const { user: hr } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { path, courseTwo, assessment } = await makePath({
      sequential: false,
      requiresCertificate: false,
    });
    const { user, employee } = await makeEmployee();

    const assignment = await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Rohit Mehta',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [
        {
          courseId: courseTwo._id,
          lessonId: courseTwo.lessons[0]._id,
          title: 'Security Assessment',
          type: 'quiz',
          mandatory: true,
          status: 'not_started',
        },
      ],
    });

    // Answer nothing, so the attempt fails.
    await withServer(appFor(user), async (url) => {
      const res = await post(
        url,
        `${P}/assignments/${assignment._id}/lessons/${courseTwo.lessons[0]._id}/attempt`,
        {
          answers: assessment.questions.map((q) => ({
            questionId: q._id.toString(),
            selectedOptionIds: [],
          })),
        },
      );
      assert.equal(res.status, 201);
      assert.equal(res.body.data.passed, false);
    });

    await withServer(appFor(hr), async (url) => {
      const res = await get(url, `${P}/dashboard`);
      const failure = res.body.data.recentActivity.find((a) => a.kind === 'attempt');

      assert.equal(failure.employeeName, 'Rohit Mehta');
      assert.equal(failure.passed, false);
      assert.equal(failure.attemptNo, 1);
      assert.equal(failure.score, 0);
      // The lesson is NAMED - "failed an assessment" tells an administrator
      // nothing they can act on.
      assert.equal(failure.detail, 'Security Assessment');
    });
  });
});

// ===========================================================================
// The learning path catalogue
// ===========================================================================

describe('the learning path catalogue', () => {
  /** A path with no courses - started and never finished. */
  const emptyPath = (over = {}) =>
    LearningPath.create({
      name: `Empty ${seq++}`,
      dueDateMode: 'none',
      mandatory: true,
      active: true,
      ...over,
    });

  test('a path with no courses is a DRAFT, not an active one', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    await emptyPath({ name: 'Half-written path' });
    await makePath({ sequential: false, requiresCertificate: false });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/paths`);
      assert.equal(res.status, 200);

      const draft = res.body.data.data.find((p) => p.name === 'Half-written path');
      assert.equal(draft.status, 'draft');
      assert.equal(draft.courseCount, 0);

      // The one that actually has courses is active.
      const real = res.body.data.data.find((p) => p.courseCount > 0);
      assert.equal(real.status, 'active');
    });
  });

  test('a deactivated path is ARCHIVED even though it has courses', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { path } = await makePath({ sequential: false, requiresCertificate: false });
    await LearningPath.updateOne({ _id: path._id }, { $set: { active: false } });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/paths`);
      const row = res.body.data.data.find((p) => p.id === path._id.toString());
      assert.equal(row.status, 'archived');
      assert.ok(row.courseCount > 0, 'archived because it is inactive, not because it is empty');
    });
  });

  /**
   * The derivation exists twice - once in JavaScript for single-row callers and
   * once in aggregation operators so the list can FILTER on it. Two copies of a
   * rule is how a filter and a badge come to disagree, so they are asserted
   * against each other over every combination that matters.
   */
  test('the aggregated status and derivePathStatus agree on every case', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    await emptyPath({ name: 'Empty and active' });
    await emptyPath({ name: 'Empty and inactive', active: false });
    const { path } = await makePath({ sequential: false, requiresCertificate: false });

    // The fourth case: inactive AND non-empty, which must read "archived"
    // rather than "draft".
    const retired = await emptyPath({ name: 'Retired but full', active: false });
    await AcademyCourse.create({ pathId: retired._id, name: 'Old module', order: 0, lessons: [] });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/paths?pageSize=50`);
      assert.equal(res.body.data.data.length, 4);

      for (const row of res.body.data.data) {
        assert.equal(
          row.status,
          derivePathStatus({ active: row.active }, row.courseCount),
          `${row.name} disagrees`,
        );
      }

      // And the four cases really were all present.
      const byName = Object.fromEntries(res.body.data.data.map((r) => [r.name, r.status]));
      assert.equal(byName['Empty and active'], 'draft');
      assert.equal(byName['Empty and inactive'], 'archived');
      assert.equal(byName['Retired but full'], 'archived');
      assert.equal(byName[path.name], 'active');
    });
  });

  /**
   * The bug this shape exists to prevent: filtering a page in memory leaves
   * `total` counting the unfiltered set, so the pager offers pages that are not
   * there.
   */
  test('filtering by status narrows the TOTAL, not just the visible page', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    await emptyPath();
    await emptyPath();
    await makePath({ sequential: false, requiresCertificate: false });

    await withServer(appFor(user), async (url) => {
      const all = await get(url, `${P}/paths`);
      assert.equal(all.body.data.total, 3);

      const drafts = await get(url, `${P}/paths?status=draft`);
      assert.equal(drafts.body.data.total, 2);
      assert.equal(drafts.body.data.data.length, 2);
      assert.ok(drafts.body.data.data.every((p) => p.status === 'draft'));
    });
  });

  test('the tiles count what the search matched, before the status filter', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    await emptyPath({ name: 'Zebra draft' });
    await makePath({ sequential: false, requiresCertificate: false });

    await withServer(appFor(user), async (url) => {
      const all = await get(url, `${P}/paths`);
      assert.equal(all.body.data.summary.total, 2);
      assert.equal(all.body.data.summary.draft, 1);
      assert.equal(all.body.data.summary.active, 1);

      // Filtering BY status leaves the other tiles standing, so they stay
      // usable as controls.
      const filtered = await get(url, `${P}/paths?status=draft`);
      assert.equal(filtered.body.data.summary.active, 1);
      assert.equal(filtered.body.data.total, 1);

      // Searching narrows them all together.
      const searched = await get(url, `${P}/paths?search=Zebra`);
      assert.equal(searched.body.data.summary.total, 1);
      assert.equal(searched.body.data.summary.active, 0);
    });
  });

  test('a path counts its lessons and its assessments, not only its courses', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { path } = await makePath({ sequential: false, requiresCertificate: false });

    await withServer(appFor(user), async (url) => {
      const res = await get(url, `${P}/paths`);
      const row = res.body.data.data.find((p) => p.id === path._id.toString());

      assert.equal(row.courseCount, 2);
      // Two content lessons in the first course, one quiz in the second.
      assert.equal(row.lessonCount, 3);
      assert.equal(row.assessmentCount, 1);
    });
  });

  test('tags are stored, returned and filterable', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(user), async (url) => {
      const created = await post(url, `${P}/paths`, {
        name: 'Compliance refresher',
        dueDateMode: 'none',
        tags: ['Compliance', 'Mandatory'],
      });
      assert.equal(created.status, 201);
      assert.deepEqual(created.body.data.tags, ['Compliance', 'Mandatory']);

      await post(url, `${P}/paths`, { name: 'Sales basics', dueDateMode: 'none', tags: ['Sales'] });

      const filtered = await get(url, `${P}/paths?tag=Compliance`);
      assert.equal(filtered.body.data.total, 1);
      assert.equal(filtered.body.data.data[0].name, 'Compliance refresher');

      // Search reaches tags too - people type the subject, not the title.
      const searched = await get(url, `${P}/paths?search=sales`);
      assert.equal(searched.body.data.total, 1);
      assert.equal(searched.body.data.data[0].name, 'Sales basics');
    });
  });

  test('sorting by name and by assigned volume both work', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });
    const { path } = await makePath({ sequential: false, requiresCertificate: false });
    await emptyPath({ name: 'AAA first alphabetically' });

    const { employee } = await makeEmployee();
    await LearningAssignment.create({
      employeeId: employee._id,
      employeeName: 'Learner',
      pathId: path._id,
      pathName: path.name,
      source: 'manual',
      lessons: [],
    });

    await withServer(appFor(user), async (url) => {
      const byName = await get(url, `${P}/paths?sort=name`);
      assert.equal(byName.body.data.data[0].name, 'AAA first alphabetically');

      const byAssigned = await get(url, `${P}/paths?sort=assigned`);
      assert.equal(byAssigned.body.data.data[0].id, path._id.toString());
      assert.equal(byAssigned.body.data.data[0].assignedCount, 1);
    });
  });

  test('the detail panel names who created the path', async () => {
    const { user } = await makeEmployee({ roles: [R.HR_ADMIN] });

    await withServer(appFor(user), async (url) => {
      const created = await post(url, `${P}/paths`, {
        name: 'Authored path',
        dueDateMode: 'none',
      });
      const res = await get(url, `${P}/paths/${created.body.data.id}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.createdByName, user.user);
      assert.equal(res.body.data.status, 'draft'); // no courses yet
      assert.equal(res.body.data.lessonCount, 0);
      assert.equal(res.body.data.assessmentCount, 0);
    });
  });
});
