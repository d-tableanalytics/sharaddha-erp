/**
 * SI Academy HTTP handlers.
 *
 * Every response is `{ success: true, data }` - the envelope every HRMS
 * controller uses and a test enforces across all of them.
 *
 * Thin by design: these unwrap the request and call a service. Every
 * authorisation decision, every validation and every piece of business logic
 * lives in the services, so a second caller (the employee-creation hook, a
 * script, a test) gets identical behaviour without going through Express.
 */

import * as content from './content.service.js';
import * as catalogue from './catalogue.service.js';
import * as assessments from './assessment.service.js';
import * as assignments from './assignment.service.js';
import * as rules from './rule.service.js';
import * as certificates from './certificate.service.js';
import * as reports from './report.service.js';
import { issueReadUrl } from '../storage/storage.service.js';

const context = (req) => ({ user: req.user, req });

/** Wrap a handler so every one of them reports errors the same way. */
const handler = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

// ---- content library ------------------------------------------------------

export const listContent = handler((req) => content.listContent(req.hrmsActor, req.query));
export const getContent = handler((req) => content.getContent(req.params.id, req.hrmsActor));
export const uploadContent = handler(
  (req) => content.uploadContent(req.file, req.body, req.hrmsActor, context(req)),
  201,
);
export const updateContent = handler((req) =>
  content.updateContent(req.params.id, req.body, req.hrmsActor, context(req)),
);
export const deleteContent = handler((req) =>
  content.deleteContent(req.params.id, req.hrmsActor, context(req)),
);

// ---- learning paths -------------------------------------------------------

export const listPaths = handler((req) => catalogue.listPaths(req.hrmsActor, req.query));
export const getPath = handler((req) => catalogue.getPath(req.params.id, req.hrmsActor));
export const createPath = handler(
  (req) => catalogue.createPath(req.body, req.hrmsActor, context(req)),
  201,
);
export const updatePath = handler((req) =>
  catalogue.updatePath(req.params.id, req.body, req.hrmsActor, context(req)),
);
export const deletePath = handler((req) =>
  catalogue.deletePath(req.params.id, req.hrmsActor, context(req)),
);
export const reorderCourses = handler((req) =>
  catalogue.reorderCourses(req.params.id, req.body, req.hrmsActor, context(req)),
);

// ---- courses --------------------------------------------------------------

export const getCourse = handler((req) => catalogue.getCourse(req.params.id, req.hrmsActor));
export const createCourse = handler(
  (req) => catalogue.createCourse(req.body, req.hrmsActor, context(req)),
  201,
);
export const updateCourse = handler((req) =>
  catalogue.updateCourse(req.params.id, req.body, req.hrmsActor, context(req)),
);
export const deleteCourse = handler((req) =>
  catalogue.deleteCourse(req.params.id, req.hrmsActor, context(req)),
);

// ---- lessons --------------------------------------------------------------

export const addLesson = handler(
  (req) => catalogue.addLesson(req.params.id, req.body, req.hrmsActor, context(req)),
  201,
);
export const updateLesson = handler((req) =>
  catalogue.updateLesson(req.params.id, req.params.lessonId, req.body, req.hrmsActor, context(req)),
);
export const reorderLessons = handler((req) =>
  catalogue.reorderLessons(req.params.id, req.body, req.hrmsActor, context(req)),
);
export const deleteLesson = handler((req) =>
  catalogue.deleteLesson(req.params.id, req.params.lessonId, req.hrmsActor, context(req)),
);

// ---- assessments ----------------------------------------------------------

export const listAssessments = handler((req) =>
  assessments.listAssessments(req.hrmsActor, req.query),
);
export const getAssessment = handler((req) =>
  assessments.getAssessment(req.params.id, req.hrmsActor),
);
export const createAssessment = handler(
  (req) => assessments.createAssessment(req.body, req.hrmsActor, context(req)),
  201,
);
export const updateAssessment = handler((req) =>
  assessments.updateAssessment(req.params.id, req.body, req.hrmsActor, context(req)),
);
export const deleteAssessment = handler((req) =>
  assessments.deleteAssessment(req.params.id, req.hrmsActor, context(req)),
);

// ---- assignments ----------------------------------------------------------

export const listAssignments = handler((req) =>
  assignments.listAssignments(req.hrmsActor, req.query),
);
export const createAssignments = handler(
  (req) => assignments.createAssignments(req.body, req.hrmsActor, context(req)),
  201,
);
export const getAssignment = handler((req) =>
  assignments.getAssignment(req.params.id, req.hrmsActor),
);
export const cancelAssignment = handler((req) =>
  assignments.cancelAssignment(req.params.id, req.body, req.hrmsActor, context(req)),
);

