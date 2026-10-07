/**
 * Work Queue fixes (audit 2026-10) — Delegation and Checklist.
 *
 * Every other Work Queue suite acts as an Admin, which is exactly why these
 * defects survived: an Admin owns every task. These act as the staff who were
 * actually exposed — a doer, and a colleague with the same role who is not on
 * the task at all.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import User from '../models/User.js';
import Delegation from '../models/Delegation.js';
import { ChecklistRoutine, ChecklistOccurrence } from '../models/Checklist.js';
import delegationRoutes from '../modules/delegation/delegation.routes.js';
import checklistRoutes from '../modules/checklist/checklist.routes.js';
import { completeMirroredTask } from '../modules/o2d/o2dDelegationSync.service.js';
import { officeDayKey, officeDaySchedule } from '../utils/officeDay.js';
import { buildTestApp, withServer, get, post, put, patch, del } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const D = '/api/v1/delegation';
const C = '/api/v1/checklist';
const DAY = 24 * 60 * 60 * 1000;

let admin;
let assigner;
let doer;
let outsider;
let current;

before(async () => {
  await startTestMongo();
  await syncIndexes(Delegation, User, ChecklistRoutine, ChecklistOccurrence);
});

after(async () => {
  await stopTestMongo();
});

const mkUser = (name, role) => User.create({
  user: name,
  email: `${name.split(' ')[0].toLowerCase()}@shraddha.com`,
  password: 'Password123!',
  role,
  status: 'Active',
});

beforeEach(async () => {
  await clearCollections();
  admin = await mkUser('Asha Admin', 'Admin');
  assigner = await mkUser('Arun Assigner', 'Billing');
  doer = await mkUser('Divya Doer', 'Billing');
  outsider = await mkUser('Omar Outsider', 'Billing');
  current = admin;
});

/** One app, one server; `as(user)` switches who is calling. */
const as = (user) => { current = user; };
const app = () => buildTestApp({
  mount: (a) => {
    a.use((req, res, next) => { req.user = current; next(); });
    a.use(D, delegationRoutes);
    a.use(C, checklistRoutes);
  },
});

const delegationOf = (overrides = {}) => Delegation.create({
  taskTitle: 'File the GST return',
  description: 'Monthly filing',
  assignerId: assigner._id,
  assignerName: assigner.user,
  doerId: doer._id,
  doerFirstName: 'Divya',
  doerLastName: 'Doer',
  dueDate: new Date(Date.now() + 3 * DAY),
  verificationRequired: true,
  ...overrides,
});

describe('Delegation — ownership', () => {
  test('a colleague not on the task cannot read, edit, verify or delete it', async () => {
    const task = await delegationOf();
    await withServer(app(), async (url) => {
      as(outsider);
      assert.equal((await get(url, `${D}/${task._id}`)).status, 404);
      assert.equal((await put(url, `${D}/${task._id}`, { priority: 'Low' })).status, 404);
      assert.equal((await post(url, `${D}/${task._id}/verify`, {})).status, 404);
      assert.equal((await del(url, `${D}/${task._id}`)).status, 404);

      const bulk = await post(url, `${D}/bulk-delete`, { ids: [String(task._id)] });
      assert.equal(bulk.status, 200);
      assert.equal(bulk.body.deletedCount, 0);
      assert.equal(bulk.body.notPermitted, 1);

      const bulkStatus = await post(url, `${D}/bulk-status`, { ids: [String(task._id)], status: 'Completed' });
      assert.equal(bulkStatus.body.modifiedCount, 0);
    });
    const after = await Delegation.findById(task._id).lean();
    assert.equal(after.isDeleted, false);
    assert.equal(after.status, 'Pending');
  });

  test('the doer can read it but not change its terms or its deadline', async () => {
    const task = await delegationOf();
    await withServer(app(), async (url) => {
      as(doer);
      assert.equal((await get(url, `${D}/${task._id}`)).status, 200);
      assert.equal((await put(url, `${D}/${task._id}`, { dueDate: new Date(Date.now() + 30 * DAY) })).status, 403);
      assert.equal((await post(url, `${D}/${task._id}/revise-date`, { newDate: new Date(), reason: 'busy' })).status, 403);
      assert.equal((await del(url, `${D}/${task._id}`)).status, 403);
    });
  });

  test('a malformed id is a 404, not a 500', async () => {
    await withServer(app(), async (url) => {
      assert.equal((await get(url, `${D}/not-an-id`)).status, 404);
    });
  });
});

