/**
 * Linking an O2D stage to one specific person's Work Queue.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROVES
 * ---------------------------------------------------------------------------
 * An O2D stage is owned by a ROLE, never a person — `task.service.js` says so
 * explicitly. Assigning a stage to a named user layers a person on top of that,
 * and mirrors it as a real Work Queue task so it shows up on that person's own
 * screens.
 *
 * ONE assignment produces ONE mirror, on one of two surfaces: a Checklist
 * occurrence when finishing the stage means RECORDING specific evidence, a
 * Delegation when it means confirming something happened. Both surfaces are
 * exercised below, because the guarantees are the same on each and the bug
 * worth fearing is one of them quietly behaving differently.
 *
 * The mirror is not a snapshot taken once:
 *
 *   - completing the STAGE (from Order Tracker) must complete the MIRROR.
 *   - completing the MIRROR (from the Work Queue) must complete the STAGE —
 *     running the real evidence and ordering checks, not a copy of them.
 *   - reassigning a stage must close the OLD mirror rather than leave two
 *     live tasks pointing at the same piece of work.
 *   - a rejection on one side (missing evidence, wrong permission) must be the
 *     SAME rejection on the other — never a silent divergence.
 *
 * Uses mongod: the guarantee under test includes a real unique index (one live
 * mirror per stage) and a real database write on both sides of the link.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import User from '../models/User.js';
import { O2dOrder, o2dKey } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { Delegation, DELEGATION_REASSIGNED_AWAY } from '../models/Delegation.js';
import { ChecklistRoutine, ChecklistOccurrence, OCCURRENCE_REASSIGNED_AWAY } from '../models/Checklist.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import {
  createStagesForOrder,
  completeStage,
  skipStage,
  holdOrder,
  resumeOrder,
  O2dWorkflowError,
} from '../modules/o2d/stage.engine.js';
import { cancelOrder, voidOrder, reviveOrder } from '../modules/o2d/exit.service.js';
import {
  assignStageToUser,
  unassignStage,
  completeMirroredTask,
} from '../modules/o2d/o2dDelegationSync.service.js';
import { mirrorKindForStage, MIRROR_KIND, mirrorRefOf } from '../modules/o2d/stageMirror.service.js';
import { myTasks, canWorkStage } from '../modules/o2d/task.service.js';
import { closeStage } from './helpers/o2dStage.js';
import { STAGES } from '../shared/constants/o2d.js';
import { buildTestApp, stubProtect, withServer, get, post, put, patch, del } from './helpers/http.js';
import o2dRoutes from '../modules/o2d/o2d.routes.js';
import delegationRoutes from '../modules/delegation/delegation.routes.js';
import checklistRoutes from '../modules/checklist/checklist.routes.js';
import scoreboardRoutes from '../modules/scoreboard/scoreboard.routes.js';
import { markMirrorDone, detachMirror } from '../modules/o2d/delegationMirror.service.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);

before(async () => {
  // o2d.routes.js's domain fence reads this at mount time.
  process.env.PORTAL = 'employee';
  await startTestMongo();
  await syncIndexes(
    O2dOrder, O2dOrderStage, O2dStageMaster, Delegation, ChecklistRoutine, ChecklistOccurrence, User,
  );
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

let seq = 0;
async function account(role) {
  seq += 1;
  return User.create({
    email: `sync${seq}@example.com`,
    password: 'x'.repeat(12),
    user: `Test ${role} ${seq}`,
    role,
    status: 'Active',
  });
}

/** An order with stage 1 done, stage 2 done (Billing), so stage 3 is open. */
const orderAtStage3 = async (billing) => {
  const order = await O2dOrder.create({
    poNumber: `PO-SYNC-${seq}`,
    poNumberKey: o2dKey(`PO-SYNC-${seq}`),
    poDate: ist('2026-09-14', '09:00'),
    customerName: 'ABC Industries',
    customerKey: o2dKey('ABC Industries'),
    promiseDate: ist('2026-09-25', '10:00'),
  });
  await createStagesForOrder(order, { actor: { user: 'Sales', role: 'Sales' }, now: ist('2026-09-14', '10:00') });
  await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing, now: ist('2026-09-14', '11:00') });
  return O2dOrder.findById(order._id);
};

/** …and stage 3 closed too, so stage 4 (Advance decision) is the open one. */
const orderAtStage4 = async (billing) => {
  const order = await orderAtStage3(billing);
  await closeStage({
    orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, actor: billing, now: ist('2026-09-14', '12:00'),
  });
  return O2dOrder.findById(order._id);
};

const stageOf = (orderId, n) => O2dOrderStage.findOne({ order: orderId, stageNumber: n });

/**
 * The two stages this file leans on, and why each one.
 *
 * Stage 4 (Advance decision) declares NO required fields — finishing it is a
 * decision — so it routes to Delegation. Stage 3 (Send SOR/PI) requires a PI
 * number and an SOR reference, so it routes to Checklist. Named rather than
 * inlined because which surface a test is about is the point of the test, not
 * an incidental fixture choice, and a stage gaining or losing a required field
 * would otherwise silently move a whole block of assertions to the other file.
 */
const DELEGATION_STAGE = STAGES.ADVANCE_DECISION;
const CHECKLIST_STAGE = STAGES.SEND_SOR_PI;

/** The one live Checklist occurrence mirroring this stage, if any. */
const occurrenceFor = (stageId) => ChecklistOccurrence.findOne({ sourceStageId: stageId }).lean();

// ===========================================================================

describe('which surface a stage is mirrored onto', () => {
  test('a stage that requires evidence goes to Checklist; one that does not goes to Delegation', () => {
    // Derived from each stage's OWN field spec, never a hand-kept list — see
    // `mirrorKindForStage`. These two are the fixtures the rest of the file
    // uses, so a change to either specification fails here first, loudly,
    // rather than as a puzzling failure forty tests later.
    assert.equal(mirrorKindForStage(DELEGATION_STAGE), MIRROR_KIND.DELEGATION);
    assert.equal(mirrorKindForStage(CHECKLIST_STAGE), MIRROR_KIND.CHECKLIST);
  });

  test('every stage routes somewhere, and never to both', () => {
    for (let n = 1; n <= 12; n += 1) {
      const kind = mirrorKindForStage(n);
      assert.ok(
        kind === MIRROR_KIND.CHECKLIST || kind === MIRROR_KIND.DELEGATION,
        `stage ${n} must mirror onto exactly one surface`,
      );
    }
  });

  test('an assignment writes ONE mirror id onto the stage and nulls the other', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);

    const checklistSide = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });
    assert.equal(checklistSide.mirrorKind, MIRROR_KIND.CHECKLIST);
    assert.ok(checklistSide.stage.checklistOccurrenceId);
    assert.equal(checklistSide.stage.delegationId, null);
    assert.equal(checklistSide.delegation, null);

    const delegationSide = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });
    assert.equal(delegationSide.mirrorKind, MIRROR_KIND.DELEGATION);
    assert.ok(delegationSide.stage.delegationId);
    assert.equal(delegationSide.stage.checklistOccurrenceId, null);

    // One stage, one task — nothing landed on both lists.
    assert.equal(await Delegation.countDocuments({ sourceStageId: checklistSide.stage._id }), 0);
    assert.equal(await ChecklistOccurrence.countDocuments({ sourceStageId: delegationSide.stage._id }), 0);
  });
});

// ===========================================================================

