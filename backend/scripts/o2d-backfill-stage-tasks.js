/**
 * Give every active O2D stage its Checklist / Delegation task.
 *
 *   npm run o2d:backfill-tasks               create the missing tasks
 *   npm run o2d:backfill-tasks -- --dry-run  only count them
 *
 * New stages get their task automatically the moment they become active. This
 * is for orders that were already open before that existed: without it, their
 * current stage appears in O2D My Tasks but not on anybody's Checklist.
 *
 * Safe to run more than once. A stage that already has its task is left alone,
 * and a task for a held order is created parked, exactly as the workflow would.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

import { connectDatabase } from '../config/database.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import {
  ensureStageTask, mirrorRefOf, mirrorKindForStage, MIRROR_KIND,
} from '../modules/o2d/stageMirror.service.js';
import { ORDER_STATUS, STAGE_STATUS } from '../shared/constants/o2d.js';

const ACTIVE = [STAGE_STATUS.PENDING, STAGE_STATUS.DUE_SOON, STAGE_STATUS.OVERDUE, STAGE_STATUS.ON_HOLD];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDatabase();

  const orders = await O2dOrder.find({ status: { $in: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD] } });
  let created = 0;
  let alreadyHad = 0;
  let noTaskNeeded = 0;
  let failed = 0;

  for (const order of orders) {
    const stages = await O2dOrderStage.find({ order: order._id, status: { $in: ACTIVE } });
    for (const stage of stages) {
      if (mirrorRefOf(stage).id) { alreadyHad += 1; continue; }
      // An unassigned decision stage (stage 4) is a Delegation task only once
      // somebody is named, so it has nothing to create.
      if (!stage.assignedTo && mirrorKindForStage(stage.stageNumber) !== MIRROR_KIND.CHECKLIST) {
        noTaskNeeded += 1;
        continue;
      }
      if (dryRun) { created += 1; continue; }
      try {
        await ensureStageTask(stage, { order });
        await stage.save();
        created += 1;
      } catch (error) {
        failed += 1;
        console.error(`  ${order.poNumber} stage ${stage.stageNumber}: ${error.message}`);
      }
    }
  }

  console.log(`${dryRun ? '[dry run] would create' : 'Created'} ${created} task(s) across ${orders.length} open order(s).`);
  console.log(`  already had a task: ${alreadyHad}   no task needed: ${noTaskNeeded}   failed: ${failed}`);

  await mongoose.disconnect();
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
});
