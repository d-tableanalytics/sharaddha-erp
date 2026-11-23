#!/usr/bin/env node
/**
 * Give every staff portal account the HRMS employee record it should have.
 *
 *   node scripts/hrms/sync-portal-employees.js              # dry run, writes nothing
 *   node scripts/hrms/sync-portal-employees.js --execute    # creates the records
 *   node scripts/hrms/sync-portal-employees.js --retry      # drain the failure backlog too
 *   node scripts/hrms/sync-portal-employees.js --status     # just show the backlog
 *
 * DRY RUN IS THE DEFAULT. It prints the exact list of accounts that would get a
 * record, so the whole effect is readable before any of it happens.
 *
 * ---------------------------------------------------------------------------
 * WHEN THIS IS NEEDED
 * ---------------------------------------------------------------------------
 * Almost never, and that is the point. The portal syncs inline on every user
 * create and update, and `server.js` runs the same reconciliation nightly and
 * once at boot. This script is the operator's copy of that sweep, for three
 * situations the automatic ones do not cover well:
 *
 *   - THE FIRST DEPLOY, where somebody sensibly wants to see the list of
 *     records about to be created before the boot sweep creates them.
 *   - A DEPLOYMENT WITH THE CRON OFF (HRMS_EMPLOYEE_SYNC_CRON=disabled).
 *   - DIAGNOSIS, when `--status` is the fastest way to see what is failing and
 *     why without opening a mongo shell.
 *
 * It is idempotent. An account that already has a record is skipped, because
 * the mapping is `User._id` -> `Employee.userId` and that is enforced by a
 * unique index - so running it twice cannot produce two employees for one
 * person, and neither can running it while the server is running.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO
 * ---------------------------------------------------------------------------
 * It never resurrects a DEACTIVATED employee record. Deactivating one is the
 * documented way to say "this login is not a person" - a service account, an
 * integration - and a sweep that undid that every night would make the opt-out
 * useless. Those accounts are reported as skipped.
 *
 * It never touches a Customer. AD-4 makes a customer-portal account and an
 * employee mutually exclusive.
 */

import 'dotenv/config';
import path from 'node:path';
import mongoose from 'mongoose';

import { connectDatabase } from '../../config/database.js';
import {
  reconcileEmployeeRecords,
  retryFailedSyncs,
  listSyncFailures,
} from '../../modules/hrms/employees/employeeSync.service.js';

const parseArgs = (argv) => ({
  execute: argv.includes('--execute'),
  retry: argv.includes('--retry'),
  statusOnly: argv.includes('--status'),
});

const line = (s = '') => console.log(s);

async function printBacklog() {
  const pending = await listSyncFailures({ limit: 200 });
  if (pending.length === 0) {
    line('Backlog: empty — every staff account has its HRMS record.');
    return 0;
  }

  line(`Backlog: ${pending.length} account(s) still without an HRMS record.`);
  line();
  for (const job of pending) {
    line(`  ${job.email ?? job.userId}`);
    line(`    attempts     ${job.attempts}`);
    line(`    last error   ${job.lastError}`);
    line(`    next attempt ${job.nextAttemptAt?.toISOString?.() ?? job.nextAttemptAt}`);
  }
  return pending.length;
}

async function main({ argv = process.argv.slice(2), connect = connectDatabase } = {}) {
  const { execute, retry, statusOnly } = parseArgs(argv);

  await connect();
  try {
    if (statusOnly) {
      const count = await printBacklog();
      return { backlog: count };
    }

    if (retry && execute) {
      const r = await retryFailedSyncs({ limit: 500 });
      line(
        `Retry: ${r.succeeded} synced, ${r.stillFailing} still failing, `
          + `${r.abandoned} abandoned (of ${r.attempted} queued).`,
      );
      line();
    } else if (retry) {
      line('--retry needs --execute; skipping the backlog drain.');
      line();
    }

    const summary = await reconcileEmployeeRecords({ dryRun: !execute, limit: 100_000 });

    if (!execute) {
      line(`DRY RUN — nothing was written. ${summary.examined} account(s) examined.`);
      line();
      if (summary.wouldCreate.length === 0) {
        line('No account is missing an HRMS employee record.');
      } else {
        line(`${summary.wouldCreate.length} account(s) would get a record:`);
        for (const u of summary.wouldCreate) {
          line(`  ${u.email}${u.name ? ` (${u.name})` : ''}`);
        }
        line();
        line('Re-run with --execute to create them.');
      }
    } else {
      line(
        `Created ${summary.created}, updated ${summary.updated}, skipped ${summary.skipped}, `
          + `failed ${summary.failed} (of ${summary.examined} accounts examined).`,
      );
      if (summary.failed > 0) {
        line();
        await printBacklog();
        process.exitCode = 1;
      }
    }

    return summary;
  } finally {
    await mongoose.disconnect();
  }
}

const isDirect = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirect) {
  main().catch(async (error) => {
    console.error('\nFAILED:', error.message);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exitCode = 1;
  });
}

export { main };
