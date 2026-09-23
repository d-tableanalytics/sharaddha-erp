import express from 'express';
import { protect } from '../../middlewares/auth.js';
import { authorizeModule } from '../../middlewares/rbac.js';
import { getActivities } from './activity.controller.js';

const router = express.Router();

/**
 * The Work Queue's audit log, mounted at /api/v1/activities.
 *
 * Was gated on `view_o2d` - FMS's key, on a Work Queue screen. A role granted
 * the Work Queue without FMS saw the Activities link in its own sidebar and got
 * a 403 on opening it.
 *
 * Read-only by nature: nothing in this module writes an activity, so `view` is
 * the only cell it needs.
 */
router.use(protect);

router.get('/', authorizeModule('work_queue', 'activity', 'view'), getActivities);

export default router;