describe('assigning a stage to a person', () => {
  test('creates a real Delegation document, and links it back to the stage', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);

    const { stage, delegation } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });

    assert.equal(String(stage.assignedTo), String(billing._id));
    assert.equal(stage.assignedToName, billing.user);
    assert.equal(String(stage.delegationId), String(delegation._id));

    assert.equal(delegation.sourceType, 'o2d_stage');
    assert.equal(String(delegation.sourceOrderId), String(order._id));
    assert.equal(delegation.sourceStageNumber, DELEGATION_STAGE);
    assert.equal(String(delegation.doerId), String(billing._id));
    assert.match(delegation.taskTitle, new RegExp(order.poNumber));
    assert.equal(delegation.status, 'Pending');

    // It is a REAL delegation — found by the ordinary My Work query.
    const mine = await Delegation.find({ doerId: billing._id, isDeleted: false }).lean();
    assert.equal(mine.length, 1);
  });

  test('a stage that requires evidence creates a real Checklist occurrence instead', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);

    const { stage, mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });

    assert.equal(String(stage.checklistOccurrenceId), String(mirror._id));
    assert.equal(mirror.sourceType, 'o2d_stage');
    assert.equal(String(mirror.sourceOrderId), String(order._id));
    assert.equal(mirror.sourceStageNumber, CHECKLIST_STAGE);
    assert.equal(String(mirror.doer), String(billing._id));
    assert.equal(mirror.status, 'pending');
    assert.match(mirror.taskName, new RegExp(order.poNumber));

    // The occurrence hangs off a real routine, coded by order and stage so it
    // stays recognisable however many times the stage changes hands.
    const routine = await ChecklistRoutine.findById(mirror.routine).lean();
    assert.equal(routine.sourceType, 'o2d_stage');
    assert.equal(routine.frequency, 'once');
    assert.equal(routine.taskCode, `O2D-${order.poNumber}-S${CHECKLIST_STAGE}`.toUpperCase());

    // The department is the stage OWNING ROLE — Sales, Billing, Accounts —
    // which is what the Checklist screens group and report by.
    assert.equal(mirror.department, stage.ownerRole);

    // Found by the ordinary Checklist query that a non-manager list runs. Only
    // one LIVE row: the other row this user owns is the stage-2 team task they
    // completed in `orderAtStage3`, credited to them as its doer.
    assert.equal(await ChecklistOccurrence.countDocuments({ doer: billing._id, status: 'pending' }), 1);
  });

  test('refuses a stage that does not exist, and a user that does not exist', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);

    await assert.rejects(
      () => assignStageToUser({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: '652f0000000000000000ffff', actor: billing }),
      O2dWorkflowError,
    );
  });

  test('refuses somebody whose role does not work this stage', async () => {
    const billing = await account('Billing');
    const warehouse = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assert.rejects(
      () => assignStageToUser({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: billing._id, actor: warehouse }),
      (err) => err instanceof O2dWorkflowError && err.code === 'O2D_NOT_YOUR_STAGE',
    );
  });

  test('reassigning closes the old mirror rather than leaving two live tasks', async () => {
    const billing = await account('Billing');
    const other = await account('Billing');
    const order = await orderAtStage3(billing);

    const first = await assignStageToUser({ orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing });
    const second = await assignStageToUser({ orderId: order._id, stageNumber: DELEGATION_STAGE, userId: other._id, actor: billing });

    assert.notEqual(String(first.delegation._id), String(second.delegation._id));

    const oldOne = await Delegation.findById(first.delegation._id).lean();
    /*
     * `Reassigned`, NOT `Completed` — this row used to claim the latter, which
     * scored a finished, on-time task for somebody who had just been relieved
     * of it. See `DELEGATION_REASSIGNED_AWAY`.
     */
    assert.equal(oldOne.status, DELEGATION_REASSIGNED_AWAY);
    assert.equal(oldOne.completedAt, null, 'a hand-off must not stamp a completion time');
    assert.equal(String(oldOne.reassignedTo), String(other._id), 'the trail says where it went');
    assert.equal(String(oldOne.reassignedBy), String(billing._id), '…and who moved it');
    assert.equal(oldOne.sourceStageId, null); // detached — no longer the live mirror
    assert.ok(oldOne.remarks.some((r) => /Reassigned/.test(r.text)));

    const stage = await stageOf(order._id, DELEGATION_STAGE);
    assert.equal(String(stage.delegationId), String(second.delegation._id));
    assert.equal(String(stage.assignedTo), String(other._id));

    // Exactly one LIVE mirror on this stage, satisfying the partial unique index.
    const live = await Delegation.countDocuments({ sourceStageId: stage._id });
    assert.equal(live, 1);
  });

  test('reassigning a Checklist-mirrored stage closes the old occurrence and reuses the routine', async () => {
    const billing = await account('Billing');
    const other = await account('Billing');
    const order = await orderAtStage3(billing);

    const first = await assignStageToUser({ orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing });
    const second = await assignStageToUser({ orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: other._id, actor: billing });

    assert.notEqual(String(first.mirror._id), String(second.mirror._id));

    const oldOne = await ChecklistOccurrence.findById(first.mirror._id).lean();
    assert.equal(oldOne.sourceStageId, null); // detached — no longer the live mirror
    assert.ok(oldOne.remarks.some((r) => /Reassigned/.test(r.text)));

    const stage = await stageOf(order._id, CHECKLIST_STAGE);
    assert.equal(String(stage.checklistOccurrenceId), String(second.mirror._id));
    assert.equal(String(stage.assignedTo), String(other._id));
    assert.equal(await ChecklistOccurrence.countDocuments({ sourceStageId: stage._id }), 1);

    // The ROUTINE is the stable identity of the stage — the work did not
    // change, only who owes it — so the second assignee inherits it rather
    // than spawning a second definition of the same task.
    assert.equal(String(first.mirror.routine), String(second.mirror.routine));
    assert.equal(await ChecklistRoutine.countDocuments({ sourceStageId: stage._id }), 1);
  });

  test('unassigning clears the stage and closes the mirror', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { delegation } = await assignStageToUser({ orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing });

    await unassignStage({ orderId: order._id, stageNumber: DELEGATION_STAGE, actor: billing });

    const stage = await stageOf(order._id, DELEGATION_STAGE);
    assert.equal(stage.assignedTo, null);
    assert.equal(stage.delegationId, null);
    assert.equal(stage.checklistOccurrenceId, null);

    const closed = await Delegation.findById(delegation._id).lean();
    // Unassignment is the same act with no named destination: the work went
    // back to the role queue. Not completed by the person it was taken from.
    assert.equal(closed.status, DELEGATION_REASSIGNED_AWAY);
    assert.equal(closed.completedAt, null);
    assert.equal(closed.reassignedTo, null, 'nobody was named — it went back to the role');
    assert.equal(closed.sourceStageId, null);
  });

  test('unassigning a Checklist-mirrored stage closes the person’s occurrence and hands it back to the team', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({ orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing });

    await unassignStage({ orderId: order._id, stageNumber: CHECKLIST_STAGE, actor: billing });

    const stage = await stageOf(order._id, CHECKLIST_STAGE);
    assert.equal(stage.assignedTo, null);
    assert.equal(stage.delegationId, null);

    const closed = await ChecklistOccurrence.findById(mirror._id).lean();
    assert.equal(closed.sourceStageId, null);
    assert.ok(closed.remarks.some((r) => /Unassigned/.test(r.text)));

    // Still open, so the whole role gets it back as a team task.
    assert.ok(stage.checklistOccurrenceId, 'a fresh team task is linked');
    assert.notEqual(String(stage.checklistOccurrenceId), String(mirror._id));
    const team = await ChecklistOccurrence.findById(stage.checklistOccurrenceId).lean();
    assert.equal(team.doer, null);
    assert.equal(team.status, 'pending');
  });
});

describe('completing the stage from Order Tracker syncs the mirror', () => {
  test('closing the real stage marks the mirror Completed', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { delegation } = await assignStageToUser({ orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing });

    assert.equal((await Delegation.findById(delegation._id)).status, 'Pending');

    await closeStage({ orderId: order._id, stageNumber: DELEGATION_STAGE, actor: billing });

    const synced = await Delegation.findById(delegation._id).lean();
    assert.equal(synced.status, 'Completed');
    assert.ok(synced.completedAt);
    assert.ok(synced.verifiedAt);
    assert.equal(String(synced.verifiedBy), String(billing._id));
    assert.ok(synced.remarks.some((r) => /automatically/i.test(r.text)));
  });

  test('closing a Checklist-mirrored stage marks the occurrence completed', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({ orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing });

    assert.equal((await ChecklistOccurrence.findById(mirror._id)).status, 'pending');

    await closeStage({ orderId: order._id, stageNumber: CHECKLIST_STAGE, actor: billing });

    const synced = await ChecklistOccurrence.findById(mirror._id).lean();
    assert.equal(synced.status, 'completed');
    assert.ok(synced.completedDate);
    assert.equal(String(synced.completedBy), String(billing._id));
    assert.ok(synced.remarks.some((r) => /automatically/i.test(r.text)));
  });

  test('skipping the real stage closes the mirror without counting it as a completion', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);

    // Stage 5 (RECEIVE_ADVANCE) is the only skippable stage, and only skips
    // when stage 4 says no advance was required — reach it via stage 3 then 4.
    await closeStage({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, actor: billing });
    await completeStage({
      orderId: order._id,
      stageNumber: STAGES.ADVANCE_DECISION,
      actor: billing,
      evidence: { advanceRequired: false },
    });

    const accounts = await account('Accounts');
    const { mirrorKind, mirror } = await assignStageToUser({ orderId: order._id, stageNumber: STAGES.RECEIVE_ADVANCE, userId: accounts._id, actor: accounts });

    // Stage 5 wants an amount, a UTR and a date, so it mirrors onto Checklist.
    assert.equal(mirrorKind, MIRROR_KIND.CHECKLIST);

    await skipStage({ orderId: order._id, stageNumber: STAGES.RECEIVE_ADVANCE, reason: 'No advance on this order', actor: accounts });

    const synced = await ChecklistOccurrence.findById(mirror._id).lean();

    /**
     * `non-functional`, NOT `completed`.
     *
     * Skipped is not done — §7 keeps a skipped stage out of the O2D KPI, and
     * Checklist has a status for exactly the same idea. Marking it completed
     * would quietly flatter the compliance rate on this screen with work
     * nobody ever did.
     */
    assert.equal(synced.status, 'non-functional');
    assert.match(synced.nonFunctionalReason, /No advance on this order/);
    assert.ok(synced.remarks.some((r) => /skipped/i.test(r.text)));
  });

  test('a stage assigned while still LOCKED gets its real due date once it unlocks', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    // Stage 4 is LOCKED until stage 3 closes — assign it now, before it opens.
    const { delegation } = await assignStageToUser({ orderId: order._id, stageNumber: STAGES.ADVANCE_DECISION, userId: billing._id, actor: billing });

    const beforeUnlock = await Delegation.findById(delegation._id).lean();
    const placeholderDue = beforeUnlock.dueDate;

    await closeStage({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, actor: billing });

    const afterUnlock = await Delegation.findById(delegation._id).lean();
    const stage = await stageOf(order._id, STAGES.ADVANCE_DECISION);
    assert.ok(stage.plannedCompletion);
    assert.equal(afterUnlock.dueDate.getTime(), new Date(stage.plannedCompletion).getTime());
    assert.notEqual(afterUnlock.dueDate.getTime(), placeholderDue.getTime());
  });
});

