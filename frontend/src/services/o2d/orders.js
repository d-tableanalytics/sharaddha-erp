import { o2dClient } from "./client";
import {
  STAGE_STATUS,
  ORDER_STATUS,
  HOLD_REASONS,
  O2D_DOCUMENT_TYPES,
} from "@shared/constants/o2d.js";

/**
 * The O2D API, plus the label maps and formatters that go with it.
 *
 * Kept in one file the way every HRMS service is: a screen that renders a stage
 * status needs the word for it, and separating the two guarantees one is
 * updated without the other.
 *
 * The CONSTANTS are imported from `@shared/constants/o2d.js` — the same file the
 * server reads — rather than retyped. A status the backend can emit and the
 * frontend has never heard of renders as a raw enum string, which is ugly but
 * honest; a retyped copy would render the wrong word confidently.
 */

export const o2dApi = {
  // ── Tasks ───────────────────────────────────────────────────────────────
  myTasks: (params = {}) => o2dClient.get("/tasks", params),
  taskCounts: () => o2dClient.get("/tasks/counts"),

  /** The twelve stages, as configured. Owners can be changed by an admin. */
  stages: () => o2dClient.get("/stages"),

  /**
   * Live orders per stage, with the late count — the stage board (§27).
   *
   * Distinct from `stages()`: that one is the CONFIGURATION (names, owners,
   * SLAs) and this one is the CURRENT LOAD. They are fetched together by the
   * stage view, but a screen that only needs the names should not pay for the
   * aggregation.
   */
  stageBoard: () => o2dClient.get("/stages/board"),

  // ── Orders ──────────────────────────────────────────────────────────────
  list: (params = {}) => o2dClient.get("/orders", params),
  get: (id) => o2dClient.get(`/orders/${id}`),
  create: (dto) => o2dClient.post("/orders", dto),
  update: (id, dto) => o2dClient.patch(`/orders/${id}`, dto),
  history: (id) => o2dClient.get(`/orders/${id}/history`),

  /** The live duplicate check the intake form runs while the user types. */
  checkDuplicate: (poNumber, customerName) =>
    o2dClient.get("/orders/check-duplicate", { poNumber, customerName }),

  // ── Customer Portal bookings (§3) ───────────────────────────────────────
  //
  // A booking is addressed by its human-readable id (`BO-`/`SO-YYYY-######`),
  // not a Mongo id: one booking is several `Order` rows sharing that string, so
  // no single ObjectId names it. Encoded on the way out — the id is user data,
  // and a "/" in one would otherwise silently address a different route.
  bookings: (params = {}) => o2dClient.get("/bookings", params),
  booking: (bookingId) => o2dClient.get(`/bookings/${encodeURIComponent(bookingId)}`),

  // ── Lines ───────────────────────────────────────────────────────────────
  items: (id) => o2dClient.get(`/orders/${id}/items`),
  replaceItems: (id, items) => o2dClient.put(`/orders/${id}/items`, { items }),

  // ── Transitions ─────────────────────────────────────────────────────────
  completeStage: (id, stageNumber, dto = {}) =>
    o2dClient.post(`/orders/${id}/stages/${stageNumber}/complete`, dto),
  skipStage: (id, stageNumber, dto) =>
    o2dClient.post(`/orders/${id}/stages/${stageNumber}/skip`, dto),
  advanceDecision: (id, dto) => o2dClient.post(`/orders/${id}/advance-decision`, dto),

  hold: (id, dto) => o2dClient.post(`/orders/${id}/hold`, dto),
  resume: (id, dto = {}) => o2dClient.post(`/orders/${id}/resume`, dto),

  // ── Leaving the workflow ────────────────────────────────────────────────
  cancel: (id, dto) => o2dClient.post(`/orders/${id}/cancel`, dto),
  void: (id, dto) => o2dClient.post(`/orders/${id}/void`, dto),
  revive: (id, dto) => o2dClient.post(`/orders/${id}/revive`, dto),
  exitRegister: (params = {}) => o2dClient.get("/exit-register", params),
  exitsByStage: (params = {}) => o2dClient.get("/exit-register/by-stage", params),

  // ── Invoicing ───────────────────────────────────────────────────────────
  /** Raise the Zoho invoice for an order. Idempotent server-side. */
  createInvoice: (orderId) => o2dClient.post(`/orders/${orderId}/invoice`, {}),

  // ── Analytics ───────────────────────────────────────────────────────────
  analytics: (params = {}) => o2dClient.get("/analytics", params),
  slaCompliance: (params = {}) => o2dClient.get("/analytics/sla", params),
  delays: (params = {}) => o2dClient.get("/analytics/delays", params),
  people: (params = {}) => o2dClient.get("/analytics/people", params),
  customers: (params = {}) => o2dClient.get("/analytics/customers", params),
  /** Returns a Blob — see `download` in client.js for why not a plain link. */
  exportDataset: (dataset, params = {}) =>
    o2dClient.download(`/analytics/export/${dataset}`, params),

  // ── Notifications ───────────────────────────────────────────────────────
  notifications: (params = {}) => o2dClient.get("/notifications", params),
  /** No ids = mark everything unread as read. Scoped to the caller server-side. */
  markNotificationsRead: (ids = []) => o2dClient.post("/notifications/read", { ids }),

  // ── Documents ───────────────────────────────────────────────────────────
  documents: (id) => o2dClient.get(`/orders/${id}/documents`),
  uploadDocument: (id, formData) => o2dClient.upload(`/orders/${id}/documents`, formData),
  documentUrl: (documentId) => o2dClient.get(`/documents/${documentId}/url`),
  deleteDocument: (documentId) => o2dClient.delete(`/documents/${documentId}`),
};

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const STAGE_STATUS_LABELS = Object.freeze({
  [STAGE_STATUS.LOCKED]: "Locked",
  [STAGE_STATUS.PENDING]: "In progress",
  [STAGE_STATUS.DUE_SOON]: "Due soon",
  [STAGE_STATUS.OVERDUE]: "Overdue",
  [STAGE_STATUS.DONE_ON_TIME]: "Done on time",
  [STAGE_STATUS.DONE_LATE]: "Done late",
  [STAGE_STATUS.SKIPPED]: "Skipped",
  [STAGE_STATUS.ON_HOLD]: "On hold",
});

