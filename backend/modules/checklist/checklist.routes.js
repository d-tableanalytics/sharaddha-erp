/**
 * Checklist routes, mounted at /api/v1/checklist.
 *
 * Gated on `view_o2d` — the same permission that controls the Work Queue
 * sidebar group. Write operations (create/edit/stop routines, reassign) are
 * further restricted by the controller's own isManager check.
 */

import express from 'express';
import { protect } from '../../middlewares/auth.js';
import { authorize, PERMISSIONS } from '../../middlewares/rbac.js';
import {
  getTasks,
  getSummary,
  getRoutines,
  getDepartmentReport,
  createRoutine,
  updateRoutine,
  stopRoutine,
  completeTask,
  markNonFunctional,
  reassignTask,
  addRemark,
  drilldown,
  getUsers,
  getLocations,
  getDepartmentsList,
} from './checklist.controller.js';

const router = express.Router();

// All checklist routes require authentication + view_o2d permission
router.use(protect, authorize(PERMISSIONS.VIEW_O2D));

// ── Read ────────────────────────────────────────────────────────────────────
router.get('/tasks',            getTasks);
router.get('/summary',          getSummary);
router.get('/routines',         getRoutines);
router.get('/departments',      getDepartmentReport);
router.get('/tasks/drilldown',  drilldown);
router.get('/users',            getUsers);
router.get('/locations',        getLocations);
router.get('/departments-list', getDepartmentsList);

// ── Write ───────────────────────────────────────────────────────────────────
router.post('/routines',              createRoutine);
router.put('/routines/:id',           updateRoutine);
router.patch('/routines/:id/stop',    stopRoutine);
router.patch('/tasks/:id/complete',   completeTask);
router.patch('/tasks/:id/non-functional', markNonFunctional);
router.patch('/tasks/:id/reassign',   reassignTask);
router.post('/tasks/remark',          addRemark);

export default router;
