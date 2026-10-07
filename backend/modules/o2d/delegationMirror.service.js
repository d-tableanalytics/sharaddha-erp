/**
 * The mirrored Delegation record behind one assigned O2D stage.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE, WITH NO DEPENDENCY ON stage.engine.js
 * ---------------------------------------------------------------------------
 * `stage.engine.js#completeStage` needs to call INTO this file (mark the
 * mirror done the moment the real stage completes). `o2dDelegationSync.
 * service.js` needs to call OUT to `stage.engine.js#completeStage` (so
 * completing the mirror from the Delegation screen runs the real completion,
 * not a copy of its rules). Both cannot happen if this file imports the
 * engine — that is a cycle, and importing a module mid-cycle in Node hands you
 * whichever half of it finished loading first, silently.
 *
 * So this file only ever touches the `Delegation` collection. It has no
 * opinion about SLAs, evidence or stage ordering; it is told what happened and
 * records it. `stage.engine.js` imports THIS file (safe: this file imports
 * nothing from o2d); `o2dDelegationSync.service.js` imports both THIS file and
 * the engine, and is the only thing that does — the top of the graph, never
 * the middle.
 *
 * ---------------------------------------------------------------------------
 * WHAT "MIRROR" MEANS HERE
 * ---------------------------------------------------------------------------
 * The Delegation document created for an assigned stage is a REAL Delegation —
 * it appears in My Work, All Tasks, Deleted Tasks exactly like one an admin
 * typed in by hand. What makes it a mirror rather than an independent record
 * is `sourceStageId`: as long as that is set, its status is not this
 * assignee's to decide — see `o2dDelegationSync.service.js#completeMirroredTask`
 * for the one door out of that, which is completing the real stage.
 */

import { Delegation, DELEGATION_REASSIGNED_AWAY } from '../../models/Delegation.js';

/** What the mirrored task is called, so the assignee recognises it instantly. */
export function mirrorTitleFor(stage, order) {
  return `${stage.stageName} — ${order.poNumber}`;
}

/**
 * Create the mirror for a freshly-assigned stage.
 *
 * `dueDate` is required on every Delegation, so a stage with no
 * `plannedCompletion` yet (still LOCKED, waiting on an earlier stage) falls
 * back to now — a placeholder, flagged `scheduleTbd` so no overdue count or
 * badge treats it as a deadline, until the stage unlocks and the mirror's due
 * date is corrected onto the real one; see `resyncMirrorSchedule`.
 */
export async function createMirrorDelegation({ order, stage, assignee, actor }) {
  const doc = new Delegation({
    taskTitle: mirrorTitleFor(stage, order),
    description:
      `Stage ${stage.stageNumber} of the ${order.poNumber} order, assigned from Order Tracker. `
      + 'Completing this task completes the stage — the two cannot go out of sync.',
    assignerId: actor?._id ?? null,
    assignerName: actor?.user ?? actor?.email ?? 'System',
    doerId: assignee._id,
    doerFirstName: (assignee.user ?? assignee.email ?? 'Team').split(' ')[0],
    doerLastName: (assignee.user ?? '').split(' ').slice(1).join(' ') || '',
    assigneeHierarchy: `${assignee.user ?? assignee.email} → ${assignee.role ?? 'Member'}`,
    status: 'Pending',
    priority: 'Medium',
    category: 'FMS',
    dueDate: stage.plannedCompletion ?? new Date(),
    scheduleTbd: !stage.plannedCompletion,
    // The real evidence/verification rules live on the STAGE, in
    // stageFields.service.js — this screen must not invent a second, looser
    // set that a person could satisfy without actually finishing the stage.
    verificationRequired: false,
    evidenceRequired: false,
    sourceType: 'o2d_stage',
    sourceOrderId: order._id,
    sourceStageId: stage._id,
    sourceStageNumber: stage.stageNumber,
    sourcePoNumber: order.poNumber,
  });
  await doc.save();
  return doc;
}

/**
 * Keep the mirror's own scheduling fields in step with the stage.
 *
 * Called whenever the stage's deadline moves — most often when it UNLOCKS and
 * `plannedCompletion` is set for the first time. Only `dueDate` and the title
 * (the PO number never changes, but the stage NAME could, if an admin edits
 * the stage master) move; nothing about status or ownership does.
 */
export async function resyncMirrorSchedule(delegationId, { stage, order }) {
  if (!delegationId) return;
  await Delegation.updateOne(
    { _id: delegationId, sourceStageId: stage._id },
    {
      $set: {
        taskTitle: mirrorTitleFor(stage, order),
        ...(stage.plannedCompletion ? { dueDate: stage.plannedCompletion, scheduleTbd: false } : {}),
      },
    },
  );
}

/**
 * The stage this mirror belongs to was completed for real. Catch the mirror up.
 *
 * `verifiedBy`/`verifiedAt` are stamped too, even though nobody clicked
 * "Verify" on the Delegation screen — the O2D stage's own completion IS the
 * verification (it already required the right role and the right evidence),
 * and a mirror sitting in "Awaiting Verification" forever would be a task
 * every report counts as still open.
 */
