/**
 * Which task surface an O2D stage's task lives on, and the one set of verbs the
 * rest of the system uses to keep it in step.
 *
 * Every ACTIVE stage has exactly one live task: the named person's, or — when
 * nobody is named — a Checklist TEAM task that the whole responsible role sees
 * (see `ensureStageTask`). Never one of each, because two live copies of a
 * single stage is precisely the duplicate this design exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * THE ROUTING RULE, AND WHERE IT COMES FROM
 * ---------------------------------------------------------------------------
 *
 *   CHECKLIST    the stage declares required evidence fields. Finishing it
 *                means recording specific things: an invoice number and value,
 *                an AWB and a box count, an amount and a UTR. That is a
 *                checklist item in the ordinary sense — a list of things to
 *                record — and Checklist is the screen built for it.
 *
 *   DELEGATION   the stage declares none. Finishing it is a confirmation or a
 *                decision — receiving the order, deciding whether an advance
 *                is needed. That is a hand-off, which is what Delegation is.
 *
 * The rule reads the stage's OWN field specification (`fieldsForStage`) rather
 * than a hand-maintained list of stage numbers. An administrator who adds a
 * required field to a stage moves it to Checklist automatically, and one who
 * removes the last one moves it back — the classification cannot fall out of
 * step with the thing it classifies, because it is derived from it.
 *
 * ---------------------------------------------------------------------------
 * WHY A DISPATCHER RATHER THAN TWO SETS OF CALLS IN THE ENGINE
 * ---------------------------------------------------------------------------
 * `stage.engine.js` should not know there are two kinds of mirror. It knows a
 * stage was completed, skipped or unlocked, and says so once. Everything about
 * which collection that lands in lives here.
 *
 * Imports both mirror services and NEITHER imports the engine — see the note
 * at the top of `delegationMirror.service.js` for why that direction matters.
 */

import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
import User from '../../models/User.js';
import { fieldsForStage } from '../../shared/constants/o2dStageFields.js';
import { TERMINAL_STAGE_STATUSES, ORDER_STATUS } from '../../shared/constants/o2d.js';
import {
  createMirrorDelegation,
  resyncMirrorSchedule,
  markMirrorDone,
  markMirrorSkipped,
  holdMirror,
  releaseMirror,
  detachMirror,
} from './delegationMirror.service.js';
import {
  createChecklistMirror,
  resyncChecklistMirror,
  markChecklistMirrorDone,
  markChecklistMirrorSkipped,
  holdChecklistMirror,
  releaseChecklistMirror,
  detachChecklistMirror,
} from './checklistMirror.service.js';

export const MIRROR_KIND = Object.freeze({
  DELEGATION: 'delegation',
  CHECKLIST: 'checklist',
});

/**
 * Does this stage's completion mean RECORDING things, or confirming one?
 *
 * Exported because the assign endpoint reports it back to the screen, so the
 * person assigning can see where the task is about to land before they commit.
 */
export function mirrorKindForStage(stageNumber) {
  const required = (fieldsForStage(stageNumber) ?? []).filter((f) => f.required);
  return required.length > 0 ? MIRROR_KIND.CHECKLIST : MIRROR_KIND.DELEGATION;
}

/** Whichever mirror this stage currently has, if any. */
export function mirrorRefOf(stage) {
  if (stage?.checklistOccurrenceId) {
    return { kind: MIRROR_KIND.CHECKLIST, id: stage.checklistOccurrenceId };
  }
  if (stage?.delegationId) {
    return { kind: MIRROR_KIND.DELEGATION, id: stage.delegationId };
  }
  return { kind: null, id: null };
}

/**
 * Create the mirror this stage should have.
 *
 * Returns `{ kind, doc }` and the caller is responsible for writing the
 * resulting id onto the correct field of the stage — this service does not
 * touch the stage row, so that the whole assignment stays one save in
 * `assignStageToUser`.
 */
export async function createMirrorForStage({ order, stage, assignee, actor }) {
  const kind = mirrorKindForStage(stage.stageNumber);

  const doc = kind === MIRROR_KIND.CHECKLIST
    ? await createChecklistMirror({ order, stage, assignee, actor })
    : await createMirrorDelegation({ order, stage, assignee, actor });

  return { kind, doc };
}

export async function resyncMirrorForStage(stage, { order }) {
  const { kind, id } = mirrorRefOf(stage);
  if (!id) return;
  if (kind === MIRROR_KIND.CHECKLIST) await resyncChecklistMirror(id, { stage, order });
  else await resyncMirrorSchedule(id, { stage, order });
}

export async function markMirrorForStageDone(stage, opts) {
  const { kind, id } = mirrorRefOf(stage);
  if (!id) return;
  if (kind === MIRROR_KIND.CHECKLIST) await markChecklistMirrorDone(id, opts);
  else await markMirrorDone(id, opts);
}

/** Mutates the stage's link when an unclaimed team task is removed; the caller saves. */
export async function markMirrorForStageSkipped(stage, opts) {
  const { kind, id } = mirrorRefOf(stage);
  if (!id) return;
  if (kind === MIRROR_KIND.CHECKLIST) {
    const result = await markChecklistMirrorSkipped(id, opts);
    if (result?.removed) stage.checklistOccurrenceId = null;
  } else {
    await markMirrorSkipped(id, opts);
  }
}

const setMirrorIds = (stage, kind, id) => {
  stage.delegationId = kind === MIRROR_KIND.DELEGATION ? id : null;
  stage.checklistOccurrenceId = kind === MIRROR_KIND.CHECKLIST ? id : null;
};

