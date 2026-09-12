/**
 * The twelve stages, as the business described them.
 *
 * ---------------------------------------------------------------------------
 * SEEDED, NOT HARDCODED — AND ONLY WHEN THE COLLECTION IS EMPTY
 * ---------------------------------------------------------------------------
 *
 * §37 requires an administrator to change an SLA without a code change, so these
 * values are a STARTING POINT written into `o2d_stage_master`, not a constant
 * the engine reads. Once seeded, the admin screen owns them.
 *
 * The seed is therefore per-stage and idempotent: a stage absent from the
 * collection is inserted, a stage already there is left ALONE. Re-running this
 * on a live system must never silently revert an SLA somebody deliberately
 * tuned — which is exactly what a `deleteMany` + `insertMany` seed would do.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Each is quoted from the brief in the comment beside it. Two are worth calling
 * out because they are not durations:
 *
 *   Stage 6   "Same day by 5:00 PM" — a CLOCK TIME, so a stage that starts at
 *             4:00 PM has one hour, not a full allowance. That is intended: the
 *             cut-off exists because of what happens after 5:00 PM.
 *   Stage 11  "Next working day by 11:45 AM" — likewise.
 *
 * And one is deliberately CALENDAR days rather than working days:
 *
 *   Stage 5   "7 calendar days" for the advance payment. A customer's bank does
 *             not observe our office hours, and counting only open days would
 *             quietly give them nine or ten real days.
 */

import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { STAGES, SLA_TYPES } from '../shared/constants/o2d.js';

/**
 * Role names must match `config/permissions.js` exactly.
 *
 * `Billing`, `Accounts` and `Billing Head` are new roles added for O2D — the
 * portal previously had no such thing, and they own eight of the twelve stages.
 */
