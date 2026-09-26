/**
 * Checklist routes, mounted at /api/v1/checklist.
 *
 * ---------------------------------------------------------------------------
 * ONE KEY FOR FIFTEEN ROUTES WAS NOT AN ACCESS MODEL
 * ---------------------------------------------------------------------------
 *
 * Every route here - eight reads and seven writes - used to sit behind a single
 * `router.use(authorize(VIEW_O2D))`. Two things were wrong with that, and they
 * compound:
 *
 *   The ACTION was not checked. Anyone who could open the Order Tracker could
 *   create a routine, stop one, complete somebody's occurrence and reassign it.
 *   "View only" was not expressible for this module, because view was the only
 *   thing anybody was ever asked for.
 *
 *   The MODULE was wrong. `view_o2d` is FMS. The checklist is Work Queue, and
 *   the two are separately grantable - so a role given the Work Queue and not
 *   FMS got 403s on a screen in its own sidebar, while a role given FMS
 *   read-only got full write access to a module it was never granted.
 *
 * Each route now names the cell it belongs to, and the cells are the ones the
 * Super Admin sees in the matrix. The controller's own `isManager` checks stay
 * where they are: they answer WHOSE records, which a route-level permission
 * cannot express.
 */

import express from 'express';
import { protect } from '../../middlewares/auth.js';
import { authorizeModule } from '../../middlewares/rbac.js';
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
  getNewCount,
  markSeen,
} from './checklist.controller.js';

const router = express.Router();

router.use(protect);

const canView     = authorizeModule('work_queue', 'checklist', 'view');
const canCreate   = authorizeModule('work_queue', 'checklist', 'create');
const canEdit     = authorizeModule('work_queue', 'checklist', 'edit');
const canStop     = authorizeModule('work_queue', 'checklist', 'delete');
const canComplete = authorizeModule('work_queue', 'checklist', 'approve');
// Handing an occurrence to somebody else is the same decision as delegating a
// task to them, so it answers to the same cell rather than to a second one.
const canReassign = authorizeModule('work_queue', 'assignment', 'edit');

// ── Read ────────────────────────────────────────────────────────────────────
router.get('/tasks',            canView, getTasks);
router.get('/summary',          canView, getSummary);
router.get('/routines',         canView, getRoutines);
router.get('/departments',      canView, getDepartmentReport);
router.get('/tasks/drilldown',  canView, drilldown);
// The sidebar's "N new" badge, and the visit that clears it. Marking your own
// list as seen changes nothing anybody else sees, so it is part of viewing.
router.get('/tasks/new-count',  canView, getNewCount);
router.post('/seen',            canView, markSeen);
// The three pickers below feed the filter bar and the reassign dialog. They
// return names and locations, not checklist records, and a viewer needs them
// to read the screen at all - so they are view, not a write in disguise.
router.get('/users',            canView, getUsers);
router.get('/locations',        canView, getLocations);
router.get('/departments-list', canView, getDepartmentsList);

// ── Write ───────────────────────────────────────────────────────────────────
router.post('/routines',                  canCreate,   createRoutine);
router.put('/routines/:id',               canEdit,     updateRoutine);
router.patch('/routines/:id/stop',        canStop,     stopRoutine);
router.patch('/tasks/:id/complete',       canComplete, completeTask);
router.patch('/tasks/:id/non-functional', canComplete, markNonFunctional);
router.patch('/tasks/:id/reassign',       canReassign, reassignTask);
// A remark is a note on an occurrence, not a state change - ordinary editing.
router.post('/tasks/remark',              canEdit,     addRemark);

export default router;
