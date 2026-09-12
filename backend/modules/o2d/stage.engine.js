/**
 * The stage engine — the only thing that may move an order.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY TRANSITION COMES THROUGH HERE
 * ---------------------------------------------------------------------------
 *
 * §53: "The workflow/state machine and SLA engine are the source of truth. Do
 * not duplicate business logic in individual screens."
 *
 * Completing a stage is never one write. It stamps an actual, computes a delay
 * against a deadline, closes the row, unlocks the next one, computes THAT row's
 * deadline, moves the order's cursor, and announces an event. A controller that
 * does five of those six leaves an order that looks complete and never notifies
 * anyone — and the sixth is always the one nobody notices is missing.
 *
 * So controllers call `completeStage`, `skipStage`, `holdOrder`, `resumeOrder`.
 * They do not write stage documents.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It does not send anything. It returns the events that occurred, and the
 * notification layer decides who hears about them through which channel (§42).
 * That keeps the engine testable without a mail server and stops a stage
 * transition failing because SMTP was down.
 */

import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
import { loadCalendar, workingMinutesBetween } from './calendar.service.js';
import { plannedCompletion, heldWorkingMinutes, applyHold } from './sla.service.js';
import { recordAudit } from '../../utils/auditLog.js';
import {
  STAGES,
  STAGE_STATUS,
  ORDER_STATUS,
  O2D_EVENTS,
  O2D_AUDIT_ACTIONS,
  LAST_STAGE,
  TERMINAL_STAGE_STATUSES,
} from '../../shared/constants/o2d.js';

/**
 * Write an audit row for a transition.
 *
 * §34 requires every stage completion, skip, override, hold, resume and
 * cancellation to be auditable, with old value, new value and reason. The portal
 * already has `recordAudit` writing to `AuditLog`, so O2D uses it rather than
 * growing a parallel trail — one place to look when somebody asks who moved an
 * order is worth more than a purpose-built table.
 *
 * NEVER THROWS. `recordAudit` swallows its own errors, and that is the right
 * shape here: an audit write failing must not roll back a dispatch that
 * physically happened. The alternative — a warehouse unable to record a
 * departed truck because the log was full — is worse than a gap in the trail.
 */
const audit = (actor, action, remarks, meta, req = null) =>
  recordAudit(actor ?? null, action, remarks, req, { meta });

/** A refusal a human can act on. §44 asks for these rather than error codes. */
export class O2dWorkflowError extends Error {
  constructor(message, { status = 422, code = 'O2D_WORKFLOW' } = {}) {
    super(message);
    this.name = 'O2dWorkflowError';
    this.statusCode = status;
    this.code = code;
  }
}

const yearsSpanning = (...dates) => [
  ...new Set(dates.filter(Boolean).map((d) => new Date(d).getUTCFullYear())),
];

// ---------------------------------------------------------------------------
// Creating the twelve rows
// ---------------------------------------------------------------------------

/**
 * Build every stage row for a new order.
 *
 * All twelve are created up front, not lazily as each unlocks. §4 requires it,
 * and it is the right shape anyway: the tracker renders twelve chips per order
 * from the first moment, and a missing row would have to be rendered as an
 * absence that looks identical to a locked stage.
 *
 * Stage 1 is completed here — creating the order IS receiving it — which
 * immediately unlocks stage 2.
 */
export async function createStagesForOrder(order, { actor = null, now = new Date() } = {}) {
  const masters = await O2dStageMaster.find({ enabled: true }).sort({ stageNumber: 1 }).lean();
  if (masters.length === 0) {
    throw new O2dWorkflowError(
      'The O2D stage master is empty, so no order can be created. Seed the twelve stages first.',
      { status: 500, code: 'O2D_NO_STAGE_MASTER' },
    );
  }

  const calendar = await loadCalendar({ years: yearsSpanning(now, order.poDate) });

  const rows = masters.map((m) => ({
    order: order._id,
    stageNumber: m.stageNumber,
    stageKey: m.key,
    stageName: m.name,
    ownerRole: m.ownerRole,
    status: STAGE_STATUS.LOCKED,
    sla: { type: m.slaType, value: m.slaValue ?? null, byMinute: m.slaByMinute ?? null },
  }));

  await O2dOrderStage.insertMany(rows);

  // Stage 1 is done by definition, and completing it unlocks stage 2 through the
  // same path every other stage uses — rather than a second, special code path
  // that could drift from it.
  return completeStage({
    orderId: order._id,
    stageNumber: STAGES.RECEIVE_ORDER,
    actor,
    now,
    evidence: { createdVia: 'order_intake' },
    calendar,
  });
}

