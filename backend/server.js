import dotenv from 'dotenv';
import http from 'http';
import cron from 'node-cron';

import app from './app.js';
import { connectDatabase } from './config/database.js';
import { describePortal } from './config/portal.js';
import { bootstrapHrms } from './modules/hrms/hrms.bootstrap.js';
import { runHrmsRetentionSweep } from './modules/hrms/retention/retention.sweep.js';
import { seedO2dStages } from './config/seedO2dStages.js';
import { runEscalationSweep, sendDailySummary } from './modules/o2d/escalation.service.js';
import { retryFailedInvoices } from './modules/o2d/invoicing.service.js';

dotenv.config();

const PORT = process.env.PORT || 5001;

const server = http.createServer(app);

/**
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROCESS DELIBERATELY DOES NOT DO
 * ───────────────────────────────────────────────────────────────────────────
 *
 * NO SEEDING. `seedDefaultRoles`, `seedInventoryDefaults` and `seedAlertRules`
 * stay in the Customer Portal and run there. They are idempotent, so running
 * them here would very probably be harmless — but "very probably harmless" is
 * not the standard for a process that shares a database with a live system.
 * One writer owns the seed, and it is the repository that has always owned it.
 * If the `roles` collection is ever genuinely empty, boot the Customer Portal.
 *
 * NO SOCKET.IO. The realtime channel carries inventory alerts, which are a
 * Customer Portal concern. HRMS's own notification centre (the inbox bell)
 * polls — see shared/constants/inbox.js — so nothing here needs a socket.
 *
 * NO RESERVATION / PO / IMPORT-SWEEP / REPORT JOBS. Those are the Customer
 * Portal's, and every one of them writes. Running a second copy against the
 * same database would settle the same purchase orders twice.
 */

// ───────────────────────────────────────────────────────────────────────────
// The one HRMS background job, and the reason it is OFF by default
// ───────────────────────────────────────────────────────────────────────────
//
// `runHrmsRetentionSweep` DELETES data — audit rows, attendance selfies,
// employee documents and inbox items past their configured window. It is
// currently scheduled by the Customer Portal's daily 00:00 cron, and both
// repositories point at the same database.
//
// Two processes running the same destructive sweep at the same minute is the
// exact failure §11 of the migration brief warns about. So the switch is
// explicit and defaults to OFF:
//
//   1. deploy this portal with HRMS_RETENTION_CRON=disabled (the default)
//   2. remove the runHrmsRetentionSweep call from the Customer Portal's cron
//   3. only then set HRMS_RETENTION_CRON=enabled here
//
// Ownership is then unambiguous and answerable from one environment variable
// per deployment, rather than from remembering which repo was edited when.
const RETENTION_CRON_ENABLED = process.env.HRMS_RETENTION_CRON === 'enabled';
const RETENTION_CRON_SCHEDULE = process.env.HRMS_RETENTION_CRON_SCHEDULE || '0 0 * * *';

// ───────────────────────────────────────────────────────────────────────────
// O2D BACKGROUND WORK
// ───────────────────────────────────────────────────────────────────────────
//
// The escalation sweep SENDS THINGS to people. Both repositories point at the
// same database, so two processes running it would mean every reminder twice —
// and unlike the retention sweep, the damage is not recoverable by re-running
// something: a manager cannot be un-emailed.
//
// The notification layer's unique `dedupeKey` makes a double-send a no-op even
// if this is misconfigured, so the guard here is defence in depth rather than
// the only thing standing between a user and duplicate mail. It still defaults
// to OFF, for the same reason the retention cron does: ownership should be
// answerable from one environment variable per deployment.
//
// O2D lives ONLY in this repository, so unlike retention there is no
// coordination step — set O2D_CRON=enabled on exactly one Employee Portal
// instance.
const O2D_CRON_ENABLED = process.env.O2D_CRON === 'enabled';
// Every 5 minutes. Tighter than the shortest SLA (5 working minutes for stage
// 2) would be pointless — the sweep cannot warn about a deadline before it has
// been set — and looser would let an overdue stage sit unnoticed for longer
// than the stage was allowed to take.
const O2D_SWEEP_SCHEDULE = process.env.O2D_SWEEP_SCHEDULE || '*/5 * * * *';
// 09:00, so it lands before the working day rather than during it.
//
// The TIMEZONE is pinned below rather than left to the server's clock. node-cron
// interprets an expression in SERVER LOCAL TIME by default, so "09:00" means
// 09:00 in whatever zone the host happens to run in — and a container defaulting
// to UTC would fire this at 14:30 IST, in the middle of the afternoon. The whole
// business runs on IST; the schedule should say so rather than depend on
// deployment configuration nobody will check.
const O2D_SUMMARY_SCHEDULE = process.env.O2D_SUMMARY_SCHEDULE || '0 9 * * *';
const O2D_CRON_TIMEZONE = process.env.O2D_CRON_TIMEZONE || 'Asia/Kolkata';
/**
 * Hourly, not every five minutes.
 *
 * An invoice that failed because Zoho was unreachable will still be failing a
 * minute later, and each attempt is a write against a billing system. The sweep
 * is a safety net for a transient outage, not a tight retry loop — and
 * `maxAttempts` stops a permanently broken invoice from being retried forever.
 */