export const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.OPEN]: "Open",
  [ORDER_STATUS.ON_HOLD]: "On hold",
  [ORDER_STATUS.CLOSED]: "Closed",
  [ORDER_STATUS.CANCELLED]: "Cancelled",
  [ORDER_STATUS.VOID]: "Void",
});

/** The enum values are shouted; a person reading a screen should not be. */
export const HOLD_REASON_LABELS = Object.freeze({
  CUSTOMER_REQUEST: "Customer request",
  STOCK_UNAVAILABLE: "Stock unavailable",
  PAYMENT_PENDING: "Payment pending",
  DOCUMENTATION: "Documentation",
  OTHER: "Other",
});

export const DOCUMENT_TYPE_LABELS = Object.freeze({
  PO: "Customer PO",
  SOR: "Sales Order Report",
  PI: "Proforma Invoice",
  PAYMENT_PROOF: "Payment proof",
  INVOICE: "Tax invoice",
  AWB: "AWB",
  LR: "LR / Docket",
  DELIVERY_PROOF: "Delivery proof",
  OTHER: "Other",
});

export const HOLD_REASON_OPTIONS = HOLD_REASONS.map((value) => ({
  value,
  label: HOLD_REASON_LABELS[value] ?? value,
}));

export const DOCUMENT_TYPE_OPTIONS = O2D_DOCUMENT_TYPES.map((value) => ({
  value,
  label: DOCUMENT_TYPE_LABELS[value] ?? value,
}));

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * The tone for a stage chip.
 *
 * DONE_LATE is amber rather than green: the work IS finished, so red would
 * overstate it, but colouring it the same as on-time would erase the one fact
 * the SLA engine exists to record.
 */
export const stageTone = (status) => {
  switch (status) {
    case STAGE_STATUS.DONE_ON_TIME:
      return "success";
    case STAGE_STATUS.DONE_LATE:
      return "warning";
    case STAGE_STATUS.OVERDUE:
      return "danger";
    case STAGE_STATUS.DUE_SOON:
      return "warning";
    case STAGE_STATUS.SKIPPED:
      return "neutral";
    case STAGE_STATUS.ON_HOLD:
      return "neutral";
    case STAGE_STATUS.PENDING:
      // "primary", not "info": Badge implements primary | success | warning |
      // danger | neutral, and an unknown name renders a COLOURLESS pill rather
      // than throwing - see the note in HrmsStatusBadge.
      return "primary";
    default:
      return "neutral";
  }
};

export const bucketTone = (bucket) =>
  ({ overdue: "danger", due_soon: "warning", on_track: "primary" }[bucket] ?? "neutral");

export const BUCKET_LABELS = Object.freeze({
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
});

/**
 * A duration in working minutes, as a person would say it.
 *
 * Says "working" because that is what the number means — 12 working hours is
 * not half a day of wall-clock, and a screen that drops the word invites
 * somebody to compare it against a timestamp difference and file a bug.
 */
export function formatWorkingMinutes(minutes) {
  if (minutes == null) return "—";
  const m = Math.abs(Math.round(minutes));
  if (m === 0) return "on time";
  if (m < 60) return `${m} working min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${hours} working hr ${rest} min` : `${hours} working hr`;
}

/** "3 working hr late" / "on time" — the delay as the tracker shows it. */
export const formatDelay = (delayMinutes) =>
  !delayMinutes || delayMinutes <= 0 ? "On time" : `${formatWorkingMinutes(delayMinutes)} late`;

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  // Pinned, not left to the browser. The whole business runs on IST, and an
  // employee travelling must not see a different deadline from their colleague.
  timeZone: "Asia/Kolkata",
});

const DATE_ONLY = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export const formatDateTime = (value) => (value ? DATE_TIME.format(new Date(value)) : "—");
export const formatDate = (value) => (value ? DATE_ONLY.format(new Date(value)) : "—");

/**
 * "2 days late" / "in 3 hours" — how a promise date reads at a glance.
 *
 * Calendar time, deliberately, unlike the SLA figures above: a promise date is
 * what the customer was told, and the customer does not observe our working
 * hours.
 */
export function formatRelative(value, now = new Date()) {
  if (!value) return "—";
  const diffMs = new Date(value).getTime() - now.getTime();
  const past = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60000);

  let text;
  if (mins < 60) text = `${mins} min`;
  else if (mins < 1440) text = `${Math.round(mins / 60)} hr`;
  else text = `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"}`;

  return past ? `${text} ago` : `in ${text}`;
}

export default {
  o2dApi,
  STAGE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  HOLD_REASON_LABELS,
  HOLD_REASON_OPTIONS,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_OPTIONS,
  BUCKET_LABELS,
  stageTone,
  bucketTone,
  formatWorkingMinutes,
  formatDelay,
  formatDateTime,
  formatDate,
  formatRelative,
};
