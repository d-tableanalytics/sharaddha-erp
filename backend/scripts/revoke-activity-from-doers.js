/**
 * One-off: take the Activity Log (work_queue.activity:view) away from roles
 * that only held it because the cell used to ride on `view_work_queue`.
 *
 *   node scripts/revoke-activity-from-doers.js            # report only
 *   node scripts/revoke-activity-from-doers.js --apply    # write
 *
 * WHY THIS EXISTS. Role rows store grants by CELL. When the cell's key changed
 * from view_work_queue to view_work_queue_activity, every task-doer role kept
 * the cell it had already been given, and seed-role-baselines only ever ADDS
 * cells - so the link and the API stayed open to them.
 *
 * Keeps the cell on: wildcard roles (they resolve everything anyway) and the
 * roles named in KEEP. Any other role holding it is listed and, with --apply,
 * has ONLY that one action removed. Custom roles are listed too - if someone
 * granted one the Activity Log on purpose, add its name to KEEP and re-run.
 */
import mongoose from 'mongoose';

import { connectDatabase } from '../config/database.js';
import Role from '../models/Role.js';

const APPLY = process.argv.includes('--apply');
const KEEP = new Set(['Management']);

const run = async () => {
  await connectDatabase();
  console.log(`\n[revoke-activity] mode: ${APPLY ? 'APPLY' : 'REPORT ONLY'}\n`);

  let changed = 0;
  for (const role of await Role.find({}).lean()) {
    if (role.isSuperAdmin || KEEP.has(role.name)) continue;
    const cell = (role.grants || []).find((g) => g.module === 'work_queue' && g.submodule === 'activity');
    if (!cell?.actions?.includes('view')) continue;

    console.log(`  ~ ${role.name}: removing work_queue.activity:view`);
    changed += 1;
    if (!APPLY) continue;

    const grants = role.grants
      .map((g) => (g === cell ? { ...g, actions: g.actions.filter((a) => a !== 'view') } : g))
      .filter((g) => g.actions.length > 0);
    await Role.updateOne({ _id: role._id }, { $set: { grants } });
  }

  console.log(`\n  roles affected: ${changed}`);
  if (!APPLY) console.log('  Nothing was written. Re-run with --apply.\n');
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