describe('completing the mirror runs the REAL stage completion', () => {
  test('finishing the Delegation task actually completes the O2D stage', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { delegation } = await assignStageToUser({ orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing });

    const result = await completeMirroredTask(delegation, { actor: billing });

    assert.equal(result.stage.status.startsWith('DONE'), true);

    const reloadedStage = await stageOf(order._id, DELEGATION_STAGE);
    assert.ok(reloadedStage.actualCompletion);
    assert.equal(String(reloadedStage.completedBy), String(billing._id));

    // The engine OWN hook — not this call directly — is what marked the
    // mirror Completed, proving the two paths converge on one mechanism.
    const synced = await Delegation.findById(delegation._id).lean();
    assert.equal(synced.status, 'Completed');
  });

  test('finishing the Checklist occurrence actually completes the O2D stage', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({ orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing });

    // Stage 3 requires a PI number — proving the mirror runs the REAL
    // completion means proving it enforces the real evidence rule too.
    const result = await completeMirroredTask(mirror, {
      actor: billing, evidence: { piNumber: 'PI-9001', sorReference: 'SOR-9001' },
    });

    assert.equal(result.stage.status.startsWith('DONE'), true);

    const reloadedStage = await stageOf(order._id, CHECKLIST_STAGE);
    assert.ok(reloadedStage.actualCompletion);
    assert.equal(String(reloadedStage.completedBy), String(billing._id));

    const synced = await ChecklistOccurrence.findById(mirror._id).lean();
    assert.equal(synced.status, 'completed');
  });

  test('a Checklist completion missing the evidence the stage requires is refused on both sides', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({ orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing });

    await assert.rejects(
      () => completeMirroredTask(mirror, { actor: billing, evidence: {} }),
      (err) => err.code === 'O2D_STAGE_FIELD_REQUIRED' && err.statusCode === 400,
    );

    assert.equal((await ChecklistOccurrence.findById(mirror._id)).status, 'pending');
    assert.equal((await stageOf(order._id, CHECKLIST_STAGE)).actualCompletion, null);
  });

  /**
   * 🔴 THE GUARANTEE THAT MATTERS MOST: a rejection on one side is the SAME
   * rejection on the other. Stage order is not satisfied here — stage 2 was
   * closed, but nothing skips this to stage 4 — so completing stage 4 out of
   * turn must fail identically whether asked from Order Tracker or the mirror.
   */
  test('a completion the real stage refuses is refused through the mirror too', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    // Assign stage 4 directly, while stage 3 (its predecessor) is still open.
    const { delegation } = await assignStageToUser({ orderId: order._id, stageNumber: STAGES.ADVANCE_DECISION, userId: billing._id, actor: billing });

    await assert.rejects(
      () => completeMirroredTask(delegation, { actor: billing }),
      (err) => err instanceof O2dWorkflowError && err.code === 'O2D_PREREQUISITE_INCOMPLETE',
    );

    // Nothing was silently marked done on either side.
    assert.equal((await Delegation.findById(delegation._id)).status, 'Pending');
    assert.notEqual((await stageOf(order._id, STAGES.ADVANCE_DECISION)).status, 'DONE_ON_TIME');
  });

  test('the assigned person may complete it even though their role would not otherwise close this stage', async () => {
    // Assigning IS the grant for this one stage instance — that is the entire
    // point of naming a person rather than leaving it to the role queue.
    const billing = await account('Billing');
    const warehouseUser = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    // A Billing-role actor assigns stage 3 (Billing-owned) to a Warehouse
    // user — unusual, but the assignment itself is the authority being
    // tested, not whether that particular hand-off is a good idea.
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: warehouseUser._id, actor: billing,
    });

    const result = await completeMirroredTask(mirror, { actor: warehouseUser, evidence: { piNumber: 'PI-9002', sorReference: 'SOR-9002' } });
    assert.equal(result.stage.status.startsWith('DONE'), true);
  });

  test('somebody who is neither the assignee nor able to work the stage cannot complete the mirror', async () => {
    const billing = await account('Billing');
    const stranger = await account('Warehouse User');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({ orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing });

    await assert.rejects(
      () => completeMirroredTask(mirror, { actor: stranger }),
      (err) => err instanceof O2dWorkflowError && err.code === 'O2D_NOT_YOUR_STAGE',
    );
  });
});

// ===========================================================================
// End to end, through the real routes
// ===========================================================================

describe('the full stack: routes → controllers → services', () => {
  test('POST /o2d/orders/:id/stages/:n/assign creates the mirror, reachable from the Delegation API', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/o2d', o2dRoutes);
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await post(url, `/api/v1/o2d/orders/${order._id}/stages/${DELEGATION_STAGE}/assign`, {
        userId: String(billing._id),
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.mirrorKind, MIRROR_KIND.DELEGATION);
      const delegationId = res.body.data.delegation._id;

      // The SAME task, visible from the ordinary Delegation list endpoint.
      const list = await get(url, `/api/v1/delegation?doerId=${String(billing._id)}`);
      assert.equal(list.status, 200);
      assert.ok(list.body.data.some((d) => d._id === delegationId));
    });
  });

  test('assigning an evidence stage lands it on the Checklist list instead, and says so', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/o2d', o2dRoutes);
        a.use('/api/v1/checklist', checklistRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await post(url, `/api/v1/o2d/orders/${order._id}/stages/${CHECKLIST_STAGE}/assign`, {
        userId: String(billing._id),
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.mirrorKind, MIRROR_KIND.CHECKLIST);
      assert.equal(res.body.data.delegation, null);
      const occurrenceId = res.body.data.mirror._id;

      // The SAME task, visible from the ordinary Checklist list endpoint.
      const list = await get(url, '/api/v1/checklist/tasks');
      assert.equal(list.status, 200);
      assert.ok(list.body.data.tasks.some((t) => t._id === occurrenceId));
    });
  });

  test('PATCH /checklist/tasks/:id/complete on a mirrored task completes the real stage', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/checklist', checklistRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await patch(url, `/api/v1/checklist/tasks/${mirror._id}/complete`, {
        evidence: { piNumber: 'PI-HTTP-2', sorReference: 'SOR-HTTP-2' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'completed');
    });

    const stage = await stageOf(order._id, CHECKLIST_STAGE);
    assert.ok(stage.actualCompletion);
    assert.equal(stage.evidence.piNumber, 'PI-HTTP-2');
  });

  test('a Checklist completion the stage refuses reports the real refusal and changes nothing', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/checklist', checklistRoutes);
      },
    });

    await withServer(app, async (url) => {
      // No evidence at all — the stage requires a PI number and an SOR ref.
      const res = await patch(url, `/api/v1/checklist/tasks/${mirror._id}/complete`, {});

      /**
       * 400, not 500.
       *
       * A missing field is the user's to fix, and the response has to say so.
       * `fieldError` used to carry only `status`, while the error handler reads
       * `statusCode` — so this refusal reached the browser as an Internal
       * Server Error with a perfectly helpful message inside it, on this path
       * AND on Order Tracker's own Complete button. Asserted over HTTP rather
       * than on the thrown object, because that was exactly the gap: the unit
       * test checked `err.status` and was happy.
       */
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'O2D_STAGE_FIELD_REQUIRED');
      assert.match(res.body.message, /PI Number is required/);
    });

    assert.equal((await ChecklistOccurrence.findById(mirror._id)).status, 'pending');
    assert.equal((await stageOf(order._id, CHECKLIST_STAGE)).actualCompletion, null);
  });

  test('a mirrored Checklist task cannot be marked non-functional or reassigned from that screen', async () => {
    const billing = await account('Billing');
    const manager = await account('Admin');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(manager)(req, res, next));
        a.use('/api/v1/checklist', checklistRoutes);
      },
    });

    await withServer(app, async (url) => {
      const skipped = await patch(url, `/api/v1/checklist/tasks/${mirror._id}/non-functional`, { reason: 'not needed' });
      assert.equal(skipped.status, 400);
      assert.equal(skipped.body.code, 'O2D_MIRROR_READ_ONLY');

      const moved = await patch(url, `/api/v1/checklist/tasks/${mirror._id}/reassign`, { newDoer: String(manager._id) });
      assert.equal(moved.status, 400);
      assert.equal(moved.body.code, 'O2D_MIRROR_READ_ONLY');
    });

    // Neither the mirror nor the stage moved.
    const untouched = await ChecklistOccurrence.findById(mirror._id).lean();
    assert.equal(untouched.status, 'pending');
    assert.equal(String(untouched.doer), String(billing._id));
    assert.equal(String((await stageOf(order._id, CHECKLIST_STAGE)).assignedTo), String(billing._id));
  });

  test('the routine behind a mirrored task cannot be edited or stopped from that screen', async () => {
    const billing = await account('Billing');
    const manager = await account('Admin');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(manager)(req, res, next));
        a.use('/api/v1/checklist', checklistRoutes);
      },
    });

    await withServer(app, async (url) => {
      const edited = await put(url, `/api/v1/checklist/routines/${mirror.routine}`, { taskName: 'Something else' });
      assert.equal(edited.status, 400);
      assert.equal(edited.body.code, 'O2D_MIRROR_READ_ONLY');

      const stopped = await patch(url, `/api/v1/checklist/routines/${mirror.routine}/stop`, {});
      assert.equal(stopped.status, 400);
      assert.equal(stopped.body.code, 'O2D_MIRROR_READ_ONLY');
    });

    const routine = await ChecklistRoutine.findById(mirror.routine).lean();
    assert.equal(routine.isActive, true);
    assert.match(routine.taskName, new RegExp(order.poNumber));
  });

  test('PUT /delegation/:id status=Completed on a mirrored task completes the real stage', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { delegation } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await put(url, `/api/v1/delegation/${delegation._id}`, { status: 'Completed' });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'Completed');
    });

    const stage = await stageOf(order._id, DELEGATION_STAGE);
    assert.ok(stage.actualCompletion);
  });

  test('a rejected completion through the Delegation API reports the real refusal', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    // Assign stage 4 while stage 3 is still open — completing it must fail.
    const { delegation } = await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.ADVANCE_DECISION, userId: billing._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await put(url, `/api/v1/delegation/${delegation._id}`, { status: 'Completed' });
      assert.equal(res.status, 422);
      assert.equal(res.body.code, 'O2D_PREREQUISITE_INCOMPLETE');
    });

    assert.equal((await Delegation.findById(delegation._id)).status, 'Pending');
  });

  test('DELETE /delegation/:id refuses to delete a mirrored task', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { delegation } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await del(url, `/api/v1/delegation/${delegation._id}`);
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'O2D_MIRROR_NOT_DELETABLE');
    });

    assert.equal((await Delegation.findById(delegation._id)).isDeleted, false);
  });

  test('bulk-status skips mirrored tasks and reports how many', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { delegation: mirrored } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });
    const manual = await Delegation.create({
      taskTitle: 'Ordinary manual task',
      assignerId: billing._id,
      assignerName: billing.user,
      doerId: billing._id,
      doerFirstName: 'Test',
      dueDate: new Date(),
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(billing)(req, res, next));
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await post(url, '/api/v1/delegation/bulk-status', {
        ids: [String(mirrored._id), String(manual._id)],
        status: 'Completed',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.modifiedCount, 1);
      assert.equal(res.body.skipped, 1);
    });

    assert.equal((await Delegation.findById(mirrored._id)).status, 'Pending');
    assert.equal((await Delegation.findById(manual._id)).status, 'Completed');
  });
});

