import { hrmsClient } from "./client";
import { api } from "../api";

/**
 * SI Academy API.
 *
 * A thin wrapper over `hrmsClient`, which already unwraps the
 * `{ success, data }` envelope and normalises errors into `HrmsApiError` — so a
 * screen branches on `err.code`, never on a message.
 */

// ---------------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------------

export const myLearningApi = {
  /** The caller's own learning. No id is sent — the server takes it from the session. */
  get: () => hrmsClient.get("/academy/my-learning"),
};

export const assignmentsApi = {
  list: (params = {}) => hrmsClient.get("/academy/assignments", params),
  get: (id) => hrmsClient.get(`/academy/assignments/${id}`),
  create: (dto) => hrmsClient.post("/academy/assignments", dto),
  cancel: (id, reason) =>
    hrmsClient.post(`/academy/assignments/${id}/cancel`, reason ? { reason } : {}),
  /** Re-issue a certificate for a completed assignment whose generation failed. */
  issueCertificate: (id) => hrmsClient.post(`/academy/assignments/${id}/certificate`, {}),

  /**
   * A video heartbeat.
   *
   * Sends a bounded DELTA, never a running total — the server clamps it against
   * wall-clock elapsed and decides completion itself. See the note on
   * `useVideoProgress`.
   */
  videoProgress: (assignmentId, lessonId, body) =>
    hrmsClient.post(
      `/academy/assignments/${assignmentId}/lessons/${lessonId}/video-progress`,
      body,
    ),

  completeLesson: (assignmentId, lessonId) =>
    hrmsClient.post(`/academy/assignments/${assignmentId}/lessons/${lessonId}/complete`, {
      acknowledged: true,
    }),

  /** The questions, WITHOUT their answers. The server strips them. */
  startAttempt: (assignmentId, lessonId) =>
    hrmsClient.get(`/academy/assignments/${assignmentId}/lessons/${lessonId}/attempt`),

  submitAttempt: (assignmentId, lessonId, answers) =>
    hrmsClient.post(`/academy/assignments/${assignmentId}/lessons/${lessonId}/attempt`, {
      answers,
    }),

  /**
   * A short-lived presigned URL for a lesson's material.
   *
   * Fetched ON DEMAND, when somebody actually opens a lesson — never eagerly
   * for a whole course. Every issued URL is audited as a content view, so
   * prefetching a course would file reads nobody performed.
   */
  contentUrl: (assignmentId, lessonId) =>
    hrmsClient.get(`/academy/assignments/${assignmentId}/lessons/${lessonId}/content-url`),
};

export const certificatesApi = {
  list: (params = {}) => hrmsClient.get("/academy/certificates", params),
  /** The caller's own. No id on the wire. */
  mine: () => hrmsClient.get("/academy/certificates/mine"),
  documentUrl: (id) => hrmsClient.get(`/academy/certificates/${id}/document-url`),
  revoke: (id, reason) =>
    hrmsClient.post(`/academy/certificates/${id}/revoke`, reason ? { reason } : {}),
};

// ---------------------------------------------------------------------------
// Catalogue (admin)
// ---------------------------------------------------------------------------

export const pathsApi = {
  list: (params = {}) => hrmsClient.get("/academy/paths", params),
  get: (id) => hrmsClient.get(`/academy/paths/${id}`),
  create: (dto) => hrmsClient.post("/academy/paths", dto),
  update: (id, dto) => hrmsClient.patch(`/academy/paths/${id}`, dto),
  remove: (id) => hrmsClient.delete(`/academy/paths/${id}`),
  /** The COMPLETE list of course ids in their new order; partials are refused. */
  reorderCourses: (id, courseIds) =>
    hrmsClient.patch(`/academy/paths/${id}/courses/reorder`, { courseIds }),
};

export const coursesApi = {
  get: (id) => hrmsClient.get(`/academy/courses/${id}`),
  create: (dto) => hrmsClient.post("/academy/courses", dto),
  update: (id, dto) => hrmsClient.patch(`/academy/courses/${id}`, dto),
  remove: (id) => hrmsClient.delete(`/academy/courses/${id}`),
  addLesson: (courseId, dto) => hrmsClient.post(`/academy/courses/${courseId}/lessons`, dto),
  updateLesson: (courseId, lessonId, dto) =>
    hrmsClient.patch(`/academy/courses/${courseId}/lessons/${lessonId}`, dto),
  reorderLessons: (courseId, lessonIds) =>
    hrmsClient.patch(`/academy/courses/${courseId}/lessons/reorder`, { lessonIds }),
  removeLesson: (courseId, lessonId) =>
    hrmsClient.delete(`/academy/courses/${courseId}/lessons/${lessonId}`),
};

