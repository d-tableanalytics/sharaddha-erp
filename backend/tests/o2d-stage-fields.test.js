/**
 * The stage-wise completion fields.
 *
 * These call `completeStage` DIRECTLY rather than through the `closeStage`
 * helper, precisely because the helper fills the fields in — the point here is
 * what happens when they are missing.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { closeStage } from './helpers/o2dStage.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dOrderItem } from '../models/o2d/O2dOrderItem.js';
import { O2dDocument } from '../models/o2d/O2dDocument.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import { completeStage } from '../modules/o2d/stage.engine.js';
import { STAGES, STAGE_STATUS } from '../shared/constants/o2d.js';
import {
  fieldsForStage, requiredDocTypeFor, STAGE_COMPLETION_FIELDS,
} from '../shared/constants/o2dStageFields.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date();
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dOrderItem, O2dDocument);
});
after(async () => { await stopTestMongo(); });
beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const create = async () =>
  (await orders.createOrder({
    poNumber: 'PO-FIELDS-1',
    poDate: new Date(NOW.getTime() - 2 * MINUTE).toISOString(),
    customerName: 'ABC Industries',
    promiseDate: new Date(NOW.getTime() + 11 * DAY).toISOString(),
    items: [],
  }, actor('Sales'), { now: NOW })).order;

/** Walk an order forward to `upTo`, filling each stage properly on the way. */
async function advanceTo(order, upTo) {
  for (let n = STAGES.SUBMIT_PO_TO_BILLING; n < upTo; n += 1) {
    if (n === STAGES.ADVANCE_DECISION) {
      await orders.decideAdvance(order._id, { advanceRequired: false }, actor('Billing'), { now: NOW });
      continue;
    }
    if (n === STAGES.RECEIVE_ADVANCE) continue; // skipped by the decision above
    await closeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: NOW });
  }
}

// ---------------------------------------------------------------------------

describe('required fields are enforced by the server', () => {
  test('stage 3 refuses to close without its PI number', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW,
    });

    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: STAGES.SEND_SOR_PI,
        actor: actor('Billing'), now: NOW, evidence: { sorReference: 'SOR-1' },
      }),
      (e) => e.code === 'O2D_STAGE_FIELD_REQUIRED' && e.field === 'piNumber',
    );
  });

  test('the refusal names the field, so a form can point at the input', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW,
    });

    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: STAGES.SEND_SOR_PI,
        actor: actor('Billing'), now: NOW, evidence: {},
      }),
      (e) => /PI Number is required/.test(e.message) && e.status === 400,
    );
  });

  test('a refused completion leaves the stage exactly as it was', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW,
    });

    await assert.rejects(() => completeStage({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI,
      actor: actor('Billing'), now: NOW, evidence: {},
    }));

    const stage = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.SEND_SOR_PI,
    }).lean();
    // Validation runs before ANY write, so nothing is half-closed.
    assert.equal(stage.status, STAGE_STATUS.PENDING);
    assert.equal(stage.actualCompletion, null);
  });

  test('the ordering refusal comes FIRST, ahead of the field one', async () => {
    const order = await create();

    // Stage 6 is both out of order AND missing its fields. Being told to fill
    // in a form for a stage that cannot be completed yet is the wrong refusal:
    // the user would supply them and be refused again.
    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: STAGES.CREATE_ORDER_LIST,
        actor: actor('Billing'), now: NOW, evidence: {},
      }),
      (e) => e.code === 'O2D_PREREQUISITE_INCOMPLETE',
    );
  });

  test('supplied values are stored on the stage', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW,
    });
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SEND_SOR_PI,
      actor: actor('Billing'), now: NOW,
      evidence: { piNumber: 'PI-2026-0001', sorReference: 'SOR-4471' },
    });

    const stage = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.SEND_SOR_PI,
    }).lean();
    assert.equal(stage.evidence.piNumber, 'PI-2026-0001');
    assert.equal(stage.evidence.sorReference, 'SOR-4471');
  });
});

// ---------------------------------------------------------------------------

