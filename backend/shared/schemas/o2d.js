/**
 * O2D validation schemas (AD-6).
 *
 * Imported by the Express validator AND by the React forms, so an intake rule
 * cannot say one thing in the browser and another at the API.
 *
 * ---------------------------------------------------------------------------
 * WHERE VALIDATION STOPS AND THE SERVICE BEGINS
 * ---------------------------------------------------------------------------
 *
 * These schemas check SHAPE — is this a date, is this a non-empty PO number, is
 * this quantity a number that is not negative. They deliberately do not check
 * the business rules, because every one of those needs the database:
 *
 *   duplicate PO (§26)        needs the other orders for that customer
 *   promise date override     needs to know who the actor is
 *   stage ownership (§37)     needs the stage master, which an admin edits
 *
 * A rule enforced here as well as in the service would be a second copy that
 * drifts. So the boundary is: zod refuses nonsense, the service refuses the
 * business-invalid, and only the service's answer is authoritative.
 */

import { z } from 'zod';

import { objectId, isoDateTime } from '../validation/common.js';
import {
  STAGE_NUMBERS,
  HOLD_REASONS,
  O2D_DOCUMENT_TYPES,
  ORDER_STATUS_LIST,
  STAGE_STATUS_LIST,
  EXIT_TYPES,
} from '../constants/o2d.js';

/**
 * A list in a query string, however the caller chose to send it.
 *
 * BOTH serialisations are accepted, because both arrive in practice:
 *
 *   ?status=OPEN,ON_HOLD          a comma-separated string
 *   ?status[]=OPEN&status[]=...   what axios sends for an array, which Express
 *                                 hands us as a real array
 *
 * Accepting only the first is a trap that fires the moment any caller passes an
 * array rather than a hand-built string — the request 400s with a message about
 * expected values, which points at the VALUES rather than at the shape, and
 * sends the reader looking in the wrong place entirely.
 */
const csvEnum = (values) =>
  z.union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : String(v).split(','))
      .map((x) => String(x).trim())
      .filter(Boolean))
    .refine((arr) => arr.every((v) => values.includes(v)), {
      message: `expected values from: ${values.join(', ')}`,
    })
    .optional();

/** Non-empty after trimming — `z.string().min(1)` accepts "   ". */
const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

/**
 * A quantity.
 *
 * Integer, because these are physical units — boxes, pieces, drums — and the
 * warehouse cannot pick 2.5 of one. If a customer ever orders by weight this
 * has to change, and it should change deliberately rather than by a float
 * quietly being accepted here.
 */
const quantity = z.coerce.number().int().min(0).max(10_000_000);

const stageNumber = z.coerce.number().int().refine(
  (n) => STAGE_NUMBERS.includes(n),
  { message: `expected a stage number between 1 and ${STAGE_NUMBERS.length}` },
);

// ---------------------------------------------------------------------------
// Order items
// ---------------------------------------------------------------------------

export const o2dOrderItemInput = z.object({
  skuCode: text(80),
  productName: optionalText(200),
  /**
   * The line's position on the CUSTOMER's PO.
   *
   * Optional, and defaulted by the service to the array position. It exists so
   * the picklist can be printed in the order the customer wrote it — the same
   * requirement the Customer Portal's picklist already had.
   */
  lineSeq: z.coerce.number().int().min(1).max(9999).nullish(),
  orderedQty: quantity.refine((n) => n > 0, { message: 'a line must order something' }),
  stockStatus: optionalText(80),
  remarks: optionalText(500),
});

export const replaceO2dItemsSchema = z.object({
  items: z.array(o2dOrderItemInput).min(1).max(500),
});

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/**
 * §27: a promise date is required.
 *
 * Not `.optional()` with a service check, and not required outright: the field
 * is nullable HERE and the service refuses a null unless the actor supplied an
 * override reason and holds the permission. Making zod require it would make
 * the authorised exception impossible to express at all, and making it silently
 * optional would lose the rule.
 */
export const createO2dOrderSchema = z.object({
  poNumber: text(80),
  poDate: isoDateTime,

  customer: objectId.nullish(),
  customerName: text(200),

  /**
   * The Customer Portal booking this PO came from (§3), if any.
   *
   * NOT an `objectId` — a booking is identified by its human-readable
   * `orderId` (`BO-`/`SO-YYYY-######`) shared across its several line
   * documents, so there is no single ObjectId that names one.
   *
   * Whether the booking exists, belongs to this customer, and is still
   * unconverted is the service's to decide (see `resolveBookingForIntake`);
   * all three need the database, which is the boundary this file describes.
   */
  sourceBookingId: optionalText(80),

  salesPerson: objectId.nullish(),

  promiseDate: isoDateTime.nullish(),
  /** Required BY THE SERVICE when `promiseDate` is absent. */
  promiseDateOverrideReason: optionalText(300),

  stockStatus: optionalText(80),
  remarks: optionalText(2000),

  /** Lines may be added later, so intake accepts an order with none. */
  items: z.array(o2dOrderItemInput).max(500).default([]),
});

export const updateO2dOrderSchema = z.object({
  customerName: text(200).optional(),
  customer: objectId.nullish(),
  salesPerson: objectId.nullish(),
  promiseDate: isoDateTime.nullish(),
  promiseDateOverrideReason: optionalText(300),
  stockStatus: optionalText(80),
  remarks: optionalText(2000),
}).refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });

// ---------------------------------------------------------------------------
// Stage actions
// ---------------------------------------------------------------------------

export const completeStageSchema = z.object({
  /**
   * When the work HAPPENED, if not now (§33).
   *
   * The service refuses a future value and records anything earlier than now as
   * a back-fill. Validating "not in the future" here would need a clock, and a
   * schema that depends on the current time cannot be reasoned about or tested
   * the way the rest of these can.
   */
  actualCompletion: isoDateTime.nullish(),
  remarks: optionalText(2000),
  evidence: z.record(z.string(), z.unknown()).nullish(),
  override: z.boolean().default(false),
  overrideReason: optionalText(500),
});

/** Stage 4. `advanceRequired: false` is what causes stage 5 to be skipped. */
export const advanceDecisionSchema = z.object({
  advanceRequired: z.boolean(),
  actualCompletion: isoDateTime.nullish(),
  remarks: optionalText(2000),
});

export const skipStageSchema = z.object({
  /** §12: a skip without a reason is indistinguishable from work not done. */
  reason: text(300),
  actualCompletion: isoDateTime.nullish(),
});

export const holdOrderSchema = z.object({
  reason: z.enum(HOLD_REASONS),
  note: optionalText(500),
});

export const resumeOrderSchema = z.object({
  note: optionalText(500),
});

// ---------------------------------------------------------------------------
// Leaving the workflow
// ---------------------------------------------------------------------------

export const exitOrderSchema = z.object({
  /** Free text, not an enum: the register wants the story, and stories vary. */
  reason: text(300),
  remarks: optionalText(2000),
  /**
   * Required BY THE SERVICE when the order has already dispatched - the service
   * is the only layer that knows whether it has. Optional here so an ordinary
   * pre-dispatch cancellation need not name an approver who is not needed.
   */
  approvedBy: objectId.nullish(),
});

export const reviveOrderSchema = z.object({
  reason: text(300),
});

export const exitRegisterQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /** ON_HOLD is included: the register covers everything not moving. */
  exitType: z.enum([...EXIT_TYPES]).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  /** Revived exits are hidden by default - they are no longer exceptions. */
  includeRevived: z.coerce.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const analyticsQuery = z.object({
  /** A `poDate` window. Absent means all time. */
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  customerKey: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const exportQuery = analyticsQuery.extend({
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
  status: csvEnum(ORDER_STATUS_LIST),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const uploadO2dDocumentSchema = z.object({
  docType: z.enum(O2D_DOCUMENT_TYPES),
  stageNumber: stageNumber.nullish(),
  remarks: optionalText(500),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const listO2dOrdersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /** PO number or customer name. */
  search: z.string().trim().max(200).optional(),
  status: csvEnum(ORDER_STATUS_LIST),
  currentStage: stageNumber.optional(),
  /**
   * Orders that have REACHED this stage, whether or not they are still in it.
   * `currentStage` asks what is sitting here now; this asks what has passed
   * through. Each row comes back with its status AT that stage.
   */
  stageReached: stageNumber.optional(),
  customerKey: z.string().trim().max(200).optional(),
  salesPerson: objectId.optional(),
  /** `poDate` window, inclusive. */
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  /** Only orders whose open stage is past its deadline. */
  overdueOnly: z.coerce.boolean().default(false),
  sortBy: z.enum(['poDate', 'promiseDate', 'createdAt', 'currentStage']).default('poDate'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * The Sales booking picker (§3).
 *
 * `status` is a free string rather than an enum of the customer-side lifecycle:
 * that vocabulary belongs to the Customer Portal's `Order` model and is versioned
 * there. Mirroring it into the Employee Portal's shared constants would create a
 * second copy that goes stale the next time the customer side adds a state, and
 * the only cost of accepting an unknown value here is an empty result.
 */
export const listBookingsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Booking id, customer name, PO number, or SKU. */
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(60).optional(),
  /** Show bookings that already have an O2D order, flagged as such. */
  includeConverted: z.coerce.boolean().default(false),
});

export const myTasksQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: csvEnum(STAGE_STATUS_LIST),
  stageNumber: stageNumber.optional(),
  /** overdue | due_soon | on_track — the three buckets §14 asks My Tasks for. */
  bucket: z.enum(['overdue', 'due_soon', 'on_track']).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(['plannedCompletion', 'poDate', 'stageNumber']).default('plannedCompletion'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  /**
   * Whether to include the stages this role has already finished.
   *
   * Defaults to `all`: an order stays visible in every stage it has passed
   * through, marked Done, so the queue shows progress rather than only what is
   * outstanding. `open` is the classic to-do list.
   */
  view: z.enum(['open', 'completed', 'all']).default('all'),
});

export default {
  createO2dOrderSchema,
  updateO2dOrderSchema,
  replaceO2dItemsSchema,
  completeStageSchema,
  advanceDecisionSchema,
  skipStageSchema,
  holdOrderSchema,
  resumeOrderSchema,
  uploadO2dDocumentSchema,
  listO2dOrdersQuery,
  listBookingsQuery,
  myTasksQuery,
  exitOrderSchema,
  reviveOrderSchema,
  exitRegisterQuery,
  analyticsQuery,
  exportQuery,
};