describe('a personal assignment shows up in the assignee\'s My Tasks, regardless of role', () => {
  test('the assigned person sees it, actionable, even though their role does not own it', async () => {
    const billing = await account('Billing');
    const warehouseUser = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: warehouseUser._id, actor: billing,
    });

    const { data } = await myTasks(warehouseUser, {});
    const row = data.find((r) => r.stageNumber === STAGES.SEND_SOR_PI);

    assert.ok(row, 'the assignee must see the stage in their own My Tasks');
    assert.equal(row.actionable, true);
  });

  test('somebody else of the SAME non-owning role does not see it', async () => {
    const billing = await account('Billing');
    const assignee = await account('Warehouse User');
    const bystander = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: assignee._id, actor: billing,
    });

    const { data } = await myTasks(bystander, {});
    assert.ok(!data.some((r) => r.stageNumber === STAGES.SEND_SOR_PI && String(r.order?._id) === String(order._id)));
  });

  /**
   * ASSIGNMENT MOVES THE TASK. IT DOES NOT COPY IT.
   *
   * This test used to assert the opposite — that naming one person ADDED the
   * row to their list and left it in every other owner's. That made My Tasks
   * disagree with the Work Queue by construction: the mirror exists for exactly
   * ONE person, so the same stage showed to one user there and to the whole
   * Billing team here, and four of those five were looking at work that was
   * demonstrably not theirs.
   *
   * The permission did not change and is checked below: `otherBilling` can
   * still COMPLETE this stage, from Order Tracker. It is not on their to-do
   * list, which is a different question.
   */
  test('naming one person takes the stage off the rest of the role queue', async () => {
    const billing = await account('Billing');
    const otherBilling = await account('Billing');
    const warehouseUser = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    // Before: unassigned, so it sits in every Billing user's queue.
    const before = await myTasks(otherBilling, {});
    assert.ok(
      before.data.some((r) => r.stageNumber === STAGES.SEND_SOR_PI),
      'an unassigned stage belongs to the whole role',
    );

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: warehouseUser._id, actor: billing,
    });

    const after = await myTasks(otherBilling, {});
    assert.ok(
      !after.data.some(
        (r) => r.stageNumber === STAGES.SEND_SOR_PI && String(r.order?._id) === String(order._id),
      ),
      'once somebody is named, it is their task and nobody else\u2019s to-do',
    );

    // …and the assignee has it.
    const mine = await myTasks(warehouseUser, {});
    assert.ok(mine.data.some((r) => r.stageNumber === STAGES.SEND_SOR_PI));

    // The AUTHORISATION is untouched — visibility narrowed, permission did not.
    assert.equal(await canWorkStage(otherBilling, STAGES.SEND_SOR_PI), true);
  });

  test('a Super Admin keeps an open stage in their queue after it is named to somebody', async () => {
    // So an admin can step in when the assignee is absent: the row stays,
    // flagged as held by someone else, and remains theirs to complete.
    const billing = await account('Billing');
    const superAdmin = await account('Super Admin');
    const warehouseUser = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: warehouseUser._id, actor: billing,
    });

    const { data } = await myTasks(superAdmin, {});
    const row = data.find(
      (r) => r.stageNumber === STAGES.SEND_SOR_PI && String(r.order?._id) === String(order._id),
    );
    assert.ok(row, 'the admin still sees it');
    assert.equal(row.actionable, true);
    assert.equal(row.assignedToOther, true);
    assert.equal(await canWorkStage(superAdmin, STAGES.SEND_SOR_PI), true);
  });

  test('a cover role (Billing Head) sees a Billing stage named to one Billing user', async () => {
    const billing = await account('Billing');
    const assignee = await account('Billing');
    const head = await account('Billing Head');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: assignee._id, actor: billing,
    });

    const { data } = await myTasks(head, { view: 'open' });
    const mine = data.filter((r) => String(r.order?._id) === String(order._id));
    const row = mine.find((r) => r.stageNumber === STAGES.SEND_SOR_PI);
    assert.ok(row, 'Billing Head is a cover role on stage 3, so it stays on their list');
    assert.equal(row.actionable, true);
    assert.equal(row.assignedToOther, true);
    // Locked later stages are still not offered, so the sequence holds.
    assert.deepEqual(mine.map((r) => r.stageNumber), [STAGES.SEND_SOR_PI]);
  });

  test('a stage assigned to me stays mine even on a number my role does not own', async () => {
    const billing = await account('Billing');
    const warehouseUser = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: warehouseUser._id, actor: billing,
    });

    // The narrowing must not have caught the assignee in its own net: they are
    // the one person the row is for.
    const { data } = await myTasks(warehouseUser, {});
    const row = data.find((r) => r.stageNumber === STAGES.SEND_SOR_PI);
    assert.ok(row, 'the assignee keeps the row');
    assert.equal(row.actionable, true);
  });

  test('an explicit stageNumber filter still respects visibility for a stranger', async () => {
    const billing = await account('Billing');
    const warehouseUser = await account('Warehouse User');
    const stranger = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: warehouseUser._id, actor: billing,
    });

    const { data } = await myTasks(stranger, { stageNumber: STAGES.SEND_SOR_PI });
    assert.equal(data.length, 0);
  });

  test('canWorkStage grants the assignee directly, and refuses a stranger', async () => {
    const assignedUserId = '652f0000000000000000aaaa';
    const strangerId = '652f0000000000000000bbbb';

    assert.equal(
      await canWorkStage({ _id: assignedUserId, role: 'Warehouse User' }, STAGES.SEND_SOR_PI, { assignedTo: assignedUserId }),
      true,
    );
    assert.equal(
      await canWorkStage({ _id: strangerId, role: 'Warehouse User' }, STAGES.SEND_SOR_PI, { assignedTo: assignedUserId }),
      false,
    );
  });
});

describe('the assignee can complete the stage directly through Order Tracker, not only via the mirror', () => {
  test('POST /o2d/.../complete succeeds for the assignee even though their role does not own the stage', async () => {
    const billing = await account('Billing');
    const warehouseUser = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: warehouseUser._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(warehouseUser)(req, res, next));
        a.use('/api/v1/o2d', o2dRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await post(url, `/api/v1/o2d/orders/${order._id}/stages/${STAGES.SEND_SOR_PI}/complete`, {
        evidence: { piNumber: 'PI-DIRECT-1', sorReference: 'SOR-DIRECT-1' },
      });
      assert.equal(res.status, 200);
    });

    const stage = await stageOf(order._id, STAGES.SEND_SOR_PI);
    assert.ok(stage.actualCompletion);

    // The mirror is caught up too — one completion, one truth, wherever it was
    // performed from. `sourceStageId` is untouched by an ordinary completion
    // (only reassignment/unassignment detach it), so the mirror is still found
    // by the live link.
    const synced = await occurrenceFor(stage._id);
    assert.ok(synced, 'the mirror must still be linked to this stage');
    assert.equal(synced.status, 'completed');
  });

  test('a stranger — neither the assignee nor the owning role — is refused', async () => {
    const billing = await account('Billing');
    const warehouseUser = await account('Warehouse User');
    const stranger = await account('Warehouse User');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: warehouseUser._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(stranger)(req, res, next));
        a.use('/api/v1/o2d', o2dRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await post(url, `/api/v1/o2d/orders/${order._id}/stages/${STAGES.SEND_SOR_PI}/complete`, {
        evidence: { piNumber: 'PI-X', sorReference: 'SOR-X' },
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'O2D_NOT_YOUR_STAGE');
    });
  });
});

// ===========================================================================

