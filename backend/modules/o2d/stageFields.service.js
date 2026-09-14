/**
 * Enforcing the stage-wise completion fields.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ON THE SERVER AND NOT ONLY IN THE FORM
 * ---------------------------------------------------------------------------
 *
 * The form collects what a stage needs; this refuses a completion that arrives
 * without it. Both read the same spec, so they cannot disagree about WHICH
 * fields — but only one of them is actually in the way.
 *
 * A required field enforced purely in React is enforced for exactly as long as
 * nobody uses the API directly, and the fields here are not cosmetic: stage 9's
 * AWB number is what the customer chases the courier with, stage 8's invoice
 * number is what they pay against. A stage closed without them looks complete
 * and is not.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * No workflow, SLA, sequence or permission decision is made here. It reads the
 * submitted evidence, compares it to the stage's own field list, and either
 * says nothing or names what is missing. The engine still owns everything else.
 */

import { O2dDocument } from '../../models/o2d/O2dDocument.js';
import {
  STAGE_FIELD_TYPES, fieldsForStage, requiredDocTypeFor,
} from '../../shared/constants/o2dStageFields.js';

/**
 * A refusal, shaped like the engine's.
 *
 * Built here rather than imported from `stage.engine.js`, because the engine
 * now CALLS this module — importing its error back would be a cycle, and the
 * only thing needed from it is a plain object with `status` and `code`, which
 * the error handler reads structurally.
 */
const fieldError = (message, code, field) =>
  Object.assign(new Error(message), { status: 400, code, field });

/**
 * Is a submitted value actually present?
 *
 * `false` and `0` ARE present — "Part Payment: No" and "Box Count: 0" are
 * answers, and a bare truthiness test would reject both and then complain that
 * the user had not filled in a field they had. Only null, undefined and blank
 * text count as missing.
 */
const isBlank = (v) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Coerce a submitted value to the type its field declares.
 *
 * The browser sends everything as a string; a number field arriving as "12"
 * should be stored as 12, so a later reader is not comparing strings.
 */
function coerce(field, raw) {
  if (isBlank(raw)) return null;

  switch (field.type) {
    case STAGE_FIELD_TYPES.NUMBER: {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw fieldError(`${field.label} must be a number.`, 'O2D_STAGE_FIELD_INVALID', field.key);
      }
      if (field.min != null && n < field.min) {
        throw fieldError(
          `${field.label} cannot be less than ${field.min}.`,
          'O2D_STAGE_FIELD_INVALID', field.key,
        );
      }
      return n;
    }
    case STAGE_FIELD_TYPES.DATE: {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw fieldError(
          `${field.label} is not a valid date.`, 'O2D_STAGE_FIELD_INVALID', field.key,
        );
      }
      return d;
    }
    case STAGE_FIELD_TYPES.BOOLEAN:
      // A select sends "true"/"false"; an API client sends a real boolean.
      return raw === true || raw === 'true' || raw === 'yes';
    default:
      return String(raw).trim();
  }
}

/**
 * Check a stage's completion evidence, and return it cleaned.
 *
 * @returns the evidence to store — coerced, and with nothing the stage did not
 *          ask for. Unknown keys are dropped rather than refused: an older
 *          client sending a field that has since been removed should not be
 *          unable to close a stage over it.
 * @throws  O2dWorkflowError naming the FIRST missing field, so the form can put
 *          the message on the input rather than in a banner.
 */
export async function validateStageEvidence(orderId, stageNumber, evidence = {}) {
  const fields = fieldsForStage(stageNumber);
  if (fields.length === 0) return evidence ?? null;

  const submitted = evidence ?? {};
  const clean = {};

  for (const field of fields) {
    // A document is not carried in `evidence` — it is checked below.
    if (field.type === STAGE_FIELD_TYPES.DOCUMENT) continue;

    const value = coerce(field, submitted[field.key]);

    if (field.required && (value === null || value === '')) {
      throw fieldError(
        `${field.label} is required to complete this stage.`,
        'O2D_STAGE_FIELD_REQUIRED', field.key,
      );
    }
    if (value !== null) clean[field.key] = value;
  }

  /**
   * The file, if this stage will not close without one.
   *
   * Checked as "a document of this type exists on this order" rather than as a
   * flag in the payload, because a flag is a claim and this is the fact. A
   * caller can set `poCopy: true` in a JSON body; they cannot conjure a row in
   * `o2d_documents`.
   *
   * Scoped by `deletedAt: null` so a document uploaded and then removed does
   * not keep satisfying the requirement.
   */
  const docType = requiredDocTypeFor(stageNumber);
  if (docType) {
    const field = fields.find((f) => f.type === STAGE_FIELD_TYPES.DOCUMENT);
    const exists = await O2dDocument.exists({
      order: orderId,
      docType,
      deletedAt: null,
    });
    if (!exists) {
      throw fieldError(
        `${field.label} must be uploaded before this stage can be completed.`,
        'O2D_STAGE_DOCUMENT_REQUIRED', field.key,
      );
    }
  }

  return Object.keys(clean).length > 0 ? clean : null;
}

export default { validateStageEvidence };
