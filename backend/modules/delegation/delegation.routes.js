import express from 'express';
import { protect } from '../../middlewares/auth.js';
import { authorize, PERMISSIONS } from '../../middlewares/rbac.js';
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
} from './delegation.controller.js';

const router = express.Router();

// All delegation routes require authentication + view_o2d permission (Work Queue access)
router.use(protect, authorize(PERMISSIONS.VIEW_O2D));

// Metadata
router.get('/meta/categories', getCategories);
router.get('/meta/users', getUsers);

// Deleted Tasks (Trash Bin) - MUST be declared before /:id
router.get('/deleted', getDeletedDelegations);

// Tasks Read & Write
router.get('/', getDelegations);
router.get('/:id', getDelegationById);
router.post('/', createDelegation);
router.put('/:id', updateDelegation);
router.delete('/:id', deleteDelegation);

// Specific Task Lifecycle Operations
router.patch('/:id/restore', restoreDelegation);
router.post('/:id/restore', restoreDelegation);
router.post('/:id/verify', verifyAndComplete);
router.post('/:id/subtasks', addSubtask);
router.patch('/:id/subtasks/:subtaskId/toggle', toggleSubtask);
router.post('/:id/remarks', addRemark);
router.post('/:id/revise-date', reviseDueDate);
router.post('/:id/reminders', addReminder);
router.post('/:id/follow-ups', addFollowUp);

export default router;