// ---------------------------------------------------------------------------
// Unlocking
// ---------------------------------------------------------------------------

/**
 * Open a stage for work: stamp its planned start, compute its deadline, unlock.
 *
 * The deadline is written ONCE, here. Everything downstream reads the stored
 * value rather than recomputing, so a later edit to the SLA master cannot
 * re-judge work already in flight (§48).
 */
async function unlockStage(stage, { from, calendar, order }) {
  const start = from;
  const rule = { type: stage.sla.type, value: stage.sla.value ?? undefined, byMinute: stage.sla.byMinute ?? undefined };

  let due = plannedCompletion(start, rule, calendar);
  // An order unlocked while holds already exist — a stage opening during a hold,
  // or after several — inherits the frozen time rather than starting behind.
  due = applyHold(due, rule, heldWorkingMinutes(order.holds ?? [], calendar), calendar);

  stage.plannedStart = start;
  stage.plannedCompletion = due;
  stage.actualStart = start;
  stage.status = order.status === ORDER_STATUS.ON_HOLD ? STAGE_STATUS.ON_HOLD : STAGE_STATUS.PENDING;
  await stage.save();
  return stage;
}

/**
 * The next stage that should open after `from`.
 *
 * Walks FORWARD past anything already terminal, so a stage completed out of
 * order under an override does not leave the cursor stuck behind it.
 */
async function nextOpenStage(orderId, from) {
  return O2dOrderStage.findOne({
    order: orderId,
    stageNumber: { $gt: from },
    status: { $nin: TERMINAL_STAGE_STATUSES },
  }).sort({ stageNumber: 1 });
}

// ---------------------------------------------------------------------------
// Completing
// ---------------------------------------------------------------------------

/**
 * Complete a stage, and open whatever follows.
 *
 * @param {object}  p
 * @param {Date}    [p.actualCompletion]  when the WORK happened. Defaults to now.
 *                  A value in the past is a back-fill and is recorded as one —
 *                  see `recordedAt` on the model. §33.
 * @param {boolean} [p.override]  complete despite an incomplete predecessor.
 *                  §28 — authorisation is the caller's to check; the engine
 *                  records that it happened and demands a reason.
 * @returns {{stage, order, events: Array<{type: string, payload: object}>}}
 */
