import express from 'express';
import { protect } from '../../middlewares/auth.js';
import { authorizeModule } from '../../middlewares/rbac.js';
import {
  getDelegations,
  getDelegationById,
  createDelegation,
  updateDelegation,
  verifyAndComplete,
  addSubtask,
  toggleSubtask,
  addRemark,
  reviseDueDate,
  addReminder,
  addFollowUp,
  getCategories,
  getUsers,
  getDeletedDelegations,
  restoreDelegation,
  deleteDelegation,
  bulkUpdateStatus,
  bulkDeleteDelegations,
  overrideAssignee,
} from './delegation.controller.js';

const router = express.Router();

router.use(protect);

/**
 * Granular Work Queue access — see the `work_queue` module in
 * config/moduleRegistry.js. Every route used to sit behind a single blanket
 * VIEW_O2D check; view, create, assign, edit, complete and manage are now
 * separately grantable cells in the Roles & Permissions matrix.
 */
const canView = authorizeModule('work_queue', 'tasks', 'view');
const canCreate = authorizeModule('work_queue', 'tasks', 'create');
const canAssign = authorizeModule('work_queue', 'assignment', 'edit');
const canEdit = authorizeModule('work_queue', 'tasks', 'edit');
const canComplete = authorizeModule('work_queue', 'completion', 'edit');
const canManage = authorizeModule('work_queue', 'administration', 'approve');
const canManageDelete = authorizeModule('work_queue', 'administration', 'delete');
// The bin is its own cell: reading everybody's deleted work and putting it
// back is not the same grant as deleting a task you own.
const canReadTrash = authorizeModule('work_queue', 'trash', 'view');
const canRestore = authorizeModule('work_queue', 'trash', 'approve');

// Metadata
router.get('/meta/categories', canView, getCategories);
router.get('/meta/users', canView, getUsers);

// Deleted Tasks (Trash Bin) - MUST be declared before /:id
router.get('/deleted', canReadTrash, getDeletedDelegations);

// Bulk Operations - MUST be declared before /:id
router.post('/bulk-status', canManage, bulkUpdateStatus);
router.post('/bulk-delete', canManageDelete, bulkDeleteDelegations);

// Tasks Read & Write
router.get('/', canView, getDelegations);
router.get('/:id', canView, getDelegationById);
// Creating a delegated task also assigns it to a doer, so both cells are required.
router.post('/', canCreate, canAssign, createDelegation);
router.put('/:id', canEdit, updateDelegation);
router.delete('/:id', canManageDelete, deleteDelegation);

// Specific Task Lifecycle Operations
router.patch('/:id/restore', canRestore, restoreDelegation);
router.post('/:id/restore', canRestore, restoreDelegation);
router.post('/:id/verify', canComplete, verifyAndComplete);
// Buddy System manual override: choosing who does the task is assigning it.
router.patch('/:id/assignee', canAssign, overrideAssignee);
router.post('/:id/subtasks', canEdit, addSubtask);
router.patch('/:id/subtasks/:subtaskId/toggle', canEdit, toggleSubtask);
router.post('/:id/remarks', canEdit, addRemark);
router.post('/:id/revise-date', canEdit, reviseDueDate);
router.post('/:id/reminders', canEdit, addReminder);
router.post('/:id/follow-ups', canEdit, addFollowUp);

export default router;