/**
 * PARKING THE ORDER MUST PARK THE TASK.
 *
 * ---------------------------------------------------------------------------
 * THE DIVERGENCE THESE EXIST TO CATCH
 * ---------------------------------------------------------------------------
 * Everything above this block tests the mirror on the STAGE's own events —
 * assigned, completed, skipped, reassigned. But a stage also stops being work
 * for reasons that never touch the stage engine's completion path at all:
 *
 *   hold      §19 freezes the SLA. `task.service.js` drops the row from My
 *             Tasks, and says so in as many words.
 *   cancel    the order is gone. Same thing, via `exit.service.js`, which
 *             parks every open stage at ON_HOLD.
 *   void      as cancel.
 *
 * Each of those wrote the stage and nothing else, so the mirrored task stayed
 * Pending in its assignee's Work Queue — an open task, with a due date, for an
 * order the business had told everyone to stop working. The two screens the
 * whole mirror exists to keep in step disagreed, and disagreed in the worst
 * direction: the one that has somebody doing work nobody wants done.
 *
 * Both surfaces are exercised, for the reason stated at the top of this file:
 * the bug worth fearing is one of them quietly behaving differently.
 */
describe('an order that stops being live takes its mirrored tasks with it', () => {
  /** The live Delegation mirroring this stage, whatever its state. */
  const delegationFor = (stageId) => Delegation.findOne({ sourceStageId: stageId }).lean();

  test('holding the order parks the Delegation mirror, and My Tasks agrees', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });

    const stage = await stageOf(order._id, DELEGATION_STAGE);
    assert.equal((await delegationFor(stage._id)).heldAt, null, 'live before the hold');

    await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: billing });

    // The stage left My Tasks — the behaviour `task.service.js` documents.
    const queue = await myTasks(billing, { pageSize: 100 });
    assert.ok(
      !queue.data.some((r) => String(r._id) === String(stage._id)),
      'a held order must leave My Tasks',
    );

    // …and the mirror left the Work Queue with it, rather than sitting there
    // as an open task for work the hold exists to stop.
    const mirror = await delegationFor(stage._id);
    assert.ok(mirror.heldAt, 'the mirror must be parked when the order is');
    assert.match(mirror.holdReason ?? '', /on hold/i);
    // Parked, NOT resolved — the work still exists and a resume brings it back.
    assert.equal(mirror.status, 'Pending');
  });

  test('holding the order parks the Checklist mirror too', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });

    const stage = await stageOf(order._id, CHECKLIST_STAGE);
    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: billing });

    const mirror = await occurrenceFor(stage._id);
    assert.ok(mirror.heldAt, 'the occurrence must be parked when the order is');
    // `non-functional` would say the work did not need doing, and `completed`
    // would be a lie. A held occurrence keeps the status it had.
    assert.equal(mirror.status, 'pending');
  });

  /**
   * Stage 3, not stage 4, and the choice is the test.
   *
   * `applyHold` moves a deadline only for the SLA types measured in WORKING
   * time. Stage 4 is SAME_DAY_BY, so a hold never moves its date and the
   * assertion below would hold whether or not anything resynced the mirror —
   * a test that passes for the wrong reason. Stage 3 is WORKING_HOURS, so the
   * deadline genuinely moves and the mirror genuinely has to follow it.
   */
  test('resuming hands the task back, on the deadline the hold moved', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });
    const stageId = (await stageOf(order._id, CHECKLIST_STAGE))._id;
    const datedBefore = new Date((await occurrenceFor(stageId)).plannedDate).getTime();

    await holdOrder({
      orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: billing, now: ist('2026-09-15', '10:00'),
    });
    assert.ok((await occurrenceFor(stageId)).heldAt, 'parked by the hold');

    await resumeOrder({ orderId: order._id, actor: billing, now: ist('2026-09-16', '10:00') });

    const stage = await stageOf(order._id, CHECKLIST_STAGE);
    const mirror = await occurrenceFor(stageId);

    assert.equal(mirror.heldAt, null, 'the mirror must come back off hold');
    assert.equal(mirror.holdReason, null);
    /*
     * The deadline MOVED by the frozen working minutes (§19). A mirror handed
     * back with its pre-hold date would show the assignee as late for a pause
     * the business asked for — which is the bug a bare release would leave.
     */
    assert.ok(
      new Date(mirror.plannedDate).getTime() > datedBefore,
      'the resume must have pushed the deadline out at all',
    );
    assert.equal(
      new Date(mirror.plannedDate).getTime(),
      new Date(stage.plannedCompletion).getTime(),
      'the mirror must carry the deadline the resume granted',
    );
  });

  test('cancelling the order parks every mirrored task on it', async () => {
    const billing = await account('Billing');
    const warehouse = await account('Warehouse User');
    const order = await orderAtStage4(billing);
    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: warehouse._id, actor: billing,
    });
    const stageId = (await stageOf(order._id, DELEGATION_STAGE))._id;

    await cancelOrder(order._id, { reason: 'Customer withdrew the order' }, billing);

    const mirror = await delegationFor(stageId);
    assert.ok(mirror.heldAt, 'a cancelled order must not leave an open task behind');
    assert.match(mirror.holdReason ?? '', /cancelled/i);
    // Still Pending, not Completed: nobody did this work, and a mirror closed
    // as complete would count towards the assignee's completion rate.
    assert.equal(mirror.status, 'Pending');
  });

  test('reviving the order hands the tasks back', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });
    const stageId = (await stageOf(order._id, DELEGATION_STAGE))._id;

    await cancelOrder(order._id, { reason: 'Raised against the wrong customer' }, billing);
    // Asserted mid-way, so this test cannot pass merely because the cancel
    // never parked anything in the first place.
    assert.ok((await delegationFor(stageId)).heldAt, 'parked by the cancellation');

    await reviveOrder(order._id, { reason: 'It was the right customer after all' }, billing);

    const mirror = await delegationFor(stageId);
    assert.equal(mirror.heldAt, null, 'a revived order gives its tasks back');
  });

  test('a stage assigned while the order is already on hold is born parked', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);

    // Held FIRST, assigned second — the order in which nothing would ever call
    // `holdMirrorForStage`, so a mirror born Pending would show in the Work
    // Queue for a stage My Tasks refuses to show at all.
    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: billing });
    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });

    const stage = await stageOf(order._id, DELEGATION_STAGE);
    assert.ok((await delegationFor(stage._id)).heldAt, 'born held, not held at the next hold');
  });
});

/**
 * The read side: what the Work Queue's own endpoints actually return.
 *
 * The block above proves the FLAG is written. These prove the screens honour
 * it — a separate failure, and the one a user would actually see.
 */
describe('a parked task is gone from the Work Queue, and only from the personal views', () => {
  const workQueueApp = (user) => buildTestApp({
    mount: (a) => {
      a.use((req, res, next) => stubProtect(user)(req, res, next));
      a.use('/api/v1/delegation', delegationRoutes);
      a.use('/api/v1/checklist', checklistRoutes);
    },
  });

  test('GET /delegation?myWork=true drops a task whose order went on hold', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });

    await withServer(workQueueApp(billing), async (url) => {
      const before = await get(url, '/api/v1/delegation?myWork=true');
      assert.ok(before.body.data.some((d) => d._id === String(mirror._id)), 'visible while live');

      await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: billing });

      const after = await get(url, '/api/v1/delegation?myWork=true');
      assert.ok(
        !after.body.data.some((d) => d._id === String(mirror._id)),
        'a parked task must leave the Work Queue',
      );
    });
  });

  test('GET /checklist/tasks drops a parked occurrence from its doer own list', async () => {
    const billing = await account('Billing');
    const order = await orderAtStage3(billing);
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });

    await withServer(workQueueApp(billing), async (url) => {
      const before = await get(url, '/api/v1/checklist/tasks');
      assert.ok(before.body.data.tasks.some((t) => t._id === String(mirror._id)), 'visible while live');

      await cancelOrder(order._id, { reason: 'Duplicate order' }, billing);

      const after = await get(url, '/api/v1/checklist/tasks');
      assert.ok(
        !after.body.data.tasks.some((t) => t._id === String(mirror._id)),
        'a cancelled order must not leave a checklist item open',
      );

      // The tiles sit directly above that list. Counting a row the list no
      // longer shows is the same divergence one screen further down. (What is
      // left is the stage-2 team task this user completed — theirs, and done.)
      const summary = await get(url, '/api/v1/checklist/summary');
      assert.equal(summary.body.data.pendingToday, 0, 'the tiles must count what the list shows');
      assert.equal(summary.body.data.total, after.body.data.tasks.length);
      assert.ok(after.body.data.tasks.every((t) => t.status === 'completed'));
    });
  });

  test('a manual task is untouched by any of this', async () => {
    /*
     * The filter is `heldAt: null`, which in Mongo matches a MISSING field as
     * well as an explicitly null one. Every Delegation ever created before this
     * field existed, and every manual one since — none of which will ever set
     * it — must therefore still be returned. This is the regression that would
     * empty every user's Work Queue rather than merely tidy it.
     */
    const billing = await account('Billing');
    const manual = await Delegation.create({
      taskTitle: 'Call the transporter',
      assignerId: billing._id,
      assignerName: billing.user,
      doerId: billing._id,
      doerFirstName: 'Test',
      status: 'Pending',
      dueDate: ist('2026-09-20', '17:00'),
    });
    // Written the way the old code wrote it: no `heldAt` key at all.
    await Delegation.collection.updateOne(
      { _id: manual._id },
      { $unset: { heldAt: '', holdReason: '' } },
    );

    await withServer(workQueueApp(billing), async (url) => {
      const res = await get(url, '/api/v1/delegation?myWork=true');
      assert.ok(res.body.data.some((d) => d._id === String(manual._id)));
    });
  });

  test('All Tasks still shows a parked task — it is an audit view, not a queue', async () => {
    const admin = await account('Admin');
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });
    await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: billing });

    await withServer(workQueueApp(admin), async (url) => {
      const res = await get(url, '/api/v1/delegation?scope=allTasks');
      assert.ok(
        res.body.data.some((d) => d._id === String(mirror._id)),
        'hiding a parked task from the audit view would make it unfindable',
      );
    });
  });
});