export async function completeStage({
  orderId,
  stageNumber,
  actor = null,
  actualCompletion = null,
  now = new Date(),
  evidence = null,
  remarks = null,
  override = false,
  overrideReason = null,
  calendar = null,
}) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  if (order.status === ORDER_STATUS.CANCELLED || order.status === ORDER_STATUS.VOID) {
    throw new O2dWorkflowError(
      `This order was ${order.status.toLowerCase()} and cannot be worked. Revive it first if that was a mistake.`,
      { code: 'O2D_ORDER_EXITED' },
    );
  }
  if (order.status === ORDER_STATUS.ON_HOLD) {
    throw new O2dWorkflowError(
      'This order is on hold. Resume it before completing any stage.',
      { code: 'O2D_ORDER_ON_HOLD' },
    );
  }

  const stage = await O2dOrderStage.findOne({ order: orderId, stageNumber });
  if (!stage) throw new O2dWorkflowError(`Stage ${stageNumber} does not exist on this order.`, { status: 404 });

  if (TERMINAL_STAGE_STATUSES.includes(stage.status)) {
    throw new O2dWorkflowError(
      `${stage.stageName} is already ${stage.status === STAGE_STATUS.SKIPPED ? 'skipped' : 'complete'}.`,
      { code: 'O2D_STAGE_DONE' },
    );
  }

  // §28: a later stage cannot run ahead of an incomplete earlier one — unless an
  // authorised user says so, in writing.
  const blocker = await O2dOrderStage.findOne({
    order: orderId,
    stageNumber: { $lt: stageNumber },
    status: { $nin: TERMINAL_STAGE_STATUSES },
  }).sort({ stageNumber: 1 });

  if (blocker) {
    if (!override) {
      throw new O2dWorkflowError(
        `${stage.stageName} cannot be completed because ${blocker.stageName} (stage ${blocker.stageNumber}) `
          + `has not been completed — it is still with ${blocker.ownerRole}.`,
        { code: 'O2D_PREREQUISITE_INCOMPLETE' },
      );
    }
    if (!overrideReason?.trim()) {
      throw new O2dWorkflowError(
        'Completing a stage out of order needs a reason, which is recorded against the order.',
        { code: 'O2D_OVERRIDE_REASON_REQUIRED' },
      );
    }
  }

  const cal = calendar ?? (await loadCalendar({ years: yearsSpanning(now, order.poDate) }));
  const done = actualCompletion ? new Date(actualCompletion) : now;

  if (done > now) {
    throw new O2dWorkflowError(
      'A stage cannot be completed in the future.',
      { code: 'O2D_FUTURE_TIMESTAMP' },
    );
  }

  // Delay is measured against the STORED deadline, extended by any time the
  // order spent on hold — held time is not this owner's delay (§19).
  const held = heldWorkingMinutes(order.holds ?? [], cal, done);
  const rule = { type: stage.sla.type, value: stage.sla.value ?? undefined, byMinute: stage.sla.byMinute ?? undefined };
  const due = stage.plannedCompletion
    ? applyHold(new Date(stage.plannedCompletion), rule, held, cal)
    : null;
  const late = due ? workingMinutesBetween(due, done, cal) : 0;

  // Read BEFORE mutating. An ordinary completion moves PENDING -> DONE, but an
  // overridden one completes a stage that was still LOCKED, and "old value"
  // (§34) is only worth recording if it is the one that was actually there.
  const priorStatus = stage.status;

  stage.actualCompletion = done;
  // The two differ only on a back-fill, which is exactly what §33 wants to see.
  stage.recordedAt = now;
  stage.completedBy = actor?._id ?? null;
  stage.completedByName = actor?.user ?? actor?.email ?? null;
  stage.completedByRole = actor?.role ?? null;
  stage.delayMinutes = late;
  stage.status = late > 0 ? STAGE_STATUS.DONE_LATE : STAGE_STATUS.DONE_ON_TIME;
  if (evidence) stage.evidence = { ...(stage.evidence ?? {}), ...evidence };
  if (remarks) stage.remarks = remarks;
  if (blocker && override) {
    stage.overridden = true;
    stage.overrideReason = overrideReason.trim();
    stage.overriddenBy = actor?._id ?? null;
  }
  await stage.save();

  const events = [{
    type: O2D_EVENTS.STAGE_COMPLETED,
    payload: { orderId: order._id, stageNumber, late, overridden: Boolean(blocker && override) },
  }];

  // Stage 9's actual is the dispatch moment, and the headline KPI's endpoint.
  if (stageNumber === STAGES.PACK_AND_DISPATCH) {
    order.dispatchedAt = done;
    events.push({ type: O2D_EVENTS.DISPATCH_COMPLETED, payload: { orderId: order._id, at: done } });
  }
  if (stageNumber === STAGES.SCAN_AND_INVOICE && evidence?.invoiceNumber) {
    order.invoiceNumber = evidence.invoiceNumber;
    events.push({ type: O2D_EVENTS.INVOICE_CREATED, payload: { orderId: order._id, invoiceNumber: evidence.invoiceNumber } });
  }

  const next = await nextOpenStage(order._id, stageNumber);
  if (next) {
    await unlockStage(next, { from: done, calendar: cal, order });
    order.currentStage = next.stageNumber;
    events.push({
      type: O2D_EVENTS.STAGE_UNLOCKED,
      payload: { orderId: order._id, stageNumber: next.stageNumber, ownerRole: next.ownerRole, dueAt: next.plannedCompletion },
    });
  } else if (stageNumber === LAST_STAGE || !(await nextOpenStage(order._id, 0))) {
    order.status = ORDER_STATUS.CLOSED;
    order.closedAt = done;
    order.closedBy = actor?._id ?? null;
    order.currentStage = LAST_STAGE;
    events.push({ type: O2D_EVENTS.ORDER_CLOSED, payload: { orderId: order._id, at: done } });
  }

  order.updatedBy = actor?._id ?? null;
  await order.save();

  await audit(
    actor,
    blocker && override ? O2D_AUDIT_ACTIONS.STAGE_OVERRIDDEN : O2D_AUDIT_ACTIONS.STAGE_COMPLETED,
    `${stage.stageName} completed on ${order.poNumber}`
      + (late > 0 ? ` — ${late} working minute(s) late` : '')
      + (blocker && override ? ` — OUT OF ORDER: ${overrideReason.trim()}` : ''),
    {
      orderId: String(order._id),
      poNumber: order.poNumber,
      stageNumber,
      // Old and new value, as §34 asks for.
      from: priorStatus,
      to: stage.status,
      plannedCompletion: due,
      actualCompletion: done,
      // The back-fill signal: equal on an ordinary completion, apart when the
      // work was recorded after the fact (§33).
      recordedAt: now,
      backFilled: done.getTime() !== now.getTime(),
      delayMinutes: late,
      overridden: Boolean(blocker && override),
      overrideReason: blocker && override ? overrideReason.trim() : null,
    },
  );

  return { stage, order, events };
}

