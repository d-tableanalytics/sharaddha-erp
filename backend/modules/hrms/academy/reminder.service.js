/**
 * The Academy reminder sweep.
 *
 * Section 18 asks for "due soon" and "overdue" notifications. Neither can be
 * raised by a request, because nothing happens when a deadline passes - that is
 * precisely what makes a deadline different from an event. So they need a
 * scheduled producer, and this is it.
 *
 * ---------------------------------------------------------------------------
 * 🔴 IT DOES NOT SPAM, AND THAT IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 * A daily sweep that notifies everything currently overdue sends the same
 * person the same message every morning until they act. After four days they
 * stop reading any notification from this system, including the ones that
 * matter.
 *
 * So the sweep notifies on a TRANSITION, not on a state: it compares today's
 * due state against `lastReminderState` and writes only when it has changed.
 * Over the life of one assignment that is at most two notifications - one when
 * it becomes due soon, one when it becomes overdue - however often the sweep
 * runs. Running it hourly instead of daily would produce the same two.
 *
 * ---------------------------------------------------------------------------
 * 🔴 IT IS OFF BY DEFAULT
 * ---------------------------------------------------------------------------
 * It SENDS things to people, and both portals point at the same database. The
 * retention sweep's header and SHARED-CONTRACT.md §4 set the rule: every
 * scheduled writer needs exactly one owner, and the switch defaults to off so
 * ownership is answerable from one environment variable per deployment rather
 * than from remembering which repository was edited when.
 *
 * Unlike the retention sweep there is no hand-over to coordinate - SI Academy
 * exists only in this repository - so enabling it is a single decision. The
 * damage from getting it wrong is also asymmetric in the usual direction: a
 * reminder nobody can un-send.
 */

import { LearningAssignment } from '../../../models/hrms/AcademyModels.js';
import { notify } from '../inbox/notifier.service.js';
import { INBOX_TYPES } from '../../../shared/constants/inbox.js';
import { recordSystemAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS } from '../../../shared/constants/hrms.js';
import { toDay, deriveDueState } from '../../../shared/academy/progress.js';
import { idStr } from './academy.shared.js';

/** How many assignments one sweep will examine. Bounds a runaway pass. */
const SWEEP_BATCH = 2000;

/**
 * Raise due-soon and overdue notifications.
 *
 * @param {object}  [options]
 * @param {string}  [options.today]    `YYYY-MM-DD`, injectable for tests
 * @param {boolean} [options.dryRun]   count without writing or notifying
 * @returns {Promise<{ examined, dueSoon, overdue, skipped, dryRun }>}
 */
export async function runAcademyReminderSweep({ today = toDay(new Date()), dryRun = false } = {}) {
  const started = Date.now();

  /**
   * Only LIVE, DATED assignments can be reminded about.
   *
   * A completed one has nothing outstanding; a cancelled one was withdrawn; one
   * with no due date has no deadline to be approaching. Narrowed in the query
   * rather than filtered afterwards, so a company with years of completed
   * history does not pay for it on every sweep.
   */
  const candidates = await LearningAssignment.find({
    status: { $in: ['assigned', 'in_progress'] },
    dueDate: { $ne: null },
  })
    .select('employeeId pathName dueDate status lastReminderState')
    .sort({ dueDate: 1 })
    .limit(SWEEP_BATCH)
    .lean();

  let dueSoon = 0;
  let overdue = 0;
  let skipped = 0;

  for (const row of candidates) {
    const { state } = deriveDueState(row.dueDate, row.status, today);

    // Only the two states worth telling somebody about.
    if (state !== 'due_soon' && state !== 'overdue') {
      skipped += 1;
      continue;
    }

    // THE TRANSITION CHECK. Already told them this; say nothing.
    if (row.lastReminderState === state) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      if (state === 'overdue') overdue += 1;
      else dueSoon += 1;
      continue;
    }

    /**
     * Mark BEFORE notifying.
     *
     * If the write succeeds and the notification then fails, the person misses
     * one reminder. If the notification succeeds and the mark then fails, they
     * get the same reminder every day forever. Of the two, missing one is the
     * failure to prefer - and `notify` never throws anyway, so the second order
     * would only ever lose the mark.
     */
    await LearningAssignment.updateOne(
      { _id: row._id },
      { $set: { lastReminderState: state, lastReminderAt: new Date() } },
    );

    const due = deriveDueState(row.dueDate, row.status, today);

    await notify({
      to: idStr(row.employeeId),
      type: state === 'overdue' ? INBOX_TYPES.ACADEMY_OVERDUE : INBOX_TYPES.ACADEMY_DUE_SOON,
      title:
        state === 'overdue'
          ? `Overdue: ${row.pathName}`
          : `Due soon: ${row.pathName}`,
      // The computed phrase, so "Due tomorrow" and "Overdue by 2 days" read the
      // same here as on the card the notification links to.
      body: due.label,
      entity: 'academy_assignment',
      entityId: idStr(row._id),
    });

    if (state === 'overdue') overdue += 1;
    else dueSoon += 1;
  }

  const summary = {
    examined: candidates.length,
    dueSoon,
    overdue,
    skipped,
    dryRun,
    durationMs: Date.now() - started,
    /** True when the batch ceiling was hit and another pass is warranted. */
    truncated: candidates.length === SWEEP_BATCH,
  };

  /**
   * A system audit entry, not a user one - no actor and no request, so a
   * scheduled action is never mistaken for one a person performed. Counts
   * only: who was reminded about what is already in their inbox, and a second
   * copy in the audit trail would be readable by every auditor.
   */
  if (!dryRun && (dueSoon > 0 || overdue > 0)) {
    await recordSystemAudit(
      AUDIT_ACTIONS.ACADEMY_ASSIGNED,
      `SI Academy reminder sweep: ${dueSoon} due soon, ${overdue} overdue`,
      summary,
    );
  }

  return summary;
}

export default { runAcademyReminderSweep };