describe('values are coerced to the type their field declares', () => {
  test('a number arrives as a number, not the string the browser sent', async () => {
    const order = await create();
    await advanceTo(order, STAGES.PACK_AND_DISPATCH);

    await closeStage({
      orderId: order._id, stageNumber: STAGES.PACK_AND_DISPATCH,
      actor: actor('Warehouse User'), now: NOW,
      evidence: { transporter: 'Blue Dart', awbNumber: 'AWB-1', boxCount: '4', weightKg: '12.5' },
    });

    const stage = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.PACK_AND_DISPATCH,
    }).lean();
    assert.strictEqual(stage.evidence.boxCount, 4);
    assert.strictEqual(stage.evidence.weightKg, 12.5);
  });

  test('a NO answer counts as answered', async () => {
    const order = await create();
    await advanceTo(order, STAGES.SEND_DISPATCH_DETAILS);

    // `false` is an answer. A bare truthiness check would reject it and then
    // complain the user had not filled in a field they had.
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SEND_DISPATCH_DETAILS,
      actor: actor('Billing'), now: NOW,
      evidence: { mailReference: 'MAIL-1', whatsappSent: false },
    });

    const stage = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.SEND_DISPATCH_DETAILS,
    }).lean();
    assert.strictEqual(stage.evidence.whatsappSent, false);
  });

  test('a number below its minimum is refused', async () => {
    const order = await create();
    await advanceTo(order, STAGES.PACK_AND_DISPATCH);

    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: STAGES.PACK_AND_DISPATCH,
        actor: actor('Warehouse User'), now: NOW,
        evidence: { transporter: 'X', awbNumber: 'A', boxCount: 0, weightKg: 1 },
      }),
      (e) => e.code === 'O2D_STAGE_FIELD_INVALID' && e.field === 'boxCount',
    );
  });
});

// ---------------------------------------------------------------------------

describe('the two stages that need a file', () => {
  test('stage 2 will not close until the PO copy is on file', async () => {
    const order = await create();

    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
        actor: actor('Billing'), now: NOW, evidence: {},
      }),
      (e) => e.code === 'O2D_STAGE_DOCUMENT_REQUIRED',
    );
  });

  test('a claim in the payload does not satisfy it — the document must exist', async () => {
    const order = await create();

    // Anyone can put `poCopy: true` in a JSON body. Nobody can conjure a row in
    // the documents collection.
    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
        actor: actor('Billing'), now: NOW, evidence: { poCopy: true },
      }),
      (e) => e.code === 'O2D_STAGE_DOCUMENT_REQUIRED',
    );
  });

  test('and closes once it is', async () => {
    const order = await create();
    await O2dDocument.create({
      order: order._id, poNumber: order.poNumber, docType: 'PO',
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      storageKey: 'o2d/x/po.pdf', contentType: 'application/pdf', uploadedAt: new Date(),
    });

    const { stage } = await completeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW, evidence: {},
    });
    assert.ok([STAGE_STATUS.DONE_ON_TIME, STAGE_STATUS.DONE_LATE].includes(stage.status));
  });

  test('a deleted document stops satisfying the requirement', async () => {
    const order = await create();
    await O2dDocument.create({
      order: order._id, poNumber: order.poNumber, docType: 'PO',
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      storageKey: 'o2d/x/po.pdf', contentType: 'application/pdf',
      uploadedAt: new Date(), deletedAt: new Date(),
    });

    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
        actor: actor('Billing'), now: NOW, evidence: {},
      }),
      (e) => e.code === 'O2D_STAGE_DOCUMENT_REQUIRED',
    );
  });
});

// ---------------------------------------------------------------------------

describe('the specification itself', () => {
  test('stage 1 asks for nothing on completion — it is the intake form', () => {
    // Its fields live on the order and are collected when it is created.
    assert.deepEqual(fieldsForStage(STAGES.RECEIVE_ORDER), []);
  });

  test('stage 4 asks for nothing here — the decision has its own endpoint', () => {
    // "Advance order?" branches the workflow; it cannot be a free-form note.
    assert.deepEqual(fieldsForStage(STAGES.ADVANCE_DECISION), []);
  });

  test('only stages 2 and 12 demand a file', () => {
    const withDocs = Object.keys(STAGE_COMPLETION_FIELDS)
      .map(Number)
      .filter((n) => requiredDocTypeFor(n));
    assert.deepEqual(withDocs.sort((a, b) => a - b), [2, 12]);
  });

  test('no stage asks the user for the actual completion time', () => {
    // §33: the engine stamps it. A field here would let anyone set their own
    // SLA result.
    for (const n of Object.keys(STAGE_COMPLETION_FIELDS).map(Number)) {
      const keys = fieldsForStage(n).map((f) => f.key.toLowerCase());
      assert.ok(
        !keys.some((k) => k.includes('actualcompletion') || k === 'completedat'),
        `stage ${n} must not ask for the actual time`,
      );
    }
  });

  test('every field carries what a form needs to render it', () => {
    for (const n of Object.keys(STAGE_COMPLETION_FIELDS).map(Number)) {
      for (const f of fieldsForStage(n)) {
        assert.ok(f.key, `stage ${n}: every field needs a key`);
        assert.ok(f.label, `stage ${n}: ${f.key} needs a label`);
        assert.ok(f.type, `stage ${n}: ${f.key} needs a type`);
      }
    }
  });
});