describe('Delegation — status rules', () => {
  test('nobody can set Reassigned by hand', async () => {
    const task = await delegationOf();
    await withServer(app(), async (url) => {
      as(doer);
      const res = await put(url, `${D}/${task._id}`, { status: 'Reassigned' });
      assert.equal(res.status, 400);
    });
    assert.equal((await Delegation.findById(task._id).lean()).status, 'Pending');
  });

  test('a doer submits a verification task; only the assigner completes it', async () => {
    const task = await delegationOf();
    await withServer(app(), async (url) => {
      as(doer);
      const selfComplete = await put(url, `${D}/${task._id}`, { status: 'Completed' });
      assert.equal(selfComplete.status, 403);
      assert.equal(selfComplete.body.code, 'VERIFICATION_REQUIRED');

      const submit = await put(url, `${D}/${task._id}`, { status: 'Awaiting Verification' });
      assert.equal(submit.status, 200);
      const submittedAt = new Date(submit.body.data.completedAt).getTime();
      assert.ok(submittedAt > 0, 'submission stamps when the doer finished');

      assert.equal((await post(url, `${D}/${task._id}/verify`, {})).status, 403);

      as(assigner);
      const verify = await post(url, `${D}/${task._id}/verify`, {});
      assert.equal(verify.status, 200);
      assert.equal(verify.body.data.status, 'Completed');
      assert.equal(new Date(verify.body.data.completedAt).getTime(), submittedAt, 'verifying keeps the doer\'s time');

      assert.equal((await post(url, `${D}/${task._id}/verify`, {})).status, 400, 'already completed');
      assert.equal((await post(url, `${D}/${task._id}/revise-date`, { newDate: new Date(), reason: 'x' })).status, 400);

      const reopen = await put(url, `${D}/${task._id}`, { status: 'Pending' });
      assert.equal(reopen.status, 200);
      assert.equal(reopen.body.data.completedAt, null, 'reopening clears the completion stamp');
      assert.equal(reopen.body.data.verifiedBy, null);
    });
  });

  test('evidence is required when the task says so, and must be a web link', async () => {
    const task = await delegationOf({ verificationRequired: false, evidenceRequired: true });
    await withServer(app(), async (url) => {
      as(doer);
      const bare = await put(url, `${D}/${task._id}`, { status: 'Completed' });
      assert.equal(bare.status, 400);
      assert.equal(bare.body.code, 'EVIDENCE_REQUIRED');

      const script = await put(url, `${D}/${task._id}`, { status: 'Completed', evidenceUrl: 'javascript:alert(1)' });
      assert.equal(script.status, 400);

      const ok = await put(url, `${D}/${task._id}`, { status: 'Completed', evidenceUrl: 'https://drive.example/receipt.pdf' });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.data.status, 'Completed');
    });
  });
});