/** The role that completes this stage — who a team task belongs to. */
async function teamFor(stage) {
  const master = await O2dStageMaster.findOne({ stageNumber: stage.stageNumber })
    .select('ownerRole completedByRole')
    .lean();
  return master?.completedByRole || master?.ownerRole || stage.ownerRole;
}

/**
 * Give an ACTIVE stage its task, if it has none yet.
 *
 *   named person   their task, on Checklist or Delegation by the stage's kind
 *   nobody named   a Checklist TEAM task for the responsible role. A decision
 *                  stage (Delegation kind) gets none — a Delegation needs one doer.
 *
 * Born parked when the order is not live, like an assignment on a held order.
 * Mutates the stage's link fields; the caller saves.
 */
export async function ensureStageTask(stage, { order }) {
  if (mirrorRefOf(stage).id) {
    await resyncMirrorForStage(stage, { order });
    return;
  }

  const kind = mirrorKindForStage(stage.stageNumber);
  let doc = null;

  if (stage.assignedTo) {
    const assignee = (await User.findById(stage.assignedTo).lean())
      ?? { _id: stage.assignedTo, user: stage.assignedToName };
    const assigner = stage.assignedBy ? await User.findById(stage.assignedBy).lean() : null;
    ({ doc } = await createMirrorForStage({ order, stage, assignee, actor: assigner }));
  } else if (kind === MIRROR_KIND.CHECKLIST) {
    doc = await createChecklistMirror({ order, stage, assignee: null, team: await teamFor(stage) });
  }
  if (!doc) return;

  setMirrorIds(stage, kind, doc._id);
  if (order.status !== ORDER_STATUS.OPEN) {
    await holdMirrorForStage(stage, { reason: `${order.poNumber} is ${order.status.toLowerCase()}` });
  }
}

/**
 * Take the live task off a stage that is no longer workable — sent back to
 * LOCKED by a rework, or about to be given a fresh task. The old row is kept
 * as history (a real completion keeps its credit). Mutates the stage's link
 * fields; the caller saves.
 */
export async function releaseStageTask(stage, { actor = null, at = new Date(), reason }) {
  if (!mirrorRefOf(stage).id) return;
  await detachMirrorForStage(stage, { actor, at, reason });
  stage.delegationId = null;
  stage.checklistOccurrenceId = null;
}

/**
 * The order behind this stage was parked — held, cancelled or voided — so the
 * mirrored task stops being live work.
 *
 * Parked, not resolved: `markMirrorForStageDone` and `...Skipped` both say the
 * stage REACHED something, and neither is true here. The stage is still owed;
 * it is simply not owed today, which is the one thing My Tasks and the Work
 * Queue have to agree about.
 */
export async function holdMirrorForStage(stage, opts) {
  const { kind, id } = mirrorRefOf(stage);
  if (!id) return;
  if (kind === MIRROR_KIND.CHECKLIST) await holdChecklistMirror(id, opts);
  else await holdMirror(id, opts);
}

/** The order is live again — give the mirrored task back to its doer. */
export async function releaseMirrorForStage(stage, opts) {
  const { kind, id } = mirrorRefOf(stage);
  if (!id) return;
  if (kind === MIRROR_KIND.CHECKLIST) await releaseChecklistMirror(id, opts);
  else await releaseMirror(id, opts);
}

/**
 * Every stage on this order that still owes work AND has a mirror to move.
 *
 * Terminal stages are excluded: their mirrors were already resolved — closed
 * by the completion, or marked non-functional by the skip — and parking a
 * finished task would push a "paused" remark onto a record nobody is waiting
 * on, then a second one when the order comes back.
 */
async function mirroredStagesOf(orderId) {
  return O2dOrderStage.find({
    order: orderId,
    status: { $nin: TERMINAL_STAGE_STATUSES },
    $or: [
      { delegationId: { $ne: null } },
      { checklistOccurrenceId: { $ne: null } },
    ],
  });
}

/**
 * The order stopped being live — park every task hanging off it.
 *
 * ORDER-level, not stage-level, and that is the whole design. A hold freezes
 * the stages that were OPEN; it leaves the ones behind them LOCKED, and a
 * LOCKED stage can perfectly well have been assigned already (somebody lining
 * up who picks up stage 7 when it arrives). Walking the order rather than the
 * rows one particular transition happened to touch is what makes the invariant
 * statable in one sentence — *a mirror is parked exactly when its order is not
 * live* — instead of a list of special cases that each transition has to
 * remember.
 */
export async function holdMirrorsForOrder(orderId, opts) {
  for (const stage of await mirroredStagesOf(orderId)) {
    await holdMirrorForStage(stage, opts);
  }
}

/** The order is live again — hand every parked task back to its doer. */
export async function releaseMirrorsForOrder(orderId, opts) {
  for (const stage of await mirroredStagesOf(orderId)) {
    await releaseMirrorForStage(stage, opts);
  }
}

export async function detachMirrorForStage(stage, opts) {
  const { kind, id } = mirrorRefOf(stage);
  if (!id) return;
  if (kind === MIRROR_KIND.CHECKLIST) await detachChecklistMirror(id, opts);
  else await detachMirror(id, opts);
}

export default {
  MIRROR_KIND,
  mirrorKindForStage,
  mirrorRefOf,
  createMirrorForStage,
  resyncMirrorForStage,
  markMirrorForStageDone,
  markMirrorForStageSkipped,
  holdMirrorForStage,
  releaseMirrorForStage,
  holdMirrorsForOrder,
  releaseMirrorsForOrder,
  detachMirrorForStage,
  ensureStageTask,
  releaseStageTask,
};