const O2D_INVOICE_RETRY_SCHEDULE = process.env.O2D_INVOICE_RETRY_SCHEDULE || '15 * * * *';

const startServer = async () => {
  await connectDatabase();

  // Register the HRMS retention handlers, reference providers and file access
  // rules. Explicit and central, so what is armed in a running system is
  // answerable by reading modules/hrms/hrms.bootstrap.js — and so importing an
  // HRMS service from a script does not arm a background behaviour as a side
  // effect.
  bootstrapHrms();

  if (RETENTION_CRON_ENABLED) {
    cron.schedule(RETENTION_CRON_SCHEDULE, () => {
      console.log('[Cron] Running the HRMS retention sweep...');
      runHrmsRetentionSweep().catch((err) =>
        console.error('[Cron] HRMS retention sweep failed:', err.message),
      );
    });
    console.log(`[Cron] HRMS retention sweep scheduled: ${RETENTION_CRON_SCHEDULE}`);
  } else {
    console.log(
      '[Cron] HRMS retention sweep DISABLED (HRMS_RETENTION_CRON is not "enabled"). ' +
        'The Customer Portal is still running it. See the note in server.js.',
    );
  }

  /**
   * The twelve stages, if they are not there.
   *
   * Per-stage and idempotent: a stage already present is left ALONE, so a
   * restart cannot revert an SLA an administrator tuned. Safe to run on every
   * boot, and running it here means a fresh deployment works without somebody
   * remembering to run a script.
   */
  try {
    const seeded = await seedO2dStages();
    console.log(
      `[O2D] Stage master: ${seeded.inserted} inserted, ${seeded.kept} already present.`,
    );
  } catch (error) {
    // Not fatal. The engine refuses to create an order against an empty master
    // with a message that says so, which is a better failure than a server that
    // will not start.
    console.error('[O2D] Could not seed the stage master:', error.message);
  }

  if (O2D_CRON_ENABLED) {
    cron.schedule(O2D_SWEEP_SCHEDULE, () => {
      runEscalationSweep()
        .then((r) => {
          // Logged only when it did something. A line every five minutes saying
          // "0, 0, 0" is how a log stops being read.
          if (r.dueSoon || r.overdue || r.escalated) {
            console.log(
              `[O2D] Sweep: ${r.dueSoon} due-soon, ${r.overdue} overdue, ${r.escalated} escalated `
                + `(of ${r.scanned} open stages).`,
            );
          }
        })
        .catch((err) => console.error('[O2D] Escalation sweep failed:', err.message));
    });

    cron.schedule(
      O2D_SUMMARY_SCHEDULE,
      () => {
        sendDailySummary()
          .then((r) => console.log(`[O2D] Daily summary: ${r.sent ? 'sent' : r.reason}.`))
          .catch((err) => console.error('[O2D] Daily summary failed:', err.message));
      },
      { timezone: O2D_CRON_TIMEZONE },
    );

    cron.schedule(O2D_INVOICE_RETRY_SCHEDULE, () => {
      retryFailedInvoices()
        .then((r) => {
          // Silent when there was nothing to retry, for the same reason the
          // escalation sweep is.
          if (r.attempted) {
            console.log(
              `[O2D] Invoice retry: ${r.succeeded} succeeded, ${r.stillFailed} still failing `
                + `(of ${r.attempted} attempted).`,
            );
          }
        })
        .catch((err) => console.error('[O2D] Invoice retry failed:', err.message));
    });

    console.log(
      `[O2D] Escalation sweep scheduled: ${O2D_SWEEP_SCHEDULE}; `
        + `daily summary: ${O2D_SUMMARY_SCHEDULE} ${O2D_CRON_TIMEZONE}; `
        + `invoice retry: ${O2D_INVOICE_RETRY_SCHEDULE}.`,
    );
  } else {
    console.log('[O2D] Background sweeps DISABLED (O2D_CRON is not "enabled").');
  }

  server.listen(PORT, () => {
    // Named at boot because it decides which modules this process serves.
    console.log(describePortal());
    console.log(`[Server] Employee Portal (HRMS) backend running on port ${PORT}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

// Process Error Handling
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('[Process] Unhandled Rejection:', err);
  server.close(() => {
    process.exit(1);
  });
});

startServer();
