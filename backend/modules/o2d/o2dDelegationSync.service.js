/**
 * Assign one O2D stage to one specific person, and keep it wired to their
 * Work Queue from there.
 *
 * ---------------------------------------------------------------------------
 * THE TOP OF THE GRAPH — imported by controllers, imports everything else
 * ---------------------------------------------------------------------------
 * This is the one file allowed to import both `stage.engine.js` (to actually
 * complete a stage) and `stageMirror.service.js` (to create and update the
 * mirror). Neither of those two may import each other, or this — see the note
 * at the top of `delegationMirror.service.js` for why. Controllers call into
 * this file; this file is never called from inside the engine or a mirror.
 *
 * ---------------------------------------------------------------------------
 * ONE STAGE, ONE MIRROR, EITHER SURFACE
 * ---------------------------------------------------------------------------
 * Assigning a stage creates a task on exactly one of the two Work Queue
 * surfaces — Checklist if finishing the stage means RECORDING specific things,
 * Delegation if it means confirming one. This file never decides which;
 * `stageMirror.service.js` does, and hands back the `kind` so the right field
 * on the stage row gets the id. Both fields are written on every assignment,
 * one to the new id and the other to null, so the pair can never drift into
 * claiming two live mirrors.
 */

import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import User from '../../models/User.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';
import { recordAudit } from '../../utils/auditLog.js';
import { O2dWorkflowError, completeStage } from './stage.engine.js';
import { canWorkStage } from './task.service.js';
import {
  MIRROR_KIND,
  createMirrorForStage,
  detachMirrorForStage,
  holdMirrorForStage,
  mirrorRefOf,
  ensureStageTask,
} from './stageMirror.service.js';
import {
  O2D_AUDIT_ACTIONS, ORDER_STATUS, STAGE_STATUS, TERMINAL_STAGE_STATUSES,
} from '../../shared/constants/o2d.js';

/**
 * May `actor` hand this stage to somebody else?
 *
 * The same people who could complete it themselves, today, by role — assigning
 * it to a named person is a narrower act than completing it, so nobody without
 * a completion permission gains one by way of the assign button. Super Admin,
 * as everywhere else in O2D, is unrestricted.
 */
async function assertMayAssign(actor, stageNumber) {
  if (isSuperAdmin(actor)) return;
  if (await canWorkStage(actor, stageNumber)) return;
  throw new O2dWorkflowError(
    `You do not work this stage, so you cannot hand it to somebody else.`,
    { status: 403, code: 'O2D_NOT_YOUR_STAGE' },
  );
}

/**
 * Hand one stage to one named person.
 *
 * Reassigning an already-assigned stage is allowed — the OLD mirror is closed
 * out with a note explaining why (not deleted: §29's soft-delete ethos applies
 * here too, and an assignee who had already started the work deserves a record
 * that says so), and a fresh mirror is created for the new assignee.
 */
