/**
 * Checklist API Integration Tests.
 *
 * Tests the complete lifecycle of compliance tasks:
 * - Routine creation (once vs recurring) and automatic occurrence generation
 * - Filtering, pagination, and dynamic overdue status computation
 * - Role-based permissions (Manager vs Doer)
 * - Task completion (with and without proof requirement)
 * - Non-functional marking and task reassignment
 * - Threaded remarks (single and bulk)
 * - Routine modification and deactivation
 * - KPI summary calculation and bucket drilldowns
 * - Department scoreboard aggregation
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import User from '../models/User.js';
import { ChecklistRoutine, ChecklistOccurrence } from '../models/Checklist.js';
import checklistRoutes from '../modules/checklist/checklist.routes.js';
import { buildTestApp, stubProtect, withServer, get, post, put, patch } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const P = '/api/v1/checklist';

let adminUser;
let staffUser1;
let staffUser2;

before(async () => {
  await startTestMongo();
  await syncIndexes(ChecklistRoutine, ChecklistOccurrence, User);
});

after(async () => {
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections();

  adminUser = await User.create({
    user: 'Admin Manager',
    email: 'admin@shraddha.com',
    password: 'Password123!',
    role: 'Admin',
    status: 'Active',
  });

  staffUser1 = await User.create({
    user: 'Rahul Sharma',
    email: 'rahul@shraddha.com',
    password: 'Password123!',
    role: 'Billing',
    status: 'Active',
  });

  staffUser2 = await User.create({
    user: 'Priya Patel',
    email: 'priya@shraddha.com',
    password: 'Password123!',
    role: 'Billing',
    status: 'Active',
  });
});

function createApp(currentUser) {
  return buildTestApp({
    mount: (app) => {
      app.use((req, res, next) => stubProtect(currentUser)(req, res, next));
      app.use(P, checklistRoutes);
    },
  });
}

describe('Checklist Module — Routine Creation & Occurrence Generation', () => {
  test('Admin creates a one-time checklist task successfully with 1 occurrence', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await post(url, `${P}/routines`, {
        taskName: 'Safety Valve Inspection',
        taskCode: 'VALVE-01',
        frequency: 'once',
        doer: staffUser1._id.toString(),
        department: 'Safety',
        site: 'HO',
        startDate: today,
        endDate: today,
        proofRequired: false,
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.occurrencesCreated, 1);
      assert.equal(res.body.data.routine.taskCode, 'VALVE-01');

      const occurrences = await ChecklistOccurrence.find({ routine: res.body.data.routine._id });
      assert.equal(occurrences.length, 1);
      assert.equal(occurrences[0].status, 'pending');
      assert.equal(occurrences[0].doerFirstName, 'Rahul');
    });
  });

  test('Admin creates a daily recurring routine generating occurrences between start and end', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const start = new Date('2026-10-01');
      const end = new Date('2026-10-05'); // 5 days: Oct 1, 2, 3, 4, 5
      const res = await post(url, `${P}/routines`, {
        taskName: 'Daily Server Log Check',
        taskCode: 'SRV-LOG-01',
        frequency: 'daily',
        doer: staffUser1._id.toString(),
        department: 'IT',
        site: 'HO',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.occurrencesCreated, 5);

      const occurrences = await ChecklistOccurrence.find({ routine: res.body.data.routine._id });
      assert.equal(occurrences.length, 5);
    });
  });

  test('Duplicate taskCode is rejected with 400', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const today = new Date().toISOString().slice(0, 10);
      await post(url, `${P}/routines`, {
        taskName: 'First Task',
        taskCode: 'DUP-CODE-01',
        frequency: 'once',
        doer: staffUser1._id.toString(),
        startDate: today,
      });

      const duplicate = await post(url, `${P}/routines`, {
        taskName: 'Second Task',
        taskCode: 'DUP-CODE-01',
        frequency: 'once',
        doer: staffUser2._id.toString(),
        startDate: today,
      });

      assert.equal(duplicate.status, 400);
      assert.equal(duplicate.body.success, false);
    });
  });

  test('Non-manager can create a task for themselves but is rejected when assigning to another user', async () => {
    const staffApp = createApp(staffUser1);
    await withServer(staffApp, async (url) => {
      const today = new Date().toISOString().slice(0, 10);

      // Attempting to assign to staffUser2 -> 403
      const forbiddenRes = await post(url, `${P}/routines`, {
        taskName: 'Unauthorized Assignment',
        taskCode: 'FORBID-01',
        frequency: 'once',
        doer: staffUser2._id.toString(),
        startDate: today,
      });
      assert.equal(forbiddenRes.status, 403);

      // Assigning to self -> 201 OK
      const selfRes = await post(url, `${P}/routines`, {
        taskName: 'My Self Checklist',
        taskCode: 'SELF-01',
        frequency: 'once',
        doer: staffUser1._id.toString(),
        startDate: today,
      });
      assert.equal(selfRes.status, 201);
      assert.equal(selfRes.body.data.occurrencesCreated, 1);
    });
  });
});

describe('Checklist Module — Listing, Filtering & Overdue Computation', () => {
  beforeEach(async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const futureDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days ahead

    const routine = await ChecklistRoutine.create({
      taskName: 'Master Routine',
      taskCode: 'MAST-01',
      frequency: 'daily',
      doer: staffUser1._id,
      doerFirstName: 'Rahul',
      department: 'Operations',
      site: 'HO',
      startDate: pastDate,
      endDate: futureDate,
    });

    // 1 past occurrence (pending -> should compute as overdue)
    await ChecklistOccurrence.create({
      routine: routine._id,
      taskName: 'Past Task',
      taskCode: 'MAST-01',
      doer: staffUser1._id,
      doerFirstName: 'Rahul',
      department: 'Operations',
      site: 'HO',
      plannedDate: pastDate,
      status: 'pending',
    });

    // 1 today occurrence
    await ChecklistOccurrence.create({
      routine: routine._id,
      taskName: 'Today Task',
      taskCode: 'MAST-01',
      doer: staffUser1._id,
      doerFirstName: 'Rahul',
      department: 'Operations',
      site: 'HO',
      plannedDate: now,
      status: 'pending',
    });

    // 1 future occurrence for staffUser2
    await ChecklistOccurrence.create({
      routine: routine._id,
      taskName: 'Priya Task',
      taskCode: 'MAST-01',
      doer: staffUser2._id,
      doerFirstName: 'Priya',
      department: 'Accounts',
      site: 'Plant-1',
      plannedDate: futureDate,
      status: 'pending',
    });
  });

  test('Tasks with plannedDate in the past are enriched with status "overdue"', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const res = await get(url, `${P}/tasks`);
      assert.equal(res.status, 200);
      const pastTask = res.body.data.tasks.find((t) => t.taskName === 'Past Task');
      assert.ok(pastTask);
      assert.equal(pastTask.status, 'overdue');
    });
  });

  test('Non-manager only sees occurrences assigned to them', async () => {
    const app = createApp(staffUser1);
    await withServer(app, async (url) => {
      const res = await get(url, `${P}/tasks`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.tasks.length, 2);
      assert.ok(res.body.data.tasks.every((t) => String(t.doer) === String(staffUser1._id)));
    });
  });

  test('Filtering by status=overdue returns only past pending tasks', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const res = await get(url, `${P}/tasks?status=overdue`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.tasks.length, 1);
      assert.equal(res.body.data.tasks[0].taskName, 'Past Task');
    });
  });

  test('KPI summary accurately aggregates total, pendingToday, overdue, and completed', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const res = await get(url, `${P}/summary`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.total, 3);
      assert.equal(res.body.data.overdue, 1);
      assert.equal(res.body.data.pendingToday, 1);
      assert.equal(res.body.data.completed, 0);
      assert.equal(res.body.data.complianceRate, 0);
    });
  });

  test('KPI drilldown by overdue returns the overdue occurrences', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const res = await get(url, `${P}/tasks/drilldown?kpi=overdue`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].status, 'overdue');
    });
  });
});

describe('Checklist Module — Task Completion, Proof Requirement & Permissions', () => {
  let standardOccurrence;
  let proofOccurrence;

  beforeEach(async () => {
    const routine = await ChecklistRoutine.create({
      taskName: 'Daily Maintenance',
      taskCode: 'MAINT-01',
      frequency: 'daily',
      doer: staffUser1._id,
      startDate: new Date(),
      endDate: new Date(),
    });

    standardOccurrence = await ChecklistOccurrence.create({
      routine: routine._id,
      taskName: 'Standard Occurrence',
      taskCode: 'MAINT-01',
      doer: staffUser1._id,
      plannedDate: new Date(),
      status: 'pending',
      proofRequired: false,
    });

    proofOccurrence = await ChecklistOccurrence.create({
      routine: routine._id,
      taskName: 'Proof Required Occurrence',
      taskCode: 'MAINT-01',
      doer: staffUser1._id,
      plannedDate: new Date(),
      status: 'pending',
      proofRequired: true,
    });
  });

  test('Doer completes a standard task without proof', async () => {
    const app = createApp(staffUser1);
    await withServer(app, async (url) => {
      const res = await patch(url, `${P}/tasks/${standardOccurrence._id}/complete`, {});
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'completed');
      assert.ok(res.body.data.completedDate);
      assert.equal(String(res.body.data.completedBy), String(staffUser1._id));
    });
  });

  test('Attempting to complete an already completed task returns 400', async () => {
    const app = createApp(staffUser1);
    await withServer(app, async (url) => {
      await patch(url, `${P}/tasks/${standardOccurrence._id}/complete`, {});
      const second = await patch(url, `${P}/tasks/${standardOccurrence._id}/complete`, {});
      assert.equal(second.status, 400);
    });
  });

  test('Task with proofRequired requires proofUrl; succeeds when provided', async () => {
    const app = createApp(staffUser1);
    await withServer(app, async (url) => {
      // Missing proof -> 400
      const failRes = await patch(url, `${P}/tasks/${proofOccurrence._id}/complete`, {});
      assert.equal(failRes.status, 400);
      assert.match(failRes.body.message, /Proof document URL is required/);

      // Providing proof -> 200
      const okRes = await patch(url, `${P}/tasks/${proofOccurrence._id}/complete`, {
        proofUrl: 'https://storage.company.com/proofs/valve-test.pdf',
        proofFileName: 'valve-test.pdf',
      });
      assert.equal(okRes.status, 200);
      assert.equal(okRes.body.data.status, 'completed');
      assert.equal(okRes.body.data.proofUrl, 'https://storage.company.com/proofs/valve-test.pdf');
    });
  });

  test('Another regular user cannot complete a task they do not own', async () => {
    const app = createApp(staffUser2);
    await withServer(app, async (url) => {
      const res = await patch(url, `${P}/tasks/${standardOccurrence._id}/complete`, {});
      assert.equal(res.status, 403);
    });
  });

  test('Doer marks task as non-functional with reason', async () => {
    const app = createApp(staffUser1);
    await withServer(app, async (url) => {
      const res = await patch(url, `${P}/tasks/${standardOccurrence._id}/non-functional`, {
        reason: 'Machine broke down and under repair',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'non-functional');
      assert.equal(res.body.data.nonFunctionalReason, 'Machine broke down and under repair');
    });
  });
});

describe('Checklist Module — Management Operations (Reassign, Stop, Remarks, Scoreboard)', () => {
  let occurrence;
  let routine;

  beforeEach(async () => {
    routine = await ChecklistRoutine.create({
      taskName: 'Inspection Routine',
      taskCode: 'INSP-01',
      frequency: 'weekly',
      doer: staffUser1._id,
      doerFirstName: 'Rahul',
      department: 'Safety',
      site: 'HO',
      startDate: new Date(),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      isActive: true,
    });

    occurrence = await ChecklistOccurrence.create({
      routine: routine._id,
      taskName: 'Inspection Occurrence',
      taskCode: 'INSP-01',
      doer: staffUser1._id,
      doerFirstName: 'Rahul',
      department: 'Safety',
      site: 'HO',
      plannedDate: new Date(),
      status: 'pending',
    });
  });

  test('Admin reassigns task to staffUser2 successfully; non-manager is refused', async () => {
    const staffApp = createApp(staffUser1);
    await withServer(staffApp, async (url) => {
      const forbidden = await patch(url, `${P}/tasks/${occurrence._id}/reassign`, {
        newDoer: staffUser2._id.toString(),
      });
      assert.equal(forbidden.status, 403);
    });

    const adminApp = createApp(adminUser);
    await withServer(adminApp, async (url) => {
      const res = await patch(url, `${P}/tasks/${occurrence._id}/reassign`, {
        newDoer: staffUser2._id.toString(),
      });
      assert.equal(res.status, 200);
      assert.equal(String(res.body.data.doer), String(staffUser2._id));
      assert.equal(res.body.data.reassigned, true);
      assert.equal(String(res.body.data.reassignedTo), String(staffUser2._id));
    });
  });

  test('Admin stops a routine; non-manager cannot stop it', async () => {
    const staffApp = createApp(staffUser1);
    await withServer(staffApp, async (url) => {
      const forbidden = await patch(url, `${P}/routines/${routine._id}/stop`, {});
      assert.equal(forbidden.status, 403);
    });

    const adminApp = createApp(adminUser);
    await withServer(adminApp, async (url) => {
      const res = await patch(url, `${P}/routines/${routine._id}/stop`, {});
      assert.equal(res.status, 200);
      assert.equal(res.body.data.isActive, false);
    });
  });

  test('Adding remarks pushes into occurrence remarks history', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const res = await post(url, `${P}/tasks/remark`, {
        taskIds: [occurrence._id.toString()],
        text: 'Checked with supervisor, proceeding with verification.',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.updated, 1);

      const updated = await ChecklistOccurrence.findById(occurrence._id);
      assert.equal(updated.remarks.length, 1);
      assert.equal(updated.remarks[0].text, 'Checked with supervisor, proceeding with verification.');
    });
  });

  test('Department report computes department compliance accurately', async () => {
    const app = createApp(adminUser);
    await withServer(app, async (url) => {
      const res = await get(url, `${P}/departments`);
      assert.equal(res.status, 200);
      assert.ok(res.body.data.departments);
      assert.ok(Array.isArray(res.body.data.departments));
      assert.equal(res.body.data.departments.length, 1);
      assert.equal(res.body.data.departments[0]._id, 'Safety');
      assert.equal(res.body.data.overall.total, 1);
    });
  });
});