/**
 * GET /academy/my-learning
 *
 * No id on the wire. The employee comes from the session - the shape
 * `documents/me` and `onboarding/checklists/mine` use, and the reason there is
 * no parameter here to tamper with.
 */
export const myLearning = handler((req) => assignments.myLearning(req.hrmsActor));

// ---- learner progress -----------------------------------------------------

export const recordVideoProgress = handler((req) =>
  assignments.recordVideoProgress(
    req.params.id,
    req.params.lessonId,
    req.body,
    req.hrmsActor,
    context(req),
  ),
);
export const completeLesson = handler((req) =>
  assignments.completeLesson(
    req.params.id,
    req.params.lessonId,
    req.body,
    req.hrmsActor,
    context(req),
  ),
);
export const startAttempt = handler((req) =>
  assignments.startAttempt(req.params.id, req.params.lessonId, req.hrmsActor),
);
export const submitAttempt = handler(
  (req) =>
    assignments.submitAttempt(
      req.params.id,
      req.params.lessonId,
      req.body,
      req.hrmsActor,
      context(req),
    ),
  201,
);

/**
 * GET /academy/assignments/:id/lessons/:lessonId/content-url
 *
 * A presigned URL, not the bytes and not the key.
 *
 * Authorised TWICE on purpose, exactly as the documents module does: once
 * against the assignment and the lesson (`lessonContentUrl`), and again by the
 * storage rule against the object itself. The first is the check that knows who
 * was assigned what; the second is the fence that holds even if a future caller
 * forgets the first.
 */
export const lessonContentUrl = handler(async (req) => {
  const { key, category, name, mimeType } = await assignments.lessonContentUrl(
    req.params.id,
    req.params.lessonId,
    req.hrmsActor,
  );
  const link = await issueReadUrl({ category, key, actor: req.hrmsActor, req });
  return { ...link, name, mimeType };
});

// ---- rules ----------------------------------------------------------------

export const listRules = handler((req) => rules.listRules(req.hrmsActor, req.query));
export const createRule = handler(
  (req) => rules.createRule(req.body, req.hrmsActor, context(req)),
  201,
);
export const updateRule = handler((req) =>
  rules.updateRule(req.params.id, req.body, req.hrmsActor, context(req)),
);
export const deleteRule = handler((req) =>
  rules.deleteRule(req.params.id, req.hrmsActor, context(req)),
);
export const previewRule = handler((req) => rules.previewRule(req.params.id, req.hrmsActor));
export const runRule = handler((req) => rules.runRule(req.params.id, req.hrmsActor, context(req)));

// ---- certificates ---------------------------------------------------------

export const listCertificates = handler((req) =>
  certificates.listCertificates(req.hrmsActor, req.query),
);
export const myCertificates = handler((req) => certificates.myCertificates(req.hrmsActor));
export const revokeCertificate = handler((req) =>
  certificates.revokeCertificate(req.params.id, req.body?.reason, req.hrmsActor, context(req)),
);
export const reissueCertificate = handler(
  (req) => certificates.reissueForAssignment(req.params.id, req.hrmsActor, context(req)),
  201,
);

/** GET /academy/certificates/:id/document-url — fetched on demand, and audited. */
export const certificateUrl = handler(async (req) => {
  const { key, category, name } = await certificates.certificateStorageKey(
    req.params.id,
    req.hrmsActor,
  );
  const link = await issueReadUrl({ category, key, actor: req.hrmsActor, req });
  return { ...link, name };
});

// ---- dashboard and reports ------------------------------------------------

export const dashboard = handler((req) => reports.academyDashboard(req.hrmsActor));
export const pathCompletionReport = handler((req) =>
  reports.pathCompletionReport(req.hrmsActor, req.query, context(req)),
);
export const employeeStatusReport = handler((req) =>
  reports.employeeStatusReport(req.hrmsActor, req.query, context(req)),
);
export const employeeRecord = handler((req) =>
  reports.employeeAcademyRecord(req.params.employeeId, req.hrmsActor),
);

export default {
  listContent,
  getContent,
  uploadContent,
  updateContent,
  deleteContent,
  listPaths,
  getPath,
  createPath,
  updatePath,
  deletePath,
  reorderCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  addLesson,
  updateLesson,
  reorderLessons,
  deleteLesson,
  listAssessments,
  getAssessment,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  listAssignments,
  createAssignments,
  getAssignment,
  cancelAssignment,
  myLearning,
  recordVideoProgress,
  completeLesson,
  startAttempt,
  submitAttempt,
  lessonContentUrl,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  previewRule,
  runRule,
  listCertificates,
  myCertificates,
  revokeCertificate,
  reissueCertificate,
  certificateUrl,
  dashboard,
  pathCompletionReport,
  employeeStatusReport,
  employeeRecord,
};
