/**
 * The mirrored Checklist task behind one assigned O2D stage.
 *
 * ---------------------------------------------------------------------------
 * WHY A STAGE WOULD LAND HERE RATHER THAN IN DELEGATION
 * ---------------------------------------------------------------------------
 * Because finishing it means RECORDING SPECIFIC THINGS, not just confirming it
 * happened. Stage 8 wants an invoice number, a date and a value; stage 9 wants
 * a transporter, an AWB, a box count and a weight; stage 5 wants the amount, a
 * UTR and a payment date. That is a checklist item in the ordinary sense of the
 * word — a list of things to record — and it is what `mirrorKindForStage`
 * keys on. A stage with no required fields at all (1 and 4: receive the order,
 * decide about the advance) is a hand-off, and goes to Delegation instead.
 *
 * Exactly one mirror is created per assignment. Never both.
 *
 * ---------------------------------------------------------------------------
 * ROUTINE ONCE, OCCURRENCE PER ASSIGNEE
 * ---------------------------------------------------------------------------
 * Checklist's own model is a ROUTINE (the recurring definition) that generates
 * OCCURRENCES (the dated instances). An O2D stage is not recurring, so its
 * routine is `frequency: 'once'` and exists mainly to carry the unique
 * `taskCode` — `O2D-PO-4471-S8`, stable for the life of the stage however many
 * times it changes hands. The OCCURRENCE is what gets closed out and recreated
 * on reassignment, which is the right grain: the work is the same, the person
 * owing it is not.
 *
 * ---------------------------------------------------------------------------
 * NO DEPENDENCY ON stage.engine.js
 * ---------------------------------------------------------------------------
 * Same rule as `delegationMirror.service.js`, for the same reason: the engine
 * calls INTO the mirrors on completion, and the sync service calls OUT to the
 * engine. This file touches only the Checklist collections.
 */

import {
  ChecklistRoutine, ChecklistOccurrence, OCCURRENCE_REASSIGNED_AWAY,
} from '../../models/Checklist.js';

/** The stable, human-readable code for a stage's routine. */
export function mirrorTaskCodeFor(order, stage) {
  return `O2D-${order.poNumber}-S${stage.stageNumber}`.toUpperCase();
}

const firstName = (u) => String(u?.user ?? u?.email ?? 'Team').split(' ')[0];
const lastName = (u) => String(u?.user ?? '').split(' ').slice(1).join(' ');

/**
 * Who the row names as its doer. A team task has nobody yet, so it names the
 * team — the existing name columns are what every Checklist screen displays.
 */
const doerFieldsFor = (assignee, team) => (assignee
  ? { doer: assignee._id, doerFirstName: firstName(assignee), doerLastName: lastName(assignee) }
  : { doer: null, doerFirstName: `${team || 'O2D'} team`, doerLastName: '' });

/**
 * Create the live occurrence for an active stage, upserting the routine that
 * carries it.
 *
 * `assignee: null` makes a TEAM task — visible to everyone in the role that
 * completes the stage (`team`), claimed by whoever completes it.
 *
 * `department` is the stage's OWNER ROLE — Sales, Billing, Accounts — because
 * that is what the Checklist screens group and report by, and it is the same
 * vocabulary O2D already uses for who a stage belongs to.
 */