describe('Delegation — search and trash', () => {
  test('search text is literal; the trash Overdue filter no longer crashes', async () => {
    await delegationOf({ taskTitle: 'Fix C++ (build)' });
    await withServer(app(), async (url) => {
      as(admin);
      const res = await get(url, `${D}?viewAll=true&search=${encodeURIComponent('C++ (')}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);

      const trash = await get(url, `${D}/deleted?status=Overdue`);
      assert.equal(trash.status, 200);
    });
  });

  test('a locked O2D stage\'s placeholder date is not overdue', async () => {
    await delegationOf({ dueDate: new Date(Date.now() - 5 * DAY), scheduleTbd: true });
    await delegationOf({ taskTitle: 'Really late', dueDate: new Date(Date.now() - 5 * DAY) });
    await withServer(app(), async (url) => {
      as(admin);
      const res = await get(url, `${D}?viewAll=true&status=Overdue`);
      assert.deepEqual(res.body.data.map((t) => t.taskTitle), ['Really late']);
    });
  });
});

describe('O2D mirrors', () => {
  test('a detached mirror can no longer complete the live stage', async () => {
    await assert.rejects(
      completeMirroredTask(
        { sourceStageId: null, status: 'Reassigned', sourceOrderId: 'x', sourceStageNumber: 3, doerId: doer._id },
        { actor: doer },
      ),
      (err) => err.code === 'O2D_MIRROR_DETACHED' && err.statusCode === 409,
    );
  });
});

// ── Checklist ────────────────────────────────────────────────────────────────

const today = () => officeDayKey(new Date());
const dayKey = (offsetDays) => officeDayKey(new Date(Date.now() + offsetDays * DAY));

async function createRoutine(url, body) {
  as(admin);
  const res = await post(url, `${C}/routines`, {
    taskName: 'Check fire extinguisher',
    taskCode: `FE-${Math.random().toString(36).slice(2, 8)}`,
    frequency: 'daily',
    doer: String(doer._id),
    ...body,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.routine;
}

describe('Checklist — list order and paging', () => {
  test('overdue and today come first, not the furthest-future date', async () => {
    await withServer(app(), async (url) => {
      await createRoutine(url, { startDate: dayKey(-5), endDate: dayKey(60) });
      as(doer);
      const res = await get(url, `${C}/tasks?mine=true`);
      assert.equal(res.status, 200);
      const { tasks, total, pages } = res.body.data;
      assert.equal(total, 66);
      assert.equal(pages, 3);
      assert.equal(tasks[0].status, 'overdue');
      assert.equal(officeDayKey(tasks[0].plannedDate), dayKey(-5));
      assert.ok(tasks.slice(0, 6).some((t) => officeDayKey(t.plannedDate) === today()), "today's row is on page one");
    });
  });

  test('search inside Overdue keeps the search; special characters are literal', async () => {
    await withServer(app(), async (url) => {
      await createRoutine(url, { taskName: 'Fire drill', startDate: dayKey(-3), endDate: dayKey(-1) });
      await createRoutine(url, { taskName: 'Water meter', startDate: dayKey(-3), endDate: dayKey(-1) });
      const res = await get(url, `${C}/tasks?status=overdue&search=fire`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.total, 3);
      assert.ok(res.body.data.tasks.every((t) => t.taskName === 'Fire drill'));

      assert.equal((await get(url, `${C}/tasks?search=${encodeURIComponent('C++ (')}`)).status, 200);
    });
  });
});

describe('Checklist — routines carry through to their tasks', () => {
  test('stopping a routine removes its future tasks and keeps today and the past', async () => {
    await withServer(app(), async (url) => {
      const routine = await createRoutine(url, { startDate: dayKey(-2), endDate: dayKey(10) });
      const res = await patch(url, `${C}/routines/${routine._id}/stop`);
      assert.equal(res.status, 200);
      assert.equal(res.body.futureRemoved, 10);
      const left = await ChecklistOccurrence.find({ routine: routine._id }).lean();
      assert.deepEqual(left.map((o) => officeDayKey(o.plannedDate)).sort(), [dayKey(-2), dayKey(-1), today()]);
    });
  });

  test('editing the doer moves future tasks only; changing dates regenerates them', async () => {
    await withServer(app(), async (url) => {
      const routine = await createRoutine(url, { startDate: dayKey(-2), endDate: dayKey(4) });

      const moved = await put(url, `${C}/routines/${routine._id}`, { doer: String(outsider._id) });
      assert.equal(moved.status, 200);
      const rows = await ChecklistOccurrence.find({ routine: routine._id }).lean();
      const byDay = (k) => rows.find((o) => officeDayKey(o.plannedDate) === k);
      assert.equal(String(byDay(dayKey(-1)).doer), String(doer._id), 'the past keeps its doer');
      assert.equal(String(byDay(today()).doer), String(outsider._id));
      assert.equal(String(byDay(dayKey(4)).doer), String(outsider._id));

      const longer = await put(url, `${C}/routines/${routine._id}`, { endDate: dayKey(9) });
      assert.equal(longer.status, 200);
      const count = await ChecklistOccurrence.countDocuments({ routine: routine._id });
      assert.equal(count, 12, 'two past days plus today through +9, no duplicates');
    });
  });

  test('an end date before the start date is refused', async () => {
    await withServer(app(), async (url) => {
      as(admin);
      const res = await post(url, `${C}/routines`, {
        taskName: 'Backwards', taskCode: 'BK-1', frequency: 'daily', doer: String(doer._id),
        startDate: dayKey(5), endDate: dayKey(1),
      });
      assert.equal(res.status, 400);
    });
  });
});

describe('Checklist — remarks and compliance', () => {
  test('a colleague cannot remark on somebody else\'s task; the doer can', async () => {
    await withServer(app(), async (url) => {
      await createRoutine(url, { frequency: 'once', startDate: today() });
      const row = await ChecklistOccurrence.findOne({}).lean();

      as(outsider);
      const denied = await post(url, `${C}/tasks/remark`, { taskIds: [String(row._id)], text: 'hi' });
      assert.equal(denied.status, 403);

      as(doer);
      const ok = await post(url, `${C}/tasks/remark`, { taskIds: [String(row._id)], text: 'done soon' });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.data.updated, 1);
    });
  });

  test('compliance is measured over what has fallen due, not a year of future rows', async () => {
    await withServer(app(), async (url) => {
      await createRoutine(url, { startDate: today(), endDate: dayKey(200) });
      const todays = await ChecklistOccurrence.findOne({}).sort({ plannedDate: 1 }).lean();
      as(doer);
      assert.equal((await patch(url, `${C}/tasks/${todays._id}/complete`, {})).status, 200);
      const summary = await get(url, `${C}/summary`);
      assert.equal(summary.body.data.complianceRate, 100);
    });
  });
});

describe('Office-day schedule', () => {
  test('a routine on the 31st stays on month-ends instead of drifting', () => {
    const { dates } = officeDaySchedule('2026-01-31', '2026-05-31', 'monthly');
    assert.deepEqual(dates.map((d) => officeDayKey(d)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  test('a truncated schedule says so', () => {
    const { dates, truncated } = officeDaySchedule('2026-01-01', '2030-01-01', 'daily', { limit: 1000 });
    assert.equal(dates.length, 1000);
    assert.equal(truncated, true);
  });
});
