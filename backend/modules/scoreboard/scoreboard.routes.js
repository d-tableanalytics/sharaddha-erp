import express from 'express';
import { protect } from '../../middlewares/auth.js';
import { authorizeModule } from '../../middlewares/rbac.js';
import { getScoreboard, updateGoalOrAdjustment } from './scoreboard.controller.js';

const router = express.Router();

/**
 * The Executive Scoreboard, mounted at /api/v1/scoreboard.
 *
 * Both routes used to share one `view_o2d` gate, which made SETTING a
 * department's target the same permission as reading the chart. A goal is the
 * number everyone else on the board is measured against; whoever may look at
 * the scoreboard must not, by that fact alone, be able to move the bar.
 */
router.use(protect);

router.get('/', authorizeModule('work_queue', 'scoreboard', 'view'), getScoreboard);
router.post('/goals', authorizeModule('work_queue', 'scoreboard', 'edit'), updateGoalOrAdjustment);

export default router;