// ---------------------------------------------------------------------------
// Skipping
// ---------------------------------------------------------------------------

/**
 * Mark a stage as not required, and open the next.
 *
 * The only stage this applies to today is 5, when stage 4 says the order is not
 * an advance order. §7 is emphatic about what SKIPPED must mean: not a delay,
 * not a failure, excluded from on-time percentage entirely — see the note in
 * `shared/constants/o2d.js`.
 *
 * A reason is mandatory, because §7 also says the user must understand WHY a
 * stage was skipped, and "it just was" is not an explanation on a timeline.
 */
export async function skipStage({ orderId, stageNumber, reason, actor = null, now = new Date(), calendar = null }) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  const stage = await O2dOrderStage.findOne({ order: orderId, stageNumber });
  if (!stage) throw new O2dWorkflowError(`Stage ${stageNumber} does not exist on this order.`, { status: 404 });

  if (TERMINAL_STAGE_STATUSES.includes(stage.status)) {
    throw new O2dWorkflowError(`${stage.stageName} is already closed.`, { code: 'O2D_STAGE_DONE' });
  }

  const master = await O2dStageMaster.findOne({ stageNumber }).lean();
  if (!master?.skippable) {
    throw new O2dWorkflowError(
      `${stage.stageName} is a required stage and cannot be skipped.`,
      { code: 'O2D_STAGE_NOT_SKIPPABLE' },
    );
  }
  if (!reason?.trim()) {
    throw new O2dWorkflowError(
      'Skipping a stage needs a reason, so the timeline explains itself.',
      { code: 'O2D_SKIP_REASON_REQUIRED' },
    );
  }

  const cal = calendar ?? (await loadCalendar({ years: yearsSpanning(now, order.poDate) }));

  stage.status = STAGE_STATUS.SKIPPED;
  stage.skipReason = reason.trim();
  stage.skippedAt = now;
  // Deliberately NOT an actual completion: a skipped stage was never done, and
  // stamping one would pull it into the KPI denominator it must stay out of.
  stage.delayMinutes = null;
  await stage.save();

  const events = [{ type: O2D_EVENTS.STAGE_SKIPPED, payload: { orderId: order._id, stageNumber, reason: stage.skipReason } }];

  const next = await nextOpenStage(order._id, stageNumber);
  if (next) {
    await unlockStage(next, { from: now, calendar: cal, order });
    order.currentStage = next.stageNumber;
    events.push({
      type: O2D_EVENTS.STAGE_UNLOCKED,
      payload: { orderId: order._id, stageNumber: next.stageNumber, ownerRole: next.ownerRole, dueAt: next.plannedCompletion },
    });
    await order.save();
  }

  await audit(actor, O2D_AUDIT_ACTIONS.STAGE_SKIPPED,
    `${stage.stageName} skipped on ${order.poNumber} — ${stage.skipReason}`,
    {
      orderId: String(order._id),
      poNumber: order.poNumber,
      stageNumber,
      to: STAGE_STATUS.SKIPPED,
      reason: stage.skipReason,
      // Recorded so an analyst can confirm the exclusion was legitimate rather
      // than a way of quietly improving an on-time score.
      excludedFromKpi: true,
    });

  return { stage, order, events };
}

// ---------------------------------------------------------------------------
// Hold and resume
// ---------------------------------------------------------------------------

/**
 * Pause the order. The SLA clock stops for every open stage.
 *
 * The open stage is moved to ON_HOLD rather than left PENDING, so the tracker
 * and My Tasks stop showing it as work someone is failing to do.
 */