export const contentApi = {
  list: (params = {}) => hrmsClient.get("/academy/content", params),
  get: (id) => hrmsClient.get(`/academy/content/${id}`),
  update: (id, dto) => hrmsClient.patch(`/academy/content/${id}`, dto),
  /** Refused server-side while any lesson still points at the item. */
  remove: (id) => hrmsClient.delete(`/academy/content/${id}`),
};

export const academyAssessmentsApi = {
  list: (params = {}) => hrmsClient.get("/academy/assessments", params),
  get: (id) => hrmsClient.get(`/academy/assessments/${id}`),
  create: (dto) => hrmsClient.post("/academy/assessments", dto),
  update: (id, dto) => hrmsClient.patch(`/academy/assessments/${id}`, dto),
  remove: (id) => hrmsClient.delete(`/academy/assessments/${id}`),
};

export const rulesApi = {
  list: (params = {}) => hrmsClient.get("/academy/rules", params),
  create: (dto) => hrmsClient.post("/academy/rules", dto),
  update: (id, dto) => hrmsClient.patch(`/academy/rules/${id}`, dto),
  remove: (id) => hrmsClient.delete(`/academy/rules/${id}`),
  /** How many employees this rule matches, without assigning anything. */
  preview: (id) => hrmsClient.get(`/academy/rules/${id}/preview`),
  run: (id) => hrmsClient.post(`/academy/rules/${id}/run`, {}),
};

export const academyReportsApi = {
  dashboard: () => hrmsClient.get("/academy/dashboard"),
  pathCompletion: (params = {}) => hrmsClient.get("/academy/reports/path-completion", params),
  employeeStatus: (params = {}) => hrmsClient.get("/academy/reports/employee-status", params),
  employeeRecord: (employeeId) => hrmsClient.get(`/academy/employees/${employeeId}/record`),
};

/**
 * Upload a content item.
 *
 * Multipart, so it bypasses `hrmsClient` (which sends JSON) and goes through
 * the shared axios instance directly — exactly as `uploadDocument` and
 * `uploadResume` do. The Content-Type header is deliberately NOT set: the
 * browser has to add the multipart boundary itself.
 *
 * `onProgress` is wired because these are the largest uploads in the product —
 * a training video with no progress bar looks like a frozen page.
 */
export async function uploadContent(file, meta, onProgress) {
  const form = new FormData();
  form.append("file", file);
  form.append("title", meta.title);
  form.append("type", meta.type);
  if (meta.description) form.append("description", meta.description);
  if (meta.durationSeconds != null) form.append("durationSeconds", String(meta.durationSeconds));
  (meta.tags ?? []).forEach((tag) => form.append("tags", tag));

  const res = await api.post("/hrms/academy/content", form, {
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    },
  });
  return res.data?.data;
}

/**
 * Read a video file's duration in the browser, before uploading it.
 *
 * The server has no media parser, so this is the only place the length can be
 * discovered — and the schema refuses a video without one, because a video with
 * no duration can never have its completion measured.
 *
 * Safe to trust: the duration is only ever the DENOMINATOR of a ratio whose
 * numerator the server accumulates itself, so overstating it makes a video
 * harder to complete rather than easier.
 */
export function readVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.round(video.duration) : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Status tones, mapped to the Badge variants the rest of the ERP uses.
 *
 * `overdue` is here even though it is not a stored status — the server computes
 * it into `dueState` and the UI treats it as one, because to a user it is one.
 */
export const ASSIGNMENT_STATUS_TONES = Object.freeze({
  assigned: "neutral",
  in_progress: "primary",
  completed: "success",
  cancelled: "neutral",
});

export const DUE_STATE_TONES = Object.freeze({
  none: "neutral",
  upcoming: "neutral",
  due_soon: "warning",
  overdue: "danger",
  completed: "success",
});

export const LESSON_STATUS_TONES = Object.freeze({
  not_started: "neutral",
  in_progress: "primary",
  completed: "success",
});

export const CONTENT_TYPE_LABELS = Object.freeze({
  video: "Video",
  pdf: "PDF",
  document: "Document",
  quiz: "Quiz",
});

/** `1h 24m`, `8m 30s`, `45s` — never `84.6 minutes`. */
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${rest}s`;
  return `${rest}s`;
}

/** File sizes, for the content library. */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * `YYYY-MM-DD` to `16 Sep 2026`.
 *
 * Matches the date style the rest of HRMS renders, and built from parts rather
 * than `toLocaleDateString` so it does not depend on the browser's locale — the
 * same reasoning the server's letter renderers record.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return "—";
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

export function formatInstant(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDay(d.toISOString().slice(0, 10))}, ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export default {
  myLearningApi,
  assignmentsApi,
  certificatesApi,
  pathsApi,
  coursesApi,
  contentApi,
  academyAssessmentsApi,
  rulesApi,
  academyReportsApi,
  uploadContent,
  readVideoDuration,
};