// ===========================================================================

/**
 * ONE TASK, TWO SCREENS, EVERY TRANSITION.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS BLOCK IS FOR
 * ---------------------------------------------------------------------------
 * The blocks above each pin one mechanism. This one asks the question the
 * feature actually exists to answer, at every state a task can be in:
 *
 *     does O2D's My Tasks agree with the Work Queue about whether THIS person
 *     owes THIS piece of work right now?
 *
 * The two screens reach that answer by completely different routes — My Tasks
 * filters O2dOrderStage rows by role and assignment, the Work Queue filters
 * Delegation/ChecklistOccurrence rows by doer and hold flag — so "they agree"
 * is a real invariant that can break on either side, and has.
 *
 * `activeFor` below is the whole point: one predicate, asked of both screens,
 * so a test can say "these must match" rather than restating each screen's
 * internals and quietly drifting from what the screen really does.
 */
describe('My Tasks and the Work Queue agree at every transition', () => {
  /** Is this stage an ACTIVE row in this user's O2D My Tasks? */
  async function activeInMyTasks(user, orderId, stageNumber) {
    const { data } = await myTasks(user, { pageSize: 500, view: 'open' });
    return data.some(
      (r) => r.stageNumber === stageNumber && String(r.order?._id) === String(orderId) && !r.completed,
    );
  }

  /**
   * Is this stage an ACTIVE row in this user's Work Queue?
   *
   * Asked of the mirror the stage currently points at, through the same
   * `heldAt`/status/doer conditions the list endpoints apply — see the read-side
   * block above, which proves those endpoints honour exactly these fields.
   */
  async function activeInWorkQueue(user, stage) {
    const { kind, id } = mirrorRefOf(stage);
    if (!id) return false;
    const doc = kind === MIRROR_KIND.CHECKLIST
      ? await ChecklistOccurrence.findById(id).lean()
      : await Delegation.findById(id).lean();
    if (!doc) return false;

    const doer = String(doc.doerId ?? doc.doer ?? '');
    if (doer !== String(user._id)) return false;
    if (doc.heldAt) return false;
    return !['Completed', 'completed', 'non-functional'].includes(doc.status);
  }

  /** Both screens, one answer — or the test says which one disagreed. */
  async function assertBothSay(expected, { user, order, stageNumber, when }) {
    const stage = await stageOf(order._id, stageNumber);
    const inTasks = await activeInMyTasks(user, order._id, stageNumber);
    const inQueue = await activeInWorkQueue(user, stage);
    assert.equal(inTasks, expected, `${when}: O2D My Tasks should say ${expected}`);
    assert.equal(inQueue, expected, `${when}: Work Queue should say ${expected}`);
  }

  test('the whole life of one assigned stage, both screens in step', async () => {
    const billing = await account('Billing');
    const superAdmin = await account('Super Admin');
    const order = await orderAtStage3(billing);

    // ── assigned ────────────────────────────────────────────────────────
    await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: billing._id, actor: billing,
    });
    await assertBothSay(true, { user: billing, order, stageNumber: CHECKLIST_STAGE, when: 'on assignment' });

    // ── held ────────────────────────────────────────────────────────────
    await holdOrder({
      orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: superAdmin, now: ist('2026-09-15', '10:00'),
    });
    await assertBothSay(false, { user: billing, order, stageNumber: CHECKLIST_STAGE, when: 'on hold' });

    // ── resumed, on the moved deadline ──────────────────────────────────
    await resumeOrder({ orderId: order._id, actor: superAdmin, now: ist('2026-09-16', '10:00') });
    await assertBothSay(true, { user: billing, order, stageNumber: CHECKLIST_STAGE, when: 'on resume' });

    const resumed = await stageOf(order._id, CHECKLIST_STAGE);
    const mirror = await occurrenceFor(resumed._id);
    assert.equal(
      new Date(mirror.plannedDate).getTime(),
      new Date(resumed.plannedCompletion).getTime(),
      'on resume: the two screens must quote the same deadline, not just the same existence',
    );

    // ── completed, from the Work Queue side ─────────────────────────────
    await completeMirroredTask(mirror, {
      actor: billing,
      evidence: { piNumber: 'PI-9001', sorReference: 'SOR-9001' },
    });
    await assertBothSay(false, { user: billing, order, stageNumber: CHECKLIST_STAGE, when: 'on completion' });

    const done = await stageOf(order._id, CHECKLIST_STAGE);
    assert.ok(done.actualCompletion, 'the real stage is what got completed');
  });

  test('reassignment moves the task off A and onto B, on both screens', async () => {
    const billing = await account('Billing');
    const userA = await account('Warehouse User');
    const userB = await account('Warehouse User');
    const order = await orderAtStage4(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    await assertBothSay(true, { user: userA, order, stageNumber: DELEGATION_STAGE, when: 'A, once assigned' });
    await assertBothSay(false, { user: userB, order, stageNumber: DELEGATION_STAGE, when: 'B, before handover' });

    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userB._id, actor: billing,
    });

    // A keeps nothing active: the stage row is B's now, and A's old mirror was
    // closed out rather than left as a second live task on the same stage.
    await assertBothSay(false, { user: userA, order, stageNumber: DELEGATION_STAGE, when: 'A, after handover' });
    await assertBothSay(true, { user: userB, order, stageNumber: DELEGATION_STAGE, when: 'B, after handover' });

    // Still exactly one live mirror — a handover must never leave two.
    const stage = await stageOf(order._id, DELEGATION_STAGE);
    assert.equal(await Delegation.countDocuments({ sourceStageId: stage._id }), 1);
  });

  test('unassigning takes it off the person without closing the stage', async () => {
    const billing = await account('Billing');
    const userA = await account('Warehouse User');
    const order = await orderAtStage4(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    await unassignStage({ orderId: order._id, stageNumber: DELEGATION_STAGE, actor: billing });

    await assertBothSay(false, { user: userA, order, stageNumber: DELEGATION_STAGE, when: 'after unassignment' });

    // …and it is back in the ROLE queue, which is where an unassigned stage
    // belongs. Losing it entirely would be the opposite bug to the one the
    // narrowed visibility fixed.
    assert.ok(
      await activeInMyTasks(billing, order._id, DELEGATION_STAGE),
      'an unassigned stage returns to everyone who works it',
    );
  });

  test('cancelling leaves nobody with an active row on either screen', async () => {
    const billing = await account('Billing');
    const userA = await account('Warehouse User');
    const order = await orderAtStage4(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    await cancelOrder(order._id, { reason: 'Customer withdrew the order' }, billing);

    await assertBothSay(false, { user: userA, order, stageNumber: DELEGATION_STAGE, when: 'after cancellation' });
  });

  test('voiding does the same as cancelling', async () => {
    const billing = await account('Billing');
    const userA = await account('Warehouse User');
    const order = await orderAtStage4(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    await voidOrder(order._id, { reason: 'Raised in error' }, billing);

    await assertBothSay(false, { user: userA, order, stageNumber: DELEGATION_STAGE, when: 'after voiding' });
  });

  test('reviving a cancelled order gives the task back to its assignee', async () => {
    const billing = await account('Billing');
    const userA = await account('Warehouse User');
    const order = await orderAtStage4(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    await cancelOrder(order._id, { reason: 'Wrong customer' }, billing);
    await reviveOrder(order._id, { reason: 'It was the right customer after all' }, billing);

    await assertBothSay(true, { user: userA, order, stageNumber: DELEGATION_STAGE, when: 'after revival' });
  });

  /**
   * The case a STAGE-level hold rule silently misses.
   *
   * `holdOrder` freezes the stages that were open; a stage still LOCKED behind
   * its predecessor keeps that status right through the hold. So a rule that
   * asked `stage.status === ON_HOLD` would decide this newly-assigned task was
   * live — and put it in somebody's Work Queue as work to do today, on an order
   * the business has stopped. Keying on the ORDER is what closes it.
   */
  test('a stage assigned while the order is held is born parked even if it is LOCKED', async () => {
    const billing = await account('Billing');
    const superAdmin = await account('Super Admin');
    const accounts = await account('Accounts');
    const order = await orderAtStage4(billing);

    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: superAdmin });

    const later = await stageOf(order._id, STAGES.RECEIVE_ADVANCE);
    assert.equal(later.status, 'LOCKED', 'the fixture must really be a LOCKED stage, or this proves nothing');

    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.RECEIVE_ADVANCE, userId: accounts._id, actor: superAdmin,
    });

    await assertBothSay(false, {
      user: accounts, order, stageNumber: STAGES.RECEIVE_ADVANCE, when: 'assigned onto a held order',
    });
  });

  test('resuming releases the mirror on a LOCKED stage too', async () => {
    const billing = await account('Billing');
    const superAdmin = await account('Super Admin');
    const accounts = await account('Accounts');
    const order = await orderAtStage4(billing);

    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: superAdmin });
    await assignStageToUser({
      orderId: order._id, stageNumber: STAGES.RECEIVE_ADVANCE, userId: accounts._id, actor: superAdmin,
    });
    await resumeOrder({ orderId: order._id, actor: superAdmin });

    /*
     * The stage is LOCKED again, not PENDING — stage 4 still has to happen
     * first — so My Tasks correctly still does not show it, and the Work Queue
     * row is back to exactly what it was before the hold: a live task with a
     * placeholder date, which `unlockStage` corrects when the stage opens.
     *
     * Asserted on the FLAG rather than through `assertBothSay`, because the two
     * screens genuinely differ here and always have: a LOCKED assigned stage is
     * a Work Queue row and not a My Tasks row. What must not happen is it
     * staying parked forever because the release only walked the paused rows.
     */
    const stage = await stageOf(order._id, STAGES.RECEIVE_ADVANCE);
    const { kind, id } = mirrorRefOf(stage);
    const doc = kind === MIRROR_KIND.CHECKLIST
      ? await ChecklistOccurrence.findById(id).lean()
      : await Delegation.findById(id).lean();
    assert.equal(doc.heldAt, null, 'a resume must not leave a LOCKED stage parked for good');
  });

  test('nobody else ever has it on either screen', async () => {
    const billing = await account('Billing');
    const assignee = await account('Warehouse User');
    const bystander = await account('Warehouse User');
    const sameRoleAsOwner = await account('Billing');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: assignee._id, actor: billing,
    });

    for (const [who, label] of [[bystander, 'a stranger'], [sameRoleAsOwner, 'the owning role']]) {
      await assertBothSay(false, {
        user: who, order, stageNumber: CHECKLIST_STAGE, when: `${label} must not hold somebody else's task`,
      });
    }
  });
});

