/**
 * SI Academy routes, mounted at /api/v1/hrms/academy.
 *
 * The parent HRMS router has already applied protect -> attachHrmsActor ->
 * requireHrmsAccess, so everything here is authenticated and holds some HRMS
 * grant. Each route adds its own permission at its own scope.
 *
 * ---------------------------------------------------------------------------
 * Three gates, and the line each one draws
 * ---------------------------------------------------------------------------
 *   canLearn      academy:view:self    every employee. Their own learning.
 *   canAssign     academy:assign:org   HR. Assigning, and the rule engine.
 *   canManage     academy:edit:org     HR. Authoring the catalogue.
 *
 * `canLearn` is the WIDEST gate and appears on routes that can address another
 * person's record - which is exactly the trap `has-permission.js` documents on
 * `isSelf`: a self-scope check with no resource passes. Those routes are safe
 * because the SERVICE re-checks against the loaded row
 * (`assertCanViewAssignment`, `assertIsLearner`), never because the middleware
 * decided it. The middleware here keeps out accounts with no academy grant at
 * all; the service decides whose record you may touch.
 *
 * Collection reads carry no resource check for the same reason the documents
 * module's do not: the SERVICE narrows the query by scope, so the result set
 * and the pagination total are already what the caller may see.
 */

import express from 'express';

import { requirePermission } from '../../../middlewares/hrmsAuth.js';
import { validate } from '../../../middlewares/validate.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from '../../../shared/permissions/constants.js';
import {
  uploadContentSchema,
  updateContentSchema,
  contentListQuerySchema,
  createPathSchema,
  updatePathSchema,
  pathListQuerySchema,
  createCourseSchema,
  updateCourseSchema,
  reorderCoursesSchema,
  createLessonSchema,
  updateLessonSchema,
  reorderLessonsSchema,
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
} from '../../../shared/schemas/academy.js';
import * as controller from './academy.controller.js';
import { uploadAcademyFile, handleAcademyUploadErrors } from './contentUpload.js';

const router = express.Router();

/** Every employee, through the self-service baseline. */
const canLearn = requirePermission({ module: M.ACADEMY, action: A.VIEW, scope: S.SELF });

/** Recording progress on one's OWN learning. Separated from VIEW deliberately. */
const canSubmit = requirePermission({ module: M.ACADEMY, action: A.SUBMIT, scope: S.SELF });

/** HR: authoring the catalogue. */
const canManage = requirePermission({ module: M.ACADEMY, action: A.EDIT, scope: S.ORG });

/** HR: assigning, and the rule engine. */
const canAssign = requirePermission({ module: M.ACADEMY, action: A.ASSIGN, scope: S.ORG });

/**
 * Seeing somebody else's progress: a manager for their reports, HR for anyone.
 * ANY-OF, so one route serves both - the shape the guard is built for.
 */
const canViewOthers = requirePermission(
  { module: M.ACADEMY, action: A.VIEW, scope: S.TEAM },
  { module: M.ACADEMY, action: A.VIEW, scope: S.ORG },
);

// ---------------------------------------------------------------------------
// The learner's own surface. Declared FIRST so `my-learning` and `certificates`
// are never read as an id by the `/:id` families below.
// ---------------------------------------------------------------------------

router.get('/my-learning', canLearn, controller.myLearning);
router.get('/certificates/mine', canLearn, controller.myCertificates);

// ---------------------------------------------------------------------------
// Dashboard and reports
// ---------------------------------------------------------------------------

router.get('/dashboard', canViewOthers, controller.dashboard);
router.get(
  '/reports/path-completion',
  canViewOthers,
  validate({ query: academyReportQuerySchema }),
  controller.pathCompletionReport,
);
router.get(
  '/reports/employee-status',
  canViewOthers,
  validate({ query: academyReportQuerySchema }),
  controller.employeeStatusReport,
);

/**
 * One employee's Academy record, for the employee profile page.
 *
 * `canLearn` rather than `canViewOthers`, because an employee opening their OWN
 * profile must reach it. The service re-checks against the loaded employee, so
 * a self-scope actor asking for somebody else's id gets a 403 there.
 */
router.get('/employees/:employeeId/record', canLearn, controller.employeeRecord);

// ---------------------------------------------------------------------------
// Content library. HR only - a learner never browses it, they reach material
// through a lesson in a path assigned to them.
// ---------------------------------------------------------------------------

router.get(
  '/content',
  canManage,
  validate({ query: contentListQuerySchema }),
  controller.listContent,
);
/**
 * Upload. `validate` runs AFTER multer, because the body fields do not exist
 * until the multipart stream has been parsed.
 */
router.post(
  '/content',
  canManage,
  uploadAcademyFile,
  handleAcademyUploadErrors,
  validate({ body: uploadContentSchema }),
  controller.uploadContent,
);
router.get('/content/:id', canManage, controller.getContent);
router.patch(
  '/content/:id',
  canManage,
  validate({ body: updateContentSchema }),
  controller.updateContent,
);
router.delete('/content/:id', canManage, controller.deleteContent);

