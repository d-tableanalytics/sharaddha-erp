/**
 * Delegation API Integration Tests.
 *
 * Tests the complete lifecycle of delegated tasks:
 * - Creation with metadata, assignee resolution, subtasks, recurrence, and validation
 * - Reading, searching, and filtering by priority, category, status, and comprehensive date ranges
 * - Status transitions and one-click Verify & Complete action
 * - Subtasks (creation, completion toggle)
 * - Audit trails: threaded remarks, due date revision with justification, reminders, follow-up logs
 * - Soft-deletion, Trash Bin retrieval, and task restoration
 * - Bulk operations (bulk status updates and bulk soft-delete)
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import User from '../models/User.js';
import Delegation from '../models/Delegation.js';
import delegationRoutes from '../modules/delegation/delegation.routes.js';
import { buildTestApp, stubProtect, withServer, get, post, put, patch, del } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const P = '/api/v1/delegation';

let delegatorUser;
let assigneeUser1;
let assigneeUser2;

before(async () => {
  await startTestMongo();
  await syncIndexes(Delegation, User);
});

after(async () => {
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections();

  delegatorUser = await User.create({
    user: 'Amit Kumar',
    email: 'amit@shraddha.com',
    password: 'Password123!',
    role: 'Admin',
    status: 'Active',
  });

  assigneeUser1 = await User.create({
    user: 'Vikram Singh',
    email: 'vikram@shraddha.com',
    password: 'Password123!',
    role: 'Billing',
    status: 'Active',
  });

  assigneeUser2 = await User.create({
    user: 'Neha Sharma',
    email: 'neha@shraddha.com',
    password: 'Password123!',
    role: 'Billing',
    status: 'Active',
  });
});

function createApp(currentUser) {
  return buildTestApp({
    mount: (app) => {
      app.use((req, res, next) => stubProtect(currentUser)(req, res, next));
      app.use(P, delegationRoutes);
    },
  });
}

describe('Delegation Module — Task Creation & Validation', () => {
  test('Creates a delegated task with full metadata, assignee details and subtasks', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const res = await post(url, P, {
        taskTitle: 'Procurement Milestone Review',
        description: 'Review substation cable orders and verify quotes.',
        doerId: assigneeUser1._id.toString(),
        priority: 'High',
        category: 'Procurement',
        dueDate: tomorrow,
        recurrence: 'Weekly',
        verificationRequired: true,
        evidenceRequired: true,
        tags: [{ name: 'Urgent', color: '#ef4444' }],
        subtasks: ['Review vendor invoice', 'Obtain manager signoff'],
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.taskTitle, 'Procurement Milestone Review');
      assert.equal(String(res.body.data.assignerId), String(delegatorUser._id));
      assert.equal(String(res.body.data.doerId), String(assigneeUser1._id));
      assert.equal(res.body.data.doerFirstName, 'Vikram');
      assert.equal(res.body.data.priority, 'High');
      assert.equal(res.body.data.status, 'Pending');
      assert.equal(res.body.data.subtasks.length, 2);
      assert.equal(res.body.data.subtasks[0].title, 'Review vendor invoice');
      assert.equal(res.body.data.subtasks[0].completed, false);
    });
  });

  test('Rejects task creation when required fields are missing', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      // Missing dueDate and doerId
      const res = await post(url, P, {
        taskTitle: 'Incomplete Task',
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Task title, doer assignee, and due date are required/);
    });
  });
});

describe('Delegation Module — Listing, Date Filtering & Search', () => {
  beforeEach(async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // overdue
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await Delegation.create([
      {
        taskTitle: 'Overdue Urgent Audit',
        description: 'Overdue task for testing',
        assignerId: delegatorUser._id,
        assignerName: 'Amit Kumar',
        doerId: assigneeUser1._id,
        doerFirstName: 'Vikram',
        doerLastName: 'Singh',
        status: 'Pending',
        priority: 'Urgent',
        category: 'Finance',
        dueDate: twoDaysAgo,
      },
      {
        taskTitle: 'Today Active Operation',
        description: 'Task scheduled today',
        assignerId: delegatorUser._id,
        assignerName: 'Amit Kumar',
        doerId: assigneeUser1._id,
        doerFirstName: 'Vikram',
        doerLastName: 'Singh',
        status: 'In Progress',
        priority: 'Medium',
        category: 'Operations',
        dueDate: now,
      },
      {
        taskTitle: 'Tomorrow Verification Task',
        description: 'Awaiting signoff',
        assignerId: delegatorUser._id,
        assignerName: 'Amit Kumar',
        doerId: assigneeUser2._id,
        doerFirstName: 'Neha',
        doerLastName: 'Sharma',
        status: 'Awaiting Verification',
        priority: 'Low',
        category: 'Compliance',
        dueDate: tomorrow,
      },
      {
        taskTitle: 'Completed Milestone',
        description: 'Already verified',
        assignerId: delegatorUser._id,
        assignerName: 'Amit Kumar',
        doerId: assigneeUser2._id,
        doerFirstName: 'Neha',
        doerLastName: 'Sharma',
        status: 'Completed',
        priority: 'High',
        category: 'Operations',
        dueDate: yesterday,
        completedAt: yesterday,
      },
    ]);
  });

  test('Lists all active delegated tasks by default', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await get(url, P);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 4);
    });
  });

  test('Filters by status including Overdue dynamic query', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const overdueRes = await get(url, `${P}?status=Overdue`);
      assert.equal(overdueRes.status, 200);
      assert.equal(overdueRes.body.data.length, 1);
      assert.equal(overdueRes.body.data[0].taskTitle, 'Overdue Urgent Audit');

      const completedRes = await get(url, `${P}?status=Completed`);
      assert.equal(completedRes.status, 200);
      assert.equal(completedRes.body.data.length, 1);
      assert.equal(completedRes.body.data[0].taskTitle, 'Completed Milestone');
    });
  });

  test('Filters by priority and category', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const urgentRes = await get(url, `${P}?priority=Urgent`);
      assert.equal(urgentRes.status, 200);
      assert.equal(urgentRes.body.data.length, 1);
      assert.equal(urgentRes.body.data[0].priority, 'Urgent');

      const opsRes = await get(url, `${P}?category=Operations`);
      assert.equal(opsRes.status, 200);
      assert.equal(opsRes.body.data.length, 2);
    });
  });

  test('Filters by dateRange (Today, Yesterday, This Week, This Year)', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const todayRes = await get(url, `${P}?dateRange=Today`);
      assert.equal(todayRes.status, 200);
      assert.equal(todayRes.body.data.length, 1);
      assert.equal(todayRes.body.data[0].taskTitle, 'Today Active Operation');

      const yesterdayRes = await get(url, `${P}?dateRange=Yesterday`);
      assert.equal(yesterdayRes.status, 200);
      assert.equal(yesterdayRes.body.data.length, 1);
      assert.equal(yesterdayRes.body.data[0].taskTitle, 'Completed Milestone');

      const yearRes = await get(url, `${P}?dateRange=This%20Year`);
      assert.equal(yearRes.status, 200);
      assert.equal(yearRes.body.data.length, 4);
    });
  });

  test('Searches by keyword in task title or description', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await get(url, `${P}?search=signoff`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].taskTitle, 'Tomorrow Verification Task');
    });
  });
});

describe('Delegation Module — Task Lifecycle, Verification & Subtasks', () => {
  let task;

  beforeEach(async () => {
    task = await Delegation.create({
      taskTitle: 'Safety Inspection Checklist',
      assignerId: delegatorUser._id,
      assignerName: 'Amit Kumar',
      doerId: assigneeUser1._id,
      doerFirstName: 'Vikram',
      doerLastName: 'Singh',
      status: 'Pending',
      priority: 'Medium',
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      subtasks: [{ title: 'Check extinguishers', completed: false }],
    });
  });

  test('Updates task status and fields via PUT /:id', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await put(url, `${P}/${task._id}`, {
        status: 'In Progress',
        priority: 'High',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'In Progress');
      assert.equal(res.body.data.priority, 'High');
    });
  });

  test('One-click Verify & Complete transitions status, stamps verification metadata, and appends notes', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await post(url, `${P}/${task._id}/verify`, {
        notes: 'Quality checked and verified on site',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'Completed');
      assert.ok(res.body.data.completedAt);
      assert.ok(res.body.data.verifiedAt);
      assert.equal(String(res.body.data.verifiedBy), String(delegatorUser._id));
      assert.equal(res.body.data.remarks.length, 1);
      assert.match(res.body.data.remarks[0].text, /Quality checked and verified on site/);
    });
  });

  test('Adds a subtask and toggles its completion status', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      // 1. Add subtask
      const addRes = await post(url, `${P}/${task._id}/subtasks`, {
        title: 'Check emergency exits',
      });
      assert.equal(addRes.status, 200);
      assert.equal(addRes.body.data.subtasks.length, 2);
      const newSubtask = addRes.body.data.subtasks.find((s) => s.title === 'Check emergency exits');
      assert.ok(newSubtask);
      assert.equal(newSubtask.completed, false);

      // 2. Toggle subtask
      const toggleRes = await patch(url, `${P}/${task._id}/subtasks/${newSubtask._id}/toggle`, {
        completed: true,
      });
      assert.equal(toggleRes.status, 200);
      const updatedSub = toggleRes.body.data.subtasks.find((s) => s._id === newSubtask._id);
      assert.equal(updatedSub.completed, true);
      assert.ok(updatedSub.completedAt);
    });
  });
});

describe('Delegation Module — Audit Trail (Remarks, Due Date Revisions, Reminders, Follow-ups)', () => {
  let task;

  beforeEach(async () => {
    task = await Delegation.create({
      taskTitle: 'Audit Trail Task',
      assignerId: delegatorUser._id,
      doerId: assigneeUser1._id,
      dueDate: new Date('2026-10-15'),
    });
  });

  test('Adds a threaded remark to the task', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await post(url, `${P}/${task._id}/remarks`, {
        text: 'Waiting for vendor confirmation email.',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.remarks.length, 1);
      assert.equal(res.body.data.remarks[0].text, 'Waiting for vendor confirmation email.');
      assert.equal(String(res.body.data.remarks[0].by), String(delegatorUser._id));
    });
  });

  test('Revises due date and records date revision justification in audit log', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await post(url, `${P}/${task._id}/revise-date`, {
        newDate: '2026-10-25',
        reason: 'Vendor parts delivery delayed by supply chain backorder',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.dateRevisions.length, 1);
      assert.equal(res.body.data.dateRevisions[0].reason, 'Vendor parts delivery delayed by supply chain backorder');
      assert.equal(new Date(res.body.data.dueDate).toISOString().slice(0, 10), '2026-10-25');
    });
  });

  test('Adds a scheduled reminder and a follow-up log', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      // Reminder
      const reminderRes = await post(url, `${P}/${task._id}/reminders`, {
        date: new Date('2026-10-20').toISOString(),
        note: 'Follow up with procurement team',
      });
      assert.equal(reminderRes.status, 200);
      assert.equal(reminderRes.body.data.reminders.length, 1);
      assert.equal(reminderRes.body.data.reminders[0].note, 'Follow up with procurement team');

      // Follow-up log
      const followUpRes = await post(url, `${P}/${task._id}/follow-ups`, {
        notes: 'Spoke with vendor rep via telephone, shipping Monday.',
        contactedVia: 'Phone',
      });
      assert.equal(followUpRes.status, 200);
      assert.equal(followUpRes.body.data.followUps.length, 1);
      assert.equal(followUpRes.body.data.followUps[0].contactedVia, 'Phone');
    });
  });
});

describe('Delegation Module — Soft Delete, Trash Bin & Bulk Operations', () => {
  let task1;
  let task2;

  beforeEach(async () => {
    task1 = await Delegation.create({
      taskTitle: 'Bulk Task 1',
      assignerId: delegatorUser._id,
      doerId: assigneeUser1._id,
      status: 'Pending',
      dueDate: new Date(),
    });

    task2 = await Delegation.create({
      taskTitle: 'Bulk Task 2',
      assignerId: delegatorUser._id,
      doerId: assigneeUser2._id,
      status: 'Pending',
      dueDate: new Date(),
    });
  });

  test('Soft-deletes a task to Trash Bin and restores it back to active list', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      // 1. Delete task1
      const delRes = await del(url, `${P}/${task1._id}`);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.success, true);

      // Verify task1 is excluded from active list
      const activeRes = await get(url, P);
      assert.equal(activeRes.body.data.length, 1);
      assert.equal(activeRes.body.data[0]._id, String(task2._id));

      // 2. Listed in Trash Bin /deleted
      const deletedRes = await get(url, `${P}/deleted`);
      assert.equal(deletedRes.status, 200);
      const foundInTrash = deletedRes.body.data.find((t) => t._id === String(task1._id));
      assert.ok(foundInTrash);
      assert.equal(foundInTrash.isDeleted, true);

      // 3. Restore task1
      const restoreRes = await patch(url, `${P}/${task1._id}/restore`);
      assert.equal(restoreRes.status, 200);
      assert.equal(restoreRes.body.data.isDeleted, false);

      // Now back in active list
      const afterRestore = await get(url, P);
      assert.equal(afterRestore.body.data.length, 2);
    });
  });

  test('Bulk updates status across multiple tasks', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await post(url, `${P}/bulk-status`, {
        ids: [task1._id.toString(), task2._id.toString()],
        status: 'In Progress',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.modifiedCount, 2);

      const updated1 = await Delegation.findById(task1._id);
      const updated2 = await Delegation.findById(task2._id);
      assert.equal(updated1.status, 'In Progress');
      assert.equal(updated2.status, 'In Progress');
    });
  });

  test('Bulk deletes multiple tasks into Trash Bin', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const res = await post(url, `${P}/bulk-delete`, {
        ids: [task1._id.toString(), task2._id.toString()],
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.deletedCount, 2);

      const count = await Delegation.countDocuments({ isDeleted: false });
      assert.equal(count, 0);

      const deletedCount = await Delegation.countDocuments({ isDeleted: true });
      assert.equal(deletedCount, 2);
    });
  });

  test('Fetches categories and users metadata', async () => {
    const app = createApp(delegatorUser);
    await withServer(app, async (url) => {
      const catRes = await get(url, `${P}/meta/categories`);
      assert.equal(catRes.status, 200);
      assert.ok(Array.isArray(catRes.body.data));
      assert.ok(catRes.body.data.includes('Operations'));

      const userRes = await get(url, `${P}/meta/users`);
      assert.equal(userRes.status, 200);
      assert.ok(Array.isArray(userRes.body.data));
      assert.ok(userRes.body.data.length >= 3);
    });
  });
});
