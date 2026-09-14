/**
 * Close a stage in a test, supplying whatever that stage requires.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * Stages now refuse to complete without their specified fields — stage 9 wants
 * a transporter and an AWB number, stage 2 wants the PO copy on file. That is
 * the point of the rule, and it is correctly enforced in the engine.
 *
 * But most tests that complete a stage are not testing the FORM. They are
 * testing stage order, the advance branch, the board, the history, the task
 * queue — and for those, the required fields are noise that would have to be
 * restated at forty call sites and re-edited every time the specification
 * gains a field.
 *
 * So this fills them from the same spec the server validates against. A test
 * about stage ordering says `closeStage({ orderId, stageNumber: 6, actor })`
 * and stays about stage ordering.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT BYPASS THE RULE
 * ---------------------------------------------------------------------------
 *
 * Everything goes through the real `completeStage` and the real validation.
 * The helper supplies values; it does not skip the check. A test that wants to
 * prove a stage REFUSES to close without its fields calls `completeStage`
 * directly — see o2d-stage-fields.test.js.
 */

import { completeStage } from '../../modules/o2d/stage.engine.js';
import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dDocument } from '../../models/o2d/O2dDocument.js';
import {
  STAGE_FIELD_TYPES, fieldsForStage,
} from '../../shared/constants/o2dStageFields.js';

/** A plausible value for a field, by type. Content is irrelevant; presence is not. */
function sampleFor(field, now) {
  switch (field.type) {
    case STAGE_FIELD_TYPES.NUMBER:
      // Honour `min` — stage 9's box count must be at least 1, and a helper
      // that cheerfully sent 0 would fail the very validation it exists to pass.
      return field.min ?? 1;
    case STAGE_FIELD_TYPES.DATE:
      return now.toISOString();
    case STAGE_FIELD_TYPES.BOOLEAN:
      return false;
    default:
      return `TEST-${field.key}`;
  }
}

/** Put the document a stage insists on into the collection it is looked for in. */
async function ensureDocument(orderId, docType, stageNumber) {
  const existing = await O2dDocument.exists({ order: orderId, docType, deletedAt: null });
  if (existing) return;

  const order = await O2dOrder.findById(orderId).select('poNumber').lean();
  await O2dDocument.create({
    order: orderId,
    poNumber: order?.poNumber ?? 'PO-TEST',
    docType,
    stageNumber,
    // Written straight into the collection: the validation asks whether a
    // document EXISTS, and driving multipart plus object storage to answer
    // that would make every workflow test depend on a file server.
    storageKey: `o2d/${orderId}/${docType.toLowerCase()}.pdf`,
    contentType: 'application/pdf',
    uploadedAt: new Date(),
  });
}

/**
 * `completeStage`, with the stage's required fields filled in.
 *
 * Anything passed in `evidence` WINS over the generated value, so a test that
 * cares about one field — the invoice number stage 8 copies onto the order —
 * can set just that one and let the rest fill themselves.
 */
export async function closeStage({
  orderId, stageNumber, actor = null, now = new Date(), evidence = {}, ...rest
}) {
  const generated = {};

  for (const field of fieldsForStage(stageNumber)) {
    if (field.type === STAGE_FIELD_TYPES.DOCUMENT) {
      if (field.required) await ensureDocument(orderId, field.docType, stageNumber);
      continue;
    }
    if (!field.required) continue;
    generated[field.key] = sampleFor(field, now);
  }

  return completeStage({
    orderId,
    stageNumber,
    actor,
    now,
    evidence: { ...generated, ...evidence },
    ...rest,
  });
}

export default { closeStage };