// ---------------------------------------------------------------------------
// Assessments. Reads are HR-only: every one of these returns the ANSWER KEY.
// A learner reaches an assessment only through `/assignments/.../attempt`,
// which returns the stripped `toLearnerDto`.
// ---------------------------------------------------------------------------

router.get('/assessments', canManage, controller.listAssessments);
router.post(
  '/assessments',
  canManage,
  validate({ body: createAssessmentSchema }),
  controller.createAssessment,
);
router.get('/assessments/:id', canManage, controller.getAssessment);
router.patch(
  '/assessments/:id',
  canManage,
  validate({ body: updateAssessmentSchema }),
  controller.updateAssessment,
);
router.delete('/assessments/:id', canManage, controller.deleteAssessment);

// ---------------------------------------------------------------------------
// Assignment rules
// ---------------------------------------------------------------------------

router.get('/rules', canAssign, controller.listRules);
router.post('/rules', canAssign, validate({ body: createRuleSchema }), controller.createRule);
router.get('/rules/:id/preview', canAssign, controller.previewRule);
router.post('/rules/:id/run', canAssign, controller.runRule);
router.patch('/rules/:id', canAssign, validate({ body: updateRuleSchema }), controller.updateRule);
router.delete('/rules/:id', canAssign, controller.deleteRule);

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

router.get(
  '/assignments',
  canLearn,
  validate({ query: assignmentListQuerySchema }),
  controller.listAssignments,
);
router.post(
  '/assignments',
  canAssign,
  validate({ body: createAssignmentSchema }),
  controller.createAssignments,
);

/**
 * Nested lesson routes, before the bare `/assignments/:id`.
 *
 * All three writes are gated on `canSubmit` and then re-checked by
 * `assertIsLearner` in the service - which refuses even an HR admin holding
 * `academy:view:org`. Section 26: nobody completes a lesson on somebody else's
 * behalf, and a wider-satisfies-narrower check would have quietly allowed it.
 */
router.post(
  '/assignments/:id/lessons/:lessonId/video-progress',
  canSubmit,
  validate({ body: videoProgressSchema }),
  controller.recordVideoProgress,
);
router.post(
  '/assignments/:id/lessons/:lessonId/complete',
  canSubmit,
  validate({ body: completeLessonSchema }),
  controller.completeLesson,
);
router.get(
  '/assignments/:id/lessons/:lessonId/attempt',
  canSubmit,
  controller.startAttempt,
);
router.post(
  '/assignments/:id/lessons/:lessonId/attempt',
  canSubmit,
  validate({ body: submitAttemptSchema }),
  controller.submitAttempt,
);

/** A presigned URL for the lesson's material. Readable by anyone who may view
 *  the assignment, so a manager reviewing progress can see what was required. */
router.get(
  '/assignments/:id/lessons/:lessonId/content-url',
  canLearn,
  controller.lessonContentUrl,
);

router.post(
  '/assignments/:id/cancel',
  canAssign,
  validate({ body: cancelAssignmentSchema }),
  controller.cancelAssignment,
);
router.post('/assignments/:id/certificate', canManage, controller.reissueCertificate);
router.get('/assignments/:id', canLearn, controller.getAssignment);

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

router.get('/certificates', canLearn, controller.listCertificates);
router.get('/certificates/:id/document-url', canLearn, controller.certificateUrl);
router.post('/certificates/:id/revoke', canManage, controller.revokeCertificate);

// ---------------------------------------------------------------------------
// Courses and lessons. Declared BEFORE the `/paths` family only because they
// live at their own prefix; order between the two groups does not matter.
// ---------------------------------------------------------------------------

router.post('/courses', canManage, validate({ body: createCourseSchema }), controller.createCourse);
router.post(
  '/courses/:id/lessons',
  canManage,
  validate({ body: createLessonSchema }),
  controller.addLesson,
);
router.patch(
  '/courses/:id/lessons/reorder',
  canManage,
  validate({ body: reorderLessonsSchema }),
  controller.reorderLessons,
);
router.patch(
  '/courses/:id/lessons/:lessonId',
  canManage,
  validate({ body: updateLessonSchema }),
  controller.updateLesson,
);
router.delete('/courses/:id/lessons/:lessonId', canManage, controller.deleteLesson);
router.patch(
  '/courses/:id',
  canManage,
  validate({ body: updateCourseSchema }),
  controller.updateCourse,
);
router.delete('/courses/:id', canManage, controller.deleteCourse);
/** Readable by a learner: this is the course they are working through. */
router.get('/courses/:id', canLearn, controller.getCourse);

// ---------------------------------------------------------------------------
// Learning paths
// ---------------------------------------------------------------------------

router.get('/paths', canLearn, validate({ query: pathListQuerySchema }), controller.listPaths);
router.post('/paths', canManage, validate({ body: createPathSchema }), controller.createPath);
router.patch(
  '/paths/:id/courses/reorder',
  canManage,
  validate({ body: reorderCoursesSchema }),
  controller.reorderCourses,
);
router.patch('/paths/:id', canManage, validate({ body: updatePathSchema }), controller.updatePath);
router.delete('/paths/:id', canManage, controller.deletePath);
router.get('/paths/:id', canLearn, controller.getPath);

export default router;