export const O2D_STAGE_SEED = Object.freeze([
  {
    stageNumber: STAGES.RECEIVE_ORDER,
    key: 'receive_order',
    name: 'Receive Order',
    description: 'Customer PO received; Sales/PC keys the order into the ERP.',
    ownerRole: 'Sales',
    alsoAllowedRoles: ['Admin', 'Super Admin'],
    escalationRole: 'Management',
    // Completed by the act of creating the order, so its deadline is nominal.
    slaType: SLA_TYPES.WORKING_MINUTES,
    slaValue: 0,
    order: 1,
  },
  {
    stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    key: 'submit_po_to_billing',
    name: 'Submit PO to Billing',
    description: 'Sales hands the PO to Billing, who acknowledge receipt.',
    ownerRole: 'Sales',
    alsoAllowedRoles: ['Billing', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // "Target: 5 minutes after Stage 01"
    slaType: SLA_TYPES.WORKING_MINUTES,
    slaValue: 5,
    // §5: the BILLING acknowledgement is the actual timestamp, not Sales' send.
    completedByRole: 'Billing',
    order: 2,
  },
  {
    stageNumber: STAGES.SEND_SOR_PI,
    key: 'send_sor_pi',
    name: 'Send SOR + PI to Customer',
    description: 'Billing sends the Sales Order Report and Proforma Invoice.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // "Target: 3 working hours after Stage 02"
    slaType: SLA_TYPES.WORKING_HOURS,
    slaValue: 3,
    order: 3,
  },
  {
    stageNumber: STAGES.ADVANCE_DECISION,
    key: 'advance_decision',
    name: 'Advance Order Decision',
    description: 'Is this an advance-payment order? Decides whether stage 5 applies.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // The brief sets no target; a same-day decision keeps the order moving
    // without inventing a tighter promise than the business made.
    slaType: SLA_TYPES.SAME_DAY_BY,
    slaByMinute: 18 * 60 + 30,
    order: 4,
  },
  {
    stageNumber: STAGES.RECEIVE_ADVANCE,
    key: 'receive_advance',
    name: 'Receive Advance Payment',
    description: 'Accounts record the advance. Skipped when stage 4 says no advance.',
    ownerRole: 'Accounts',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // "Target: 7 calendar days" — see the note above on why not working days.
    slaType: SLA_TYPES.CALENDAR_DAYS,
    slaValue: 7,
    // The ONLY skippable stage today.
    skippable: true,
    order: 5,
  },
  {
    stageNumber: STAGES.CREATE_ORDER_LIST,
    key: 'create_order_list',
    name: 'Create Order List',
    description: 'Replaces the Google Form. Generated from the order, not re-keyed.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // "Target: Same day by 5:00 PM"
    slaType: SLA_TYPES.SAME_DAY_BY,
    slaByMinute: 17 * 60,
    order: 6,
  },
  {
    stageNumber: STAGES.WAREHOUSE_PICKING,
    key: 'warehouse_picking',
    name: 'Warehouse Picking Request',
    description: 'Billing raises the picking instruction; the warehouse acknowledges it.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Warehouse User', 'Admin', 'Super Admin'],
    escalationRole: 'Management',
    // "Target: 12 working hours after Stage 06"
    slaType: SLA_TYPES.WORKING_HOURS,
    slaValue: 12,
    // §10, in capitals: the WAREHOUSE acknowledgement is the actual timestamp.
    // Using Billing's push would credit the warehouse with work it had not seen.
    completedByRole: 'Warehouse User',
    order: 7,
  },
  {
    stageNumber: STAGES.SCAN_AND_INVOICE,
    key: 'scan_and_invoice',
    name: 'Scan Material + Create Invoice',
    description: 'Scan and validate the material, then raise the tax invoice in Zoho Books.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // "Target: 12 working hours after Stage 07"
    slaType: SLA_TYPES.WORKING_HOURS,
    slaValue: 12,
    order: 8,
  },
  {
    stageNumber: STAGES.PACK_AND_DISPATCH,
    key: 'pack_and_dispatch',
    name: 'Pack & Dispatch',
    description: 'Warehouse packs, records boxes/weight/transporter/AWB, and dispatches.',
    ownerRole: 'Warehouse User',
    alsoAllowedRoles: ['Admin', 'Super Admin'],
    escalationRole: 'Management',
    // "Target: Same day by 6:30 PM" — the close of business.
    slaType: SLA_TYPES.SAME_DAY_BY,
    slaByMinute: 18 * 60 + 30,
    order: 9,
  },
  {
    stageNumber: STAGES.MARK_SENT_IN_ZOHO,
    key: 'mark_sent_in_zoho',
    name: 'Mark Sent in Zoho',
    description: 'The invoice is marked Sent in Zoho Books. Intended to become a webhook.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // No target given. Same-day keeps the books current without inventing one.
    slaType: SLA_TYPES.SAME_DAY_BY,
    slaByMinute: 18 * 60 + 30,
    order: 10,
  },
  {
    stageNumber: STAGES.SEND_DISPATCH_DETAILS,
    key: 'send_dispatch_details',
    name: 'Send Dispatch Details',
    description: 'Invoice, AWB and transporter sent to the customer, on the stage 3 thread.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // "Target: Next working day by 11:45 AM"
    slaType: SLA_TYPES.NEXT_WORKING_DAY_BY,
    slaByMinute: 11 * 60 + 45,
    order: 11,
  },
  {
    stageNumber: STAGES.UPLOAD_AWB_AND_CLOSE,
    key: 'upload_awb_and_close',
    name: 'Upload AWB/LR + Close Order',
    description: 'AWB/LR copy uploaded, closing remark recorded, order closed.',
    ownerRole: 'Billing',
    alsoAllowedRoles: ['Billing Head', 'Admin', 'Super Admin'],
    escalationRole: 'Billing Head',
    // No target given; one working day after dispatch details is the natural
    // close and is conservative.
    slaType: SLA_TYPES.WORKING_DAYS,
    slaValue: 1,
    order: 12,
  },
]);

/**
 * Insert any stage that is missing. Never overwrite one that exists.
 *
 * Returns what it did, so `server.js` can say so at boot rather than leaving an
 * operator to guess whether the masters were ever seeded.
 */
export async function seedO2dStages() {
  const existing = await O2dStageMaster.find({}, 'stageNumber').lean();
  const present = new Set(existing.map((s) => s.stageNumber));

  const missing = O2D_STAGE_SEED.filter((s) => !present.has(s.stageNumber));
  if (missing.length === 0) return { inserted: 0, kept: present.size };

  await O2dStageMaster.insertMany(missing);
  return { inserted: missing.length, kept: present.size };
}

export default { O2D_STAGE_SEED, seedO2dStages };