// ===========================================================================

/**
 * A HAND-OFF IS NOT AN ACHIEVEMENT.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THESE EXIST TO KEEP OUT
 * ---------------------------------------------------------------------------
 * Reassigning an O2D stage closes the old assignee's mirror and opens a new one
 * for the new assignee — the unique index permits exactly one live mirror per
 * stage, so the old row must let go before the new one can claim it.
 *
 * That closing used to write `status: 'Completed'` and a `completedAt`. Read on
 * its own that is defensible: the row is finished with. Read by the Executive
 * Scoreboard, which counts `status === 'Completed' || !!completedAt` per doer,
 * it meant every hand-off scored a completed — and, since the reassignment
 * almost always happens before the deadline, ON-TIME — task for the person the
 * work had just been taken away from. A manager could raise somebody's score by
 * repeatedly assigning and reassigning the same stage.
 *
 * Stopping at "don't mark it Completed" would only move the error: the row
 * would then read as planned-and-unfinished, punishing that person for a
 * hand-off they may not have chosen. It has to leave BOTH sides of the ratio,
 * which is why the scoreboard excludes the state rather than special-casing it
 * in the loop.
 *
 * These tests go through the real scoreboard endpoint, with `?date=` pinned, so
 * they test the arithmetic people actually see rather than a restatement of the
 * query.
 */
describe('reassignment does not manufacture completion credit', () => {
  const scoreboardApp = (user) => buildTestApp({
    mount: (a) => {
      a.use((req, res, next) => stubProtect(user)(req, res, next));
      a.use('/api/v1/scoreboard', scoreboardRoutes);
    },
  });

  /**
   * What the board says this person planned and did this period.
   *
   * The endpoint publishes the counts inside `kras`, not as flat fields —
   * `planned` and `actual` under the `done` KRA — so this reads them where the
   * screen reads them. A doer with no work at all still gets a row, with
   * `hasWork: false`, which is the answer we want for the person who was
   * relieved of the task.
   */
  function rowFor(body, user) {
    const row = body.data.rows.find((r) => r.doer === user.user);
    const done = row?.kras?.find((k) => k.key === 'done');
    return {
      hasWork: row?.hasWork ?? false,
      planned: done?.planned ?? 0,
      actual: done?.actual ?? 0,
    };
  }

  /**
   * The week the fixtures' deadlines fall in.
   *
   * Pinned rather than left to the clock: the scoreboard buckets by deadline,
   * so a test that relied on "now" would pass this month and fail next, which
   * is how a suite stops being trusted.
   */
  const SCOREBOARD_WEEK = '2026-09-14';

  test('B gets the credit for B’s completion; A gets nothing for having been relieved', async () => {
    const billing = await account('Billing');
    const superAdmin = await account('Super Admin');
    const userA = await account('Billing');
    const userB = await account('Billing');
    const order = await orderAtStage4(billing);

    // A holds it…
    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    // …then B does…
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userB._id, actor: billing,
    });
    // …and B is the one who finishes it.
    await completeMirroredTask(mirror, { actor: userB });

    await withServer(scoreboardApp(superAdmin), async (url) => {
      const res = await get(url, `/api/v1/scoreboard?period=week&date=${SCOREBOARD_WEEK}`);
      assert.equal(res.status, 200);

      const b = rowFor(res.body, userB);
      const a = rowFor(res.body, userA);

      // Non-vacuous: if the window did not contain the work, this fails loudly
      // rather than letting the assertions below pass on an empty board.
      assert.equal(b.actual, 1, 'B did the work and must be credited with it');
      assert.equal(b.planned, 1);
      assert.equal(b.hasWork, true);

      assert.equal(a.actual, 0, 'A must not be credited for work B did');
      // The subtle half: not counted as a MISS either. A row somebody was
      // relieved of belongs to neither side of their ratio.
      assert.equal(a.planned, 0, 'A must not be charged for a task taken off them');
      assert.equal(a.hasWork, false, 'the board must show A as having no work from this');
    });
  });

  test('the same, on the Checklist surface', async () => {
    const billing = await account('Billing');
    const superAdmin = await account('Super Admin');
    const userA = await account('Billing');
    const userB = await account('Billing');
    const order = await orderAtStage3(billing);

    await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: userA._id, actor: billing,
    });
    const { mirror } = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: userB._id, actor: billing,
    });
    await completeMirroredTask(mirror, {
      actor: userB,
      evidence: { piNumber: 'PI-7788', sorReference: 'SOR-7788' },
    });

    await withServer(scoreboardApp(superAdmin), async (url) => {
      const res = await get(url, `/api/v1/scoreboard?period=week&date=${SCOREBOARD_WEEK}`);
      const b = rowFor(res.body, userB);
      const a = rowFor(res.body, userA);

      assert.equal(b.actual, 1, 'B did the work and must be credited with it');
      assert.equal(a.actual, 0, 'A must not be credited for work B did');
      assert.equal(a.planned, 0, 'A must not be charged for a task taken off them');
      assert.equal(a.hasWork, false, 'the board must show A as having no work from this');
    });
  });

  test('the handed-away row records the state, the destination and the mover', async () => {
    const billing = await account('Billing');
    const userA = await account('Billing');
    const userB = await account('Billing');
    const order = await orderAtStage3(billing);

    const first = await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: userA._id, actor: billing,
    });
    await assignStageToUser({
      orderId: order._id, stageNumber: CHECKLIST_STAGE, userId: userB._id, actor: billing,
    });

    const old = await ChecklistOccurrence.findById(first.mirror._id).lean();
    assert.equal(old.status, OCCURRENCE_REASSIGNED_AWAY);
    assert.equal(old.completedDate, null, 'a hand-off must not stamp a completion date');
    assert.equal(old.reassigned, true);
    assert.equal(String(old.reassignedTo), String(userB._id));
    assert.equal(String(old.reassignedBy), String(billing._id));
    assert.equal(old.sourceStageId, null);
    // §29's soft-delete ethos: the row survives and explains itself.
    assert.ok(old.remarks.some((r) => /Reassigned/.test(r.text)));
  });

  test('a completion that really happened is never overwritten by a later detach', async () => {
    /*
     * The one case where the old behaviour was RIGHT, and which the fix must
     * not trade away. `detachMirror` no longer writes `Completed` — so it must
     * not write `Reassigned` over a `Completed` that was already there and
     * earned. Reachable by unassigning a stage after it was completed.
     */
    const billing = await account('Billing');
    const order = await orderAtStage4(billing);
    const { delegation } = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: billing._id, actor: billing,
    });

    await markMirrorDone(delegation._id, { actor: billing, at: ist('2026-09-14', '16:00') });
    await detachMirror(delegation._id, { actor: billing, reason: 'Tidying up.' });

    const after = await Delegation.findById(delegation._id).lean();
    assert.equal(after.status, 'Completed', 'real work stays credited');
    assert.ok(after.completedAt, 'and keeps the time it was finished');
    assert.equal(after.sourceStageId, null, 'while still detaching from the stage');
  });

  test('a handed-away task is gone from A’s Work Queue and present in B’s', async () => {
    const billing = await account('Billing');
    const userA = await account('Billing');
    const userB = await account('Billing');
    const order = await orderAtStage4(billing);

    const first = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    const second = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userB._id, actor: billing,
    });

    const app = (user) => buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(user)(req, res, next));
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app(userA), async (url) => {
      const res = await get(url, '/api/v1/delegation?myWork=true');
      assert.ok(
        !res.body.data.some((d) => d._id === String(first.delegation._id)),
        'A’s Work Queue must not keep a task A no longer has',
      );
    });

    await withServer(app(userB), async (url) => {
      const res = await get(url, '/api/v1/delegation?myWork=true');
      assert.ok(
        res.body.data.some((d) => d._id === String(second.delegation._id)),
        'B’s Work Queue must have it',
      );
    });
  });

  test('a handed-away task is not counted as overdue against A', async () => {
    /*
     * The row keeps its old deadline, which is usually in the past by the time
     * anybody looks. Before the state existed it was masked by `Completed`;
     * with a state that is neither done nor excluded it would have surfaced as
     * an overdue task against somebody who cannot act on it.
     */
    const billing = await account('Billing');
    const userA = await account('Billing');
    const userB = await account('Billing');
    const order = await orderAtStage4(billing);

    const first = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userB._id, actor: billing,
    });
    // Force the deadline into the past, which is the condition being tested.
    await Delegation.updateOne(
      { _id: first.delegation._id },
      { $set: { dueDate: ist('2020-01-01', '09:00') } },
    );

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(userA)(req, res, next));
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await get(url, '/api/v1/delegation?scope=allTasks&status=Overdue');
      assert.ok(
        !res.body.data.some((d) => d._id === String(first.delegation._id)),
        'nobody is overdue on a task that was taken off them',
      );
    });
  });

  test('All Tasks still shows the handed-away row, so the trail is findable', async () => {
    const billing = await account('Billing');
    const userA = await account('Billing');
    const userB = await account('Billing');
    const order = await orderAtStage4(billing);

    const first = await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userA._id, actor: billing,
    });
    await assignStageToUser({
      orderId: order._id, stageNumber: DELEGATION_STAGE, userId: userB._id, actor: billing,
    });

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(userA)(req, res, next));
        a.use('/api/v1/delegation', delegationRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await get(url, '/api/v1/delegation?scope=allTasks');
      assert.ok(
        res.body.data.some((d) => d._id === String(first.delegation._id)),
        'excluding it from the queue must not make it unfindable',
      );
    });
  });
});