export async function holdOrder({ orderId, reason, note = null, actor = null, now = new Date() }) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  if (order.status === ORDER_STATUS.ON_HOLD) {
    throw new O2dWorkflowError('This order is already on hold.', { code: 'O2D_ALREADY_ON_HOLD' });
  }
  if (order.status !== ORDER_STATUS.OPEN) {
    throw new O2dWorkflowError(
      `A ${order.status.toLowerCase()} order cannot be put on hold.`,
      { code: 'O2D_NOT_HOLDABLE' },
    );
  }
  if (!reason) {
    throw new O2dWorkflowError('A hold needs a reason.', { code: 'O2D_HOLD_REASON_REQUIRED' });
  }

  order.holds.push({
    reason,
    note: note?.trim() || null,
    startedAt: now,
    startedBy: actor?._id ?? null,
    stageNumber: order.currentStage,
  });
  order.status = ORDER_STATUS.ON_HOLD;
  await order.save();

  await O2dOrderStage.updateMany(
    { order: order._id, status: { $in: [STAGE_STATUS.PENDING, STAGE_STATUS.DUE_SOON, STAGE_STATUS.OVERDUE] } },
    { $set: { status: STAGE_STATUS.ON_HOLD } },
  );

  await audit(actor, O2D_AUDIT_ACTIONS.ORDER_HELD,
    `${order.poNumber} placed on hold — ${reason}${note ? `: ${note.trim()}` : ''}`,
    {
      orderId: String(order._id),
      poNumber: order.poNumber,
      from: ORDER_STATUS.OPEN,
      to: ORDER_STATUS.ON_HOLD,
      reason,
      note: note?.trim() ?? null,
      stageNumber: order.currentStage,
    });

  return {
    order,
    events: [{ type: O2D_EVENTS.ORDER_HELD, payload: { orderId: order._id, reason, stageNumber: order.currentStage } }],
  };
}

/**
 * Resume, and give back exactly the working time that was frozen.
 *
 * The held minutes are stamped on the hold record and every open stage's
 * deadline is pushed out by them — so an order parked for three days does not
 * make its owner three days late (§19), and the figure cannot later move because
 * someone declared a holiday inside the hold window.
 */
export async function resumeOrder({ orderId, actor = null, now = new Date(), calendar = null }) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });
  if (order.status !== ORDER_STATUS.ON_HOLD) {
    throw new O2dWorkflowError('This order is not on hold.', { code: 'O2D_NOT_ON_HOLD' });
  }

  const hold = order.activeHold();
  if (!hold) {
    throw new O2dWorkflowError(
      'This order is marked on hold but has no open hold record. It needs an administrator.',
      { status: 500, code: 'O2D_HOLD_INCONSISTENT' },
    );
  }

  const cal = calendar ?? (await loadCalendar({ years: yearsSpanning(now, hold.startedAt, order.poDate) }));
  const frozen = workingMinutesBetween(new Date(hold.startedAt), now, cal);

  hold.resumedAt = now;
  hold.resumedBy = actor?._id ?? null;
  hold.heldWorkingMinutes = frozen;
  order.status = ORDER_STATUS.OPEN;
  await order.save();

  // Push every paused deadline out by the frozen time, and reopen the stages.
  const paused = await O2dOrderStage.find({ order: order._id, status: STAGE_STATUS.ON_HOLD });
  for (const stage of paused) {
    const rule = { type: stage.sla.type, value: stage.sla.value ?? undefined, byMinute: stage.sla.byMinute ?? undefined };
    if (stage.plannedCompletion) {
      stage.plannedCompletion = applyHold(new Date(stage.plannedCompletion), rule, frozen, cal);
    }
    stage.status = STAGE_STATUS.PENDING;
    await stage.save();
  }

  await audit(actor, O2D_AUDIT_ACTIONS.ORDER_RESUMED,
    `${order.poNumber} resumed after ${frozen} working minute(s) on hold`,
    {
      orderId: String(order._id),
      poNumber: order.poNumber,
      from: ORDER_STATUS.ON_HOLD,
      to: ORDER_STATUS.OPEN,
      heldWorkingMinutes: frozen,
      // Every deadline that moved, so the extension is reviewable rather than
      // something a manager has to take on trust.
      deadlinesExtended: paused.map((st) => st.stageNumber),
    });

  return {
    order,
    events: [{ type: O2D_EVENTS.ORDER_RESUMED, payload: { orderId: order._id, heldWorkingMinutes: frozen } }],
  };
}

export default {
  O2dWorkflowError,
  createStagesForOrder,
  completeStage,
  skipStage,
  holdOrder,
  resumeOrder,
};