export async function markMirrorDone(delegationId, { actor, at = new Date(), note = null } = {}) {
  if (!delegationId) return null;
  const remark = {
    text: note ?? 'Completed automatically — the linked O2D stage was completed.',
    by: actor?._id ?? null,
    byName: actor?.user ?? actor?.email ?? 'System',
    createdAt: at,
  };
  return Delegation.findByIdAndUpdate(
    delegationId,
    {
      $set: {
        status: 'Completed',
        completedAt: at,
        verifiedAt: at,
        verifiedBy: actor?._id ?? null,
      },
      $push: { remarks: remark },
    },
    { new: true },
  );
}

/**
 * The stage was skipped (§7) rather than done. The mirror is resolved the same
 * way as a completion, worded differently, so it stops showing as outstanding
 * work without ever counting against the assignee as a missed deadline.
 */
export async function markMirrorSkipped(delegationId, { actor, reason, at = new Date() } = {}) {
  if (!delegationId) return null;
  return markMirrorDone(delegationId, {
    actor,
    at,
    note: `Closed automatically — the linked O2D stage was skipped (${reason}).`,
  });
}

/**
 * The order behind this mirror was parked — on hold, cancelled or voided.
 *
 * The task is NOT completed, and it is not deleted: the work still exists and
 * may well come back. It is flagged as held so the personal work queues stop
 * offering it, exactly as `task.service.js` stops offering the parked stage in
 * My Tasks. The status word is left untouched on purpose, so a release puts
 * the row back saying what it said before rather than guessing.
 *
 * Idempotent on the flag — a second hold does not overwrite the first
 * `heldAt`, so the record still says when the work actually stopped.
 */
export async function holdMirror(delegationId, { actor, reason, at = new Date() } = {}) {
  if (!delegationId) return null;
  return Delegation.findOneAndUpdate(
    { _id: delegationId, heldAt: null },
    {
      $set: { heldAt: at, holdReason: reason ?? null },
      $push: {
        remarks: {
          text: `Paused automatically — ${reason ?? 'the linked O2D order was parked'}.`,
          by: actor?._id ?? null,
          byName: actor?.user ?? actor?.email ?? 'System',
          createdAt: at,
        },
      },
    },
    { new: true },
  );
}

/** The order is live again. Give the task back to whoever owes it. */
export async function releaseMirror(delegationId, { actor, reason, at = new Date() } = {}) {
  if (!delegationId) return null;
  return Delegation.findOneAndUpdate(
    { _id: delegationId, heldAt: { $ne: null } },
    {
      $set: { heldAt: null, holdReason: null },
      $push: {
        remarks: {
          text: `Resumed automatically — ${reason ?? 'the linked O2D order is live again'}.`,
          by: actor?._id ?? null,
          byName: actor?.user ?? actor?.email ?? 'System',
          createdAt: at,
        },
      },
    },
    { new: true },
  );
}

/**
 * Detach a mirror from its stage — on unassignment, or the first half of a
 * reassignment.
 *
 * `sourceStageId` is cleared, not just the status: the unique partial index on
 * that field allows exactly one LIVE mirror per stage, and a reassignment's
 * new mirror cannot be created for the same stage until the old one lets go of
 * it. The rest of the `source*` fields are left in place on purpose — they are
 * how this now-orphaned record still explains, months later, where it came
 * from.
 */
export async function detachMirror(delegationId, { actor, reason, at = new Date(), reassignedTo = null } = {}) {
  if (!delegationId) return null;

  const current = await Delegation.findById(delegationId).select('status completedAt').lean();
  if (!current) return null;

  const remark = {
    text: reason,
    by: actor?._id ?? null,
    byName: actor?.user ?? actor?.email ?? 'System',
    createdAt: at,
  };

  /**
   * A task this person GENUINELY finished keeps saying so.
   *
   * Rare but reachable — a stage completed and its mirror closed, then the
   * stage unassigned afterwards for tidiness — and the distinction is the
   * whole point of this function no longer writing `Completed` itself. If the
   * row already records a real completion, overwriting it with `Reassigned`
   * would delete the credit somebody actually earned, which is the same class
   * of error in the opposite direction.
   */
  const wasReallyCompleted = current.status === 'Completed' || Boolean(current.completedAt);

  return Delegation.findByIdAndUpdate(
    delegationId,
    {
      $set: {
        // `completedAt` is conspicuously absent from both branches. Stamping it
        // is what made a hand-off look like an achievement.
        ...(wasReallyCompleted ? {} : { status: DELEGATION_REASSIGNED_AWAY }),
        reassignedTo,
        reassignedBy: actor?._id ?? null,
        sourceStageId: null,
      },
      $push: { remarks: remark },
    },
    { new: true },
  );
}

export default {
  mirrorTitleFor,
  createMirrorDelegation,
  resyncMirrorSchedule,
  markMirrorDone,
  markMirrorSkipped,
  holdMirror,
  releaseMirror,
  detachMirror,
};