// ===========================================================================

/**
 * ORG-LEVEL OVERRIDE, END TO END — LITERALLY THE 'Admin' ROLE, NOT ONLY
 * 'Super Admin'.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN BLOCK
 * ---------------------------------------------------------------------------
 * `permissions.test.js` already proves, at the permission-table level, that
 * `Admin` holds the wildcard and satisfies every key including
 * `WORK_O2D_STAGE` and `OVERRIDE_O2D`. `isSuperAdmin` is `hasPermission(user,
 * '*')`, not a string check against `'Super Admin'`, so the inference from
 * that table to "an Admin-role user can complete or reassign any O2D stage" is
 * sound — but every O2D test elsewhere in this file that exercises the
 * unrestricted path uses `account('Super Admin')`. Nothing end-to-end had
 * actually driven the literal `'Admin'` role through the HTTP stack for O2D
 * before. This closes that gap, for the specific shape the business rule
 * names: "Admin or a designated organization-level user will also have access
 * to complete any step when required."
 *
 * "designated organization-level user" beyond the two built-in roles is not a
 * separate field to test — it is the same mechanism `isSuperAdmin`'s own
 * comment documents: `Role.permissions` can be set to `['*']` for any role, so
 * granting a third role that access is a role-configuration act, not a code
 * change. What IS code, and worth pinning, is that the check reads the
 * permission set rather than a name — which is what lets that happen at all.
 */
describe('an Admin-role user, not just Super Admin, may act on any step', () => {
  test('completes a stage nobody assigned them to, and the record says it was them', async () => {
    const billing = await account('Billing');
    const admin = await account('Admin');
    const order = await orderAtStage3(billing);

    // Stage 3 is owned by Billing. Admin holds none of Billing's role, and
    // nobody named them on this stage — the org-level door, not the personal
    // assignment door.
    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(admin)(req, res, next));
        a.use('/api/v1/o2d', o2dRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await post(
        url,
        `/api/v1/o2d/orders/${order._id}/stages/${CHECKLIST_STAGE}/complete`,
        { evidence: { piNumber: 'PI-ADMIN-1', sorReference: 'SOR-ADMIN-1' } },
      );
      assert.equal(res.status, 200);
    });

    const stage = await stageOf(order._id, CHECKLIST_STAGE);
    assert.ok(stage.actualCompletion, 'the stage really closed');
    // Requirement 6: the record names who ACTUALLY did it — not the role the
    // stage is nominally owned by.
    assert.equal(String(stage.completedBy), String(admin._id));
    assert.equal(stage.completedByRole, 'Admin');

    // Requirement 5: the next step opened as a direct result.
    const refreshed = await O2dOrder.findById(order._id);
    assert.equal(refreshed.currentStage, CHECKLIST_STAGE + 1);
    const next = await stageOf(order._id, CHECKLIST_STAGE + 1);
    assert.ok(['PENDING', 'DUE_SOON', 'OVERDUE'].includes(next.status), 'the next stage is now open work');
  });

  test('reassigns a stage it does not own, to a user who does', async () => {
    const billing = await account('Billing');
    const admin = await account('Admin');
    const warehouseUser = await account('Warehouse User');
    const order = await orderAtStage4(billing);

    const app = buildTestApp({
      mount: (a) => {
        a.use((req, res, next) => stubProtect(admin)(req, res, next));
        a.use('/api/v1/o2d', o2dRoutes);
      },
    });

    await withServer(app, async (url) => {
      const res = await post(
        url,
        `/api/v1/o2d/orders/${order._id}/stages/${DELEGATION_STAGE}/assign`,
        { userId: String(warehouseUser._id) },
      );
      assert.equal(res.status, 200);
    });

    const stage = await stageOf(order._id, DELEGATION_STAGE);
    assert.equal(String(stage.assignedTo), String(warehouseUser._id));
    assert.equal(String(stage.assignedBy), String(admin._id), 'the audit trail names the Admin who moved it');

    // Requirement 2: the newly-assigned, ordinarily-ineligible user can now
    // work it themselves.
    assert.equal(await canWorkStage(warehouseUser, DELEGATION_STAGE, { assignedTo: stage.assignedTo }), true);
  });
});

// ===========================================================================

/**
 * THE ACTUAL BUG A SCREENSHOT REPORTED: ADMIN OPENED ORDER TRACKER AND HAD NO
 * COMPLETE OPTION AT ALL.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG, AND WHY THE TESTS ABOVE DID NOT CATCH IT
 * ---------------------------------------------------------------------------
 * `canWorkStage` and the route guards were always right — the tests above
 * prove an Admin CAN complete or reassign any stage once the request reaches
 * the server. The screenshot's bug never reached the server: `OrderDrawer.jsx`
 * decides which stages to even OFFER a Complete button for from
 * `GET /o2d/tasks`'s top-level `actionable` list, specifically so the browser
 * never has to duplicate O2D's role→stage mapping (§37 — an administrator can
 * edit that mapping without a deploy).
 *
 * `visibilityFilter` answered that field with `actionable: null` for an
 * org-level user — correct for the internal FILTER a few lines down, where
 * `vis.all` already lets everything through and nothing there reads the list.
 * But `OrderDrawer.jsx` does `tasks?.actionable ?? []`, and `null` satisfies
 * `??`. So the one caller that needed the list got an empty one, and every
 * stage on every order looked, to the browser, like something Admin was not
 * allowed to close — despite holding the wildcard.
 *
 * This is why the fix is tested at the API boundary rather than by re-deriving
 * `canWorkStage`'s own logic: the earlier tests already cover the permission,
 * and restating it here would not have caught this. What was missing was the
 * SHAPE of the field the browser actually reads.
 */
describe('GET /o2d/tasks hands an org-level user a real stage list, not null', () => {
  const tasksApp = (user) => buildTestApp({
    mount: (a) => {
      a.use((req, res, next) => stubProtect(user)(req, res, next));
      a.use('/api/v1/o2d', o2dRoutes);
    },
  });

  test('an Admin gets every enabled stage number back, not an empty list', async () => {
    const admin = await account('Admin');

    await withServer(tasksApp(admin), async (url) => {
      const res = await get(url, '/api/v1/o2d/tasks?pageSize=1');
      assert.equal(res.status, 200);

      const { actionable } = res.body.data;
      assert.ok(Array.isArray(actionable), 'must be a real array — the browser cannot distinguish null from empty');
      assert.ok(actionable.length > 0, 'an Admin closes every stage; an empty list is exactly the reported bug');
      // Every stage this suite exercises must be in it, not merely "some".
      assert.ok(actionable.includes(DELEGATION_STAGE));
      assert.ok(actionable.includes(CHECKLIST_STAGE));
    });
  });

  test('a Super Admin gets the same', async () => {
    const superAdmin = await account('Super Admin');

    await withServer(tasksApp(superAdmin), async (url) => {
      const res = await get(url, '/api/v1/o2d/tasks?pageSize=1');
      const { actionable } = res.body.data;
      assert.ok(Array.isArray(actionable) && actionable.length > 0);
    });
  });

  test('an ordinary role still gets only what it owns — this did not widen anyone else', async () => {
    const billing = await account('Billing');

    await withServer(tasksApp(billing), async (url) => {
      const res = await get(url, '/api/v1/o2d/tasks?pageSize=1');
      const { actionable } = res.body.data;
      assert.ok(actionable.includes(CHECKLIST_STAGE), 'Billing must still see the stage it owns');
      // A role stage list is bounded by what its stage masters actually grant
      // it — it must not have quietly become "everything" too.
      assert.ok(
        actionable.length < 12,
        'a non-org-level role must not have picked up the org-level list',
      );
    });
  });

  test('the drawer\u2019s own reduction — what the browser literally does with this field', async () => {
    /*
     * Not a UI-rendering test: `OrderDrawer.jsx` has no dedicated test suite to
     * extend, and a full component mount would exercise far more than this one
     * line. This pins the exact expression at the point where the old bug
     * lived — `tasks?.actionable ?? []` — against the real API response, so a
     * regression here fails as a one-line arithmetic mismatch instead of a
     * screenshot.
     */
    const admin = await account('Admin');

    await withServer(tasksApp(admin), async (url) => {
      const res = await get(url, '/api/v1/o2d/tasks?pageSize=1');
      const actionableInBrowser = res.body.data?.actionable ?? [];
      assert.ok(
        actionableInBrowser.length > 0,
        'OrderDrawer\u2019s own reduction must not collapse an org-level user to zero actionable stages',
      );
    });
  });
});