export async function assignStageToUser({ orderId, stageNumber, userId, actor, req = null }) {
  await assertMayAssign(actor, stageNumber);

  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  const stage = await O2dOrderStage.findOne({ order: orderId, stageNumber });
  if (!stage) throw new O2dWorkflowError(`Stage ${stageNumber} does not exist on this order.`, { status: 404 });

  if (TERMINAL_STAGE_STATUSES.includes(stage.status)) {
    throw new O2dWorkflowError(
      `${stage.stageName} is already ${stage.status === 'SKIPPED' ? 'skipped' : 'complete'} — there is nothing left to assign.`,
      { code: 'O2D_STAGE_DONE' },
    );
  }

  const assignee = await User.findById(userId).lean();
  if (!assignee) throw new O2dWorkflowError('That user does not exist.', { status: 404 });

  if (String(stage.assignedTo) === String(userId)) {
    throw new O2dWorkflowError(`${stage.stageName} is already assigned to ${assignee.user ?? assignee.email}.`, {
      code: 'O2D_ALREADY_ASSIGNED',
    });
  }

  const now = new Date();
  const previousAssigneeName = stage.assignedToName;

  // Detach the old mirror FIRST — whichever surface it lives on, the unique
  // partial index on `sourceStageId` means the new mirror cannot claim this
  // stage until the old one lets go.
  if (mirrorRefOf(stage).id) {
    await detachMirrorForStage(stage, {
      actor,
      at: now,
      reason: `Reassigned to ${assignee.user ?? assignee.email}.`,
      // Recorded structurally, not only in the remark prose: "who did this go
      // to" is a question reporting has to be able to ASK, not just read.
      reassignedTo: assignee._id,
    });
  }

  const { kind, doc: mirror } = await createMirrorForStage({ order, stage, assignee, actor });

  stage.assignedTo = assignee._id;
  stage.assignedToName = assignee.user ?? assignee.email ?? null;
  stage.assignedBy = actor?._id ?? null;
  stage.assignedAt = now;
  // Both, always — see the note at the top of this file.
  stage.delegationId = kind === MIRROR_KIND.DELEGATION ? mirror._id : null;
  stage.checklistOccurrenceId = kind === MIRROR_KIND.CHECKLIST ? mirror._id : null;
  await stage.save();

  /*
   * A stage can be assigned while its order is already parked — somebody lines
   * up who will pick a held order back up, or names an owner on an order that
   * is about to be revived. Nothing on a parked order is workable, so a mirror
   * born Pending would sit in that person's Work Queue as live work, which is
   * the same divergence `holdOrder` and `exitOrder` close from the other
   * direction. Born held, so the two screens agree from the first second
   * rather than from the next hold.
   *
   * Keyed on the ORDER, not on `stage.status`, and that is load-bearing: a
   * stage still LOCKED behind its predecessor keeps that status through a hold
   * (only the open ones are moved to ON_HOLD), so a stage-level test would let
   * exactly the advance-assignment case through — the one this is for.
   */
  if (order.status !== ORDER_STATUS.OPEN) {
    await holdMirrorForStage(stage, {
      actor,
      at: now,
      reason: `${order.poNumber} is ${order.status.toLowerCase()}`,
    });
  }

  await recordAudit(
    actor,
    O2D_AUDIT_ACTIONS.STAGE_ASSIGNED,
    `${stage.stageName} on ${order.poNumber} assigned to ${stage.assignedToName}`
      + (previousAssigneeName ? ` (was ${previousAssigneeName})` : ''),
    req,
    {
      meta: {
        orderId: String(order._id),
        poNumber: order.poNumber,
        stageNumber,
        assignedTo: String(assignee._id),
        assignedToName: stage.assignedToName,
        previousAssigneeName: previousAssigneeName ?? null,
        mirrorKind: kind,
        mirrorId: String(mirror._id),
      },
    },
  );

  // `delegation` is kept in the return for the callers that predate Checklist
  // routing; it is null for a stage that mirrored onto Checklist instead.
  return {
    stage,
    mirrorKind: kind,
    mirror,
    delegation: kind === MIRROR_KIND.DELEGATION ? mirror : null,
  };
}