export async function createChecklistMirror({ order, stage, assignee, actor, team = null }) {
  const doerFields = doerFieldsFor(assignee, team);
  const routine = await ChecklistRoutine.findOneAndUpdate(
    { sourceStageId: stage._id },
    {
      $set: {
        taskName: `${stage.stageName} — ${order.poNumber}`,
        taskCode: mirrorTaskCodeFor(order, stage),
        frequency: 'once',
        ...doerFields,
        department: stage.ownerRole ?? '',
        startDate: stage.plannedStart ?? new Date(),
        endDate: stage.plannedCompletion ?? new Date(),
        // The stage's own required fields are the real proof rule, enforced by
        // `completeStage`. Setting Checklist's cruder `proofRequired` flag on
        // top would add a SECOND gate that could refuse a completion O2D was
        // happy with, for a file O2D never asked for.
        proofRequired: false,
        isActive: true,
        createdBy: actor?._id ?? null,
        sourceType: 'o2d_stage',
        sourceOrderId: order._id,
        sourceStageId: stage._id,
        sourceStageNumber: stage.stageNumber,
        sourcePoNumber: order.poNumber,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const occurrence = await ChecklistOccurrence.create({
    routine: routine._id,
    taskName: routine.taskName,
    taskCode: routine.taskCode,
    ...doerFields,
    department: stage.ownerRole ?? '',
    frequency: 'once',
    plannedDate: stage.plannedCompletion ?? new Date(),
    status: 'pending',
    proofRequired: false,
    createdBy: actor?._id ?? null,
    sourceType: 'o2d_stage',
    sourceOrderId: order._id,
    sourceStageId: stage._id,
    sourceStageNumber: stage.stageNumber,
    sourcePoNumber: order.poNumber,
  });

  return occurrence;
}

/** Keep the occurrence's date in step with the stage — chiefly on unlock. */
export async function resyncChecklistMirror(occurrenceId, { stage, order }) {
  if (!occurrenceId) return;
  const name = `${stage.stageName} — ${order.poNumber}`;
  await ChecklistOccurrence.updateOne(
    { _id: occurrenceId, sourceStageId: stage._id },
    {
      $set: {
        taskName: name,
        ...(stage.plannedCompletion ? { plannedDate: stage.plannedCompletion } : {}),
      },
    },
  );
  await ChecklistRoutine.updateOne(
    { sourceStageId: stage._id },
    {
      $set: {
        taskName: name,
        ...(stage.plannedCompletion ? { endDate: stage.plannedCompletion } : {}),
      },
    },
  );
}

const remarkOf = (text, actor, at) => ({
  text,
  by: actor?._id ?? null,
  byName: actor?.user ?? actor?.email ?? 'System',
  createdAt: at,
});

/**
 * The real stage was completed — catch the occurrence up.
 *
 * A team task is credited to whoever completed it: they become its doer, so
 * the completion counts on their Checklist and scoreboard.
 */
export async function markChecklistMirrorDone(occurrenceId, { actor, at = new Date(), note = null } = {}) {
  if (!occurrenceId) return null;
  if (actor?._id) {
    await ChecklistOccurrence.updateOne(
      { _id: occurrenceId, doer: null },
      { $set: { doer: actor._id, doerFirstName: firstName(actor), doerLastName: lastName(actor) } },
    );
  }
  return ChecklistOccurrence.findByIdAndUpdate(
    occurrenceId,
    {
      $set: {
        status: 'completed',
        completedDate: at,
        completedBy: actor?._id ?? null,
      },
      $push: {
        remarks: remarkOf(
          note ?? 'Completed automatically — the linked O2D stage was completed.',
          actor,
          at,
        ),
      },
    },
    { new: true },
  );
}

/**
 * The stage was SKIPPED (§7).
 *
 * `non-functional` rather than `completed`: Checklist has a status for exactly
 * this — work that did not need doing — and it keeps a skipped stage out of a
 * completion-rate report the same way §7 keeps it out of the O2D KPI. Calling
 * it completed would quietly flatter both numbers.
 */
export async function markChecklistMirrorSkipped(occurrenceId, { actor, reason, at = new Date() } = {}) {
  if (!occurrenceId) return null;

  /*
   * An unclaimed team task is removed rather than marked non-functional. It was
   * created only because the stage opened for a moment — stage 5 opens and is
   * skipped in the same step when stage 4 says "no advance" — so it was never
   * anybody's work, and keeping it would put a dead row on every team member's
   * list and into their compliance total. The skip itself is in the stage history.
   */
  const current = await ChecklistOccurrence.findById(occurrenceId).select('doer routine').lean();
  if (current && !current.doer) {
    await ChecklistOccurrence.deleteOne({ _id: occurrenceId });
    if (!(await ChecklistOccurrence.exists({ routine: current.routine }))) {
      await ChecklistRoutine.deleteOne({ _id: current.routine });
    }
    return { removed: true };
  }

  return ChecklistOccurrence.findByIdAndUpdate(
    occurrenceId,
    {
      $set: {
        status: 'non-functional',
        nonFunctionalReason: `O2D stage skipped: ${reason}`,
      },
      $push: {
        remarks: remarkOf(`Closed automatically — the linked O2D stage was skipped (${reason}).`, actor, at),
      },
    },
    { new: true },
  );
}

/**
 * The order behind this occurrence was parked — held, cancelled or voided.
 *
 * Flagged, not resolved. `non-functional` would be the wrong word (that means
 * the work did not need doing, and a held order's work may well still need
 * doing) and `completed` would be a lie. See the matching note in
 * `delegationMirror.service.js`.
 */
export async function holdChecklistMirror(occurrenceId, { actor, reason, at = new Date() } = {}) {
  if (!occurrenceId) return null;
  return ChecklistOccurrence.findOneAndUpdate(
    { _id: occurrenceId, heldAt: null },
    {
      $set: { heldAt: at, holdReason: reason ?? null },
      $push: {
        remarks: remarkOf(`Paused automatically — ${reason ?? 'the linked O2D order was parked'}.`, actor, at),
      },
    },
    { new: true },
  );
}

/** The order is live again. Put the occurrence back in the doer's queue. */
export async function releaseChecklistMirror(occurrenceId, { actor, reason, at = new Date() } = {}) {
  if (!occurrenceId) return null;
  return ChecklistOccurrence.findOneAndUpdate(
    { _id: occurrenceId, heldAt: { $ne: null } },
    {
      $set: { heldAt: null, holdReason: null },
      $push: {
        remarks: remarkOf(`Resumed automatically — ${reason ?? 'the linked O2D order is live again'}.`, actor, at),
      },
    },
    { new: true },
  );
}

/**
 * Detach on unassignment or the first half of a reassignment.
 *
 * `sourceStageId` is cleared so the next assignee's occurrence can claim the
 * unique link, and the row survives as history. The ROUTINE is deliberately
 * left attached — it is the stage's stable identity, reused by whoever picks
 * the work up next.
 */
export async function detachChecklistMirror(occurrenceId, { actor, reason, at = new Date(), reassignedTo = null } = {}) {
  if (!occurrenceId) return null;

  const current = await ChecklistOccurrence.findById(occurrenceId).select('status completedDate').lean();
  if (!current) return null;

  // Same rule as the Delegation surface, for the same reason: a hand-off is not
  // a completion, and a real completion already on the row is not a hand-off.
  // See `delegationMirror.service.js#detachMirror`.
  const wasReallyCompleted = current.status === 'completed' || Boolean(current.completedDate);

  return ChecklistOccurrence.findByIdAndUpdate(
    occurrenceId,
    {
      $set: {
        ...(wasReallyCompleted ? {} : { status: OCCURRENCE_REASSIGNED_AWAY }),
        // The fields Checklist already uses for its own reassign flow, so both
        // routes to "this moved" leave the same trail.
        reassigned: true,
        reassignedTo,
        reassignedBy: actor?._id ?? null,
        sourceStageId: null,
      },
      $push: { remarks: remarkOf(reason, actor, at) },
    },
    { new: true },
  );
}

export default {
  mirrorTaskCodeFor,
  createChecklistMirror,
  resyncChecklistMirror,
  markChecklistMirrorDone,
  markChecklistMirrorSkipped,
  holdChecklistMirror,
  releaseChecklistMirror,
  detachChecklistMirror,
};
