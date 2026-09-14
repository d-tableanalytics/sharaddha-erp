/**
 * Recording what every stage did, and when.
 *
 * ---------------------------------------------------------------------------
 * ONE DOOR, SO A TRANSITION CANNOT GO UNRECORDED
 * ---------------------------------------------------------------------------
 *
 * A stage's status is written from nine places — creation, unlock, completion,
 * skip, hold, resume, the sweep's two deadline moves, and a reopen. A history
 * that each of those writes to SEPARATELY is a history that is one forgotten
 * line away from being wrong, and wrong in the way nobody notices: the row that
 * is missing looks exactly like a transition that never happened.
 *
 * So `setStageStatus` does both — it sets the field AND appends the event — and
 * the engine calls it instead of assigning `stage.status`. The pairing is the
 * point. Adding a tenth transition that forgets the history means not using the
 * helper at all, which is visible in review; assigning the field directly is not.
 *
 * ---------------------------------------------------------------------------
 * NEVER THROWS
 * ---------------------------------------------------------------------------
 *
 * Same rule the notifier follows, for the same reason. The warehouse must not
 * be unable to record a picked order because a history insert failed. A lost
 * event is logged to the server output so a broken trail is visible, rather
 * than rolling back the fact it was describing.
 */

import { O2dStageEvent, STAGE_EVENT_SOURCES } from '../../models/o2d/O2dStageEvent.js';

export { STAGE_EVENT_SOURCES };

/**
 * Append one event. Returns nothing anybody waits on.
 *
 * `from` is read from the stage BEFORE the caller changes it, so this is only
 * ever called by `setStageStatus` or by a bulk helper that captured the prior
 * value itself.
 */
export async function recordStageEvent({
  order = null,
  poNumber = null,
  stage,
  from = null,
  to,
  source,
  actor = null,
  reason = null,
  meta = null,
  at = null,
  session = null,
} = {}) {
  try {
    const doc = {
      order: order?._id ?? order ?? stage?.order,
      poNumber: poNumber ?? order?.poNumber ?? null,
      stageNumber: stage.stageNumber,
      stageName: stage.stageName,
      from,
      to,
      at: at ?? new Date(),
      source,
      actor: actor?._id ?? null,
      // Snapshotted: the account may be renamed or deactivated later, and a
      // history rendering "unknown user" for last year is not a history.
      actorName: actor?.user ?? actor?.name ?? actor?.email ?? null,
      actorRole: actor?.role ?? null,
      reason,
      meta,
    };
    await O2dStageEvent.create(session ? [doc] : [doc], session ? { session } : {});
  } catch (error) {
    console.error(
      `[O2D/History] Could not record stage ${stage?.stageNumber} ${from} -> ${to}:`,
      error.message,
    );
  }
}

/**
 * Move a stage to a new status AND record the move.
 *
 * Mutates `stage.status`; the caller still owns saving it, because most callers
 * are mid-way through setting other fields on the same document and a save here
 * would write a half-built row.
 *
 * A no-op transition records nothing: the sweep re-reads stages it has already
 * flagged, and a row saying OVERDUE -> OVERDUE every five minutes would bury
 * the real timeline within a day.
 */
export async function setStageStatus(stage, to, {
  order = null,
  source = STAGE_EVENT_SOURCES.WORKFLOW,
  actor = null,
  reason = null,
  meta = null,
  at = null,
  session = null,
} = {}) {
  const from = stage.status ?? null;
  if (from === to) return stage;

  stage.status = to;
  await recordStageEvent({ order, stage, from, to, source, actor, reason, meta, at, session });
  return stage;
}

/**
 * The same move across many stages at once — a hold freezing everything open,
 * a resume thawing it.
 *
 * Takes the stage DOCUMENTS rather than a filter, because the prior status has
 * to be read per stage before the bulk write changes it. A `updateMany` on its
 * own cannot tell you what it overwrote, which is precisely the fact the
 * history exists to keep.
 */
export async function recordBulkTransition(stages = [], to, {
  order = null,
  source = STAGE_EVENT_SOURCES.ORDER,
  actor = null,
  reason = null,
  meta = null,
  at = null,
} = {}) {
  for (const stage of stages) {
    const from = stage.status ?? null;
    if (from === to) continue;
    await recordStageEvent({ order, stage, from, to, source, actor, reason, meta, at });
  }
}

/**
 * The timeline, oldest first.
 *
 * Oldest first because it is read as a narrative — "it opened, went overdue,
 * was held, resumed, closed late" — and a reversed list makes the reader
 * assemble that backwards.
 */
export async function stageHistory(orderId, { stageNumber = null } = {}) {
  const filter = { order: orderId };
  if (stageNumber != null) filter.stageNumber = Number(stageNumber);
  return O2dStageEvent.find(filter).sort({ at: 1, _id: 1 }).lean();
}

export default { recordStageEvent, setStageStatus, recordBulkTransition, stageHistory, STAGE_EVENT_SOURCES };