/** Take a stage back off whoever it was assigned to, closing their mirror. */
export async function unassignStage({ orderId, stageNumber, actor, req = null }) {
  await assertMayAssign(actor, stageNumber);

  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  const stage = await O2dOrderStage.findOne({ order: orderId, stageNumber });
  if (!stage) throw new O2dWorkflowError(`Stage ${stageNumber} does not exist on this order.`, { status: 404 });

  if (!stage.assignedTo) {
    throw new O2dWorkflowError(`${stage.stageName} is not currently assigned to anyone.`, { code: 'O2D_NOT_ASSIGNED' });
  }

  const previousName = stage.assignedToName;
  if (mirrorRefOf(stage).id) {
    // No `reassignedTo`: the work went back to the role queue, not to a named
    // person. Same terminal state either way — it left this person, and they
    // did not finish it.
    await detachMirrorForStage(stage, { actor, reason: 'Unassigned from Order Tracker.' });
  }

  stage.assignedTo = null;
  stage.assignedToName = null;
  stage.assignedBy = null;
  stage.assignedAt = null;
  stage.delegationId = null;
  stage.checklistOccurrenceId = null;
  // Still open, so it goes back to the whole team's Checklist.
  if (!TERMINAL_STAGE_STATUSES.includes(stage.status) && stage.status !== STAGE_STATUS.LOCKED) {
    await ensureStageTask(stage, { order });
  }
  await stage.save();

  await recordAudit(
    actor,
    O2D_AUDIT_ACTIONS.STAGE_UNASSIGNED,
    `${stage.stageName} on ${order.poNumber} unassigned (was ${previousName})`,
    req,
    { meta: { orderId: String(order._id), poNumber: order.poNumber, stageNumber, previousAssigneeName: previousName } },
  );

  return { stage };
}

/**
 * May `actor` complete the stage behind THIS mirrored task?
 *
 * Being the mirror's `doerId` is, by itself, enough — that is the entire point
 * of assigning a stage to a named person: they can now act on it without
 * needing their ROLE to be the one the stage master names. Anyone who could
 * complete it anyway (their role, or Super Admin) may also use this door, which
 * matters for the case where a manager finishes a report's task for them.
 */
export async function assertMayCompleteMirroredStage(actor, { doerId, stageNumber }) {
  // `doerId` on the mirror IS `stage.assignedTo` — the two are set together in
  // `assignStageToUser` — so this is the exact same question `canWorkStage`
  // already answers for Order Tracker's own Complete button. One function,
  // never two copies of "who may work this stage" drifting apart.
  if (await canWorkStage(actor, stageNumber, { assignedTo: doerId })) return;
  throw new O2dWorkflowError(
    'You are not the person this task is assigned to, and your role does not complete this stage.',
    { status: 403, code: 'O2D_NOT_YOUR_STAGE' },
  );
}

/**
 * Whoever the mirror says owes the work, whichever surface it lives on.
 *
 * Delegation calls that person `doerId` and Checklist calls them `doer`. The
 * difference is two collections' history, not a distinction worth propagating
 * into the permission check, so it is flattened here and nowhere else.
 */
export const doerIdOf = (mirror) => mirror?.doerId ?? mirror?.doer ?? null;

/**
 * Complete the REAL stage behind a mirrored task — a Delegation or a Checklist
 * occurrence, indifferently.
 *
 * This is the one door out of "the mirror's status is not this assignee's to
 * decide": completing it here runs the actual `completeStage` — the same
 * ordering checks, the same required evidence, the same SLA math the Order
 * Tracker's own Complete button runs — and lets ITS OWN hook update this same
 * mirror to Completed. Nothing here writes to the mirror directly; if it did,
 * a rejected completion (missing evidence, an incomplete predecessor) could
 * leave the mirror saying Completed while the real stage still is not.
 *
 * That indifference is the whole point of routing every surface through one
 * function: Checklist's Complete button and Delegation's cannot drift into
 * enforcing two different ideas of when a stage is finished, because there is
 * only one idea and neither of them owns it.
 */
export async function completeMirroredTask(mirror, { actor, evidence = null, remarks = null, req = null }) {
  await assertMayCompleteMirroredStage(actor, {
    doerId: doerIdOf(mirror),
    stageNumber: mirror.sourceStageNumber,
  });

  const { stage, order, events } = await completeStage({
    orderId: mirror.sourceOrderId,
    stageNumber: mirror.sourceStageNumber,
    actor,
    evidence,
    remarks,
  });

  return { stage, order, events };
}

export default {
  assignStageToUser,
  unassignStage,
  assertMayCompleteMirroredStage,
  completeMirroredTask,
  doerIdOf,
};
