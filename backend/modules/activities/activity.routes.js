import express from 'express';
import { protect } from '../../middlewares/auth.js';
import { authorize, PERMISSIONS } from '../../middlewares/rbac.js';
import { getActivities } from './activity.controller.js';

const router = express.Router();

// Both routes require authentication and view_o2d permission (Work Queue access)
router.use(protect, authorize(PERMISSIONS.VIEW_O2D));

router.get('/', getActivities);

export default router;
