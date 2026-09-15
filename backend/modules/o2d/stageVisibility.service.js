/**
 * Which stages of an order a given user may SEE.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 *
 *   Admin / Super Admin   every stage. They are accountable for the workflow
 *                         as a whole, and an order's progress is the thing
 *                         they are accountable FOR.
 *   Everyone else         only the stages their role is attached to — the ones
 *                         they close, and the ones they own but somebody else
 *                         records. Nothing else.
 *
 * "Attached to" is read from the STAGE MASTER, not from a constant, for the
 * same reason My Tasks reads it there: §37 lets an administrator reassign a
 * stage without a deploy, and a hardcoded map would keep showing an order's
 * progress to a team that no longer works it.
 *
 * ---------------------------------------------------------------------------
 * A LEAF, ON PURPOSE
 * ---------------------------------------------------------------------------
 *
 * `roleStageMap` already computes exactly this set, but it lives in
 * `task.service.js`, which imports `bucketFor` from `order.service.js`. Since
 * `order.service.js` is the main caller here, importing it back would be a
 * cycle. This module imports the stage master and nothing else, so every layer
 * can use it.
 *
 * ---------------------------------------------------------------------------
 * ⚠ WHAT HIDING STAGES COSTS, WRITTEN DOWN
 * ---------------------------------------------------------------------------
 *
 * A Billing user can no longer see that an order is sitting with the warehouse
 * at stage 7 — only their own stages appear. That IS the requirement, and it is
 * the right call for access control, but it is a real change to how people read
 * an order: "where is this?" was previously answerable by anyone.
 *
 * So the order's own `currentStage` is NOT hidden, and the filtered payload
 * reports how many stages were withheld. A viewer who sees four stages of a
 * twelve-stage workflow, with no indication the other eight exist, would
 * reasonably conclude the workflow has four stages — and act on it.
 */

import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';

/**
 * The stage numbers this user may see, or `null` for "all of them".
 *
 * Null rather than a list of twelve, so callers can skip the filter entirely
 * for an unrestricted viewer instead of comparing against a set that always
 * matches.
 */
export async function visibleStagesFor(user) {
  // No user at all means an internal call — a background job, a notification
  // render. Those are not a person looking at a screen and are not scoped.
  if (!user?.role) return null;
  if (isSuperAdmin(user)) return null;

  const masters = await O2dStageMaster.find({ enabled: true })
    .select('stageNumber ownerRole alsoAllowedRoles completedByRole')
    .lean();

  const visible = [];
  for (const m of masters) {
    const attached = [
      m.ownerRole,
      m.completedByRole,
      ...(m.alsoAllowedRoles ?? []),
    ].filter(Boolean);

    if (attached.includes(user.role)) visible.push(m.stageNumber);
  }
  return visible;
}

/**
 * Apply the rule to a list of stage rows.
 *
 * @returns {{stages: Array, hiddenStageCount: number, scoped: boolean}}
 */
export function applyStageVisibility(stages = [], visible) {
  if (visible === null) {
    return { stages, hiddenStageCount: 0, scoped: false };
  }
  const allowed = new Set(visible.map(Number));
  const kept = stages.filter((s) => allowed.has(Number(s.stageNumber)));
  return {
    stages: kept,
    // Counted, not listed. The reader learns the view is partial without
    // learning what is in the part they may not see.
    hiddenStageCount: stages.length - kept.length,
    scoped: true,
  };
}

/** May this user see this one stage? Used by the per-stage endpoints. */
export async function canSeeStage(user, stageNumber) {
  const visible = await visibleStagesFor(user);
  return visible === null || visible.includes(Number(stageNumber));
}

export default { visibleStagesFor, applyStageVisibility, canSeeStage };
