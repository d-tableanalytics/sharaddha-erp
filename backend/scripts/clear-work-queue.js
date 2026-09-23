/**
 * Empty the Work Queue — every collection it reads from, completely.
 *
 *   npm run work-queue:clear
 *
 * ---------------------------------------------------------------------------
 * WHAT "THE WORK QUEUE" ACTUALLY IS
 * ---------------------------------------------------------------------------
 * There is no single WorkQueue collection. The sidebar group of that name is
 * eight screens (My Work, Delegation, Loop Tasks, All Tasks, Deleted Tasks,
 * Checklist, Executive Scoreboard, Activities) reading from five underlying
 * collections:
 *
 *   Delegation           — My Work / Delegation / Loop Tasks / All Tasks /
 *                           Deleted Tasks are all the SAME collection, filtered
 *                           differently per screen.
 *   ChecklistRoutine      — the Checklist tab's recurring task definitions.
 *   ChecklistOccurrence   — the individual dated task instances a routine
 *                           generates.
 *   ScoreboardGoal        — the Executive Scoreboard's targets.
 *   Activity              — the Activities log.
 *
 * Clearing "the Work Queue" means emptying all five, unconditionally — this
 * script makes no distinction between seed data, test data and real data, on
 * request. It does not touch anything outside those five collections: not
 * Users, not O2D orders, not any other module's records.
 *
 * ---------------------------------------------------------------------------
 * A BACKUP IS TAKEN FIRST, ALWAYS
 * ---------------------------------------------------------------------------
 * `deleteMany({})` on a live Atlas cluster has no undo. Before anything is
 * removed, every document in every one of the five collections is written to
 * a timestamped JSON file under `backend/backups/work-queue-<timestamp>/` —
 * already `.gitignore`d, since a database dump is real employee data — one
 * file per collection. That happens whether or not anyone ever asked for it,
 * because the cost of writing it is a few seconds and the cost of not having
 * it, if this was run against the wrong thing, is unrecoverable.
 *
 * This is NOT a `--dry-run` flag gating the delete — the instruction to empty
 * the Work Queue was explicit and unconditional, so the script does exactly
 * that. The backup is the safety net for AFTER, not a prompt asking to
 * reconsider before.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

import { connectDatabase } from '../config/database.js';
import { ChecklistRoutine, ChecklistOccurrence } from '../models/Checklist.js';
import { Delegation } from '../models/Delegation.js';
import { ScoreboardGoal } from '../models/ScoreboardGoal.js';
import { Activity } from '../models/Activity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `backend/backups/` — not `scripts/backups/` — because `.gitignore` already
 * excludes exactly that directory for exactly this reason ("Database dumps
 * taken before destructive scripts — contain employee PII"). Landing anywhere
 * else risks a backup full of real names, statuses and remarks getting
 * `git add`-ed by accident.
 */
const BACKUP_ROOT = path.join(__dirname, '..', 'backups');

const TARGETS = [
  { name: 'Delegation', model: Delegation },
  { name: 'ChecklistRoutine', model: ChecklistRoutine },
  { name: 'ChecklistOccurrence', model: ChecklistOccurrence },
  { name: 'ScoreboardGoal', model: ScoreboardGoal },
  { name: 'Activity', model: Activity },
];

async function main() {
  await connectDatabase();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_ROOT, `work-queue-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log('[work-queue:clear] Backing up before deleting anything...');

  const before = [];
  for (const { name, model } of TARGETS) {
    const docs = await model.find({}).lean();
    fs.writeFileSync(
      path.join(backupDir, `${name}.json`),
      JSON.stringify(docs, null, 2),
    );
    before.push({ name, count: docs.length });
    console.log(`  ${name.padEnd(20)} ${String(docs.length).padStart(6)} document(s) backed up`);
  }
  console.log(`[work-queue:clear] Backup written to ${backupDir}`);

  console.log('[work-queue:clear] Deleting...');
  const results = [];
  for (const { name, model } of TARGETS) {
    const { deletedCount } = await model.deleteMany({});
    results.push({ name, deletedCount });
    console.log(`  ${name.padEnd(20)} ${String(deletedCount).padStart(6)} document(s) deleted`);
  }

  console.log('[work-queue:clear] Verifying every collection is now empty...');
  let allEmpty = true;
  for (const { name, model } of TARGETS) {
    const remaining = await model.countDocuments({});
    if (remaining > 0) {
      allEmpty = false;
      console.error(`  ${name.padEnd(20)} STILL HAS ${remaining} document(s)`);
    } else {
      console.log(`  ${name.padEnd(20)} empty`);
    }
  }

  const totalBefore = before.reduce((n, t) => n + t.count, 0);
  const totalDeleted = results.reduce((n, t) => n + t.deletedCount, 0);

  console.log('');
  console.log(`[work-queue:clear] ${totalDeleted} of ${totalBefore} document(s) removed across ${TARGETS.length} collections.`);
  console.log(`[work-queue:clear] Backup: ${backupDir}`);
  console.log(allEmpty ? '[work-queue:clear] The Work Queue is empty.' : '[work-queue:clear] ⚠ Some collections are NOT empty — see above.');

  await mongoose.disconnect();
  process.exitCode = allEmpty ? 0 : 1;
}

main().catch((error) => {
  console.error('[work-queue:clear] Failed:', error);
  process.exitCode = 1;
});
