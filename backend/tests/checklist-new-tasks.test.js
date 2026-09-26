/**
 * "New" Checklist tasks — the row tag and the sidebar badge.
 *
 * A task is new for a person if it reached their list after they last opened
 * the Checklist (or in the last day, if they never have). Opening the Checklist
 * clears it for that person only.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import User from '../models/User.js';
import { ChecklistRoutine, ChecklistOccurrence } from '../models/Checklist.js';
import { WorkQueueSeen } from '../models/WorkQueueSeen.js';
import checklistRoutes from '../modules/checklist/checklist.routes.js';
import { buildTestApp, stubProtect, withServer, get, post, patch } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const P = '/api/v1/checklist';
const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

let admin;
let rahul;
let priya;

before(async () => {
  await startTestMongo();
  await syncIndexes(ChecklistRoutine, ChecklistOccurrence, WorkQueueSeen, User);
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  admin = await User.create({ user: 'Admin Manager', email: 'admin@x.com', password: 'Password123!', role: 'Admin', status: 'Active' });
  rahul = await User.create({ user: 'Rahul Sharma', email: 'rahul@x.com', password: 'Password123!', role: 'Billing', status: 'Active' });
  priya = await User.create({ user: 'Priya Patel', email: 'priya@x.com', password: 'Password123!', role: 'Billing', status: 'Active' });
});

const appFor = (user) => buildTestApp({
  mount: (a) => {
    a.use((req, res, next) => stubProtect(user)(req, res, next));
    a.use(P, checklistRoutes);
  },
});

const today = () => new Date().toISOString().slice(0, 10);

async function createTask(doer, { code, frequency = 'once', endDate } = {}) {
  await withServer(appFor(admin), async (url) => {
    const res = await post(url, `${P}/routines`, {
      taskName: `Task ${code}`, taskCode: code, frequency, doer: String(doer._id),
      department: 'Billing', site: 'HO', startDate: today(), endDate: endDate ?? today(),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
}

const newCount = (url) => get(url, `${P}/tasks/new-count`).then((r) => r.body.data.count);

describe('new Checklist tasks', () => {
  test('a task that just arrived is new — tagged on the row and counted for the badge', async () => {
    await createTask(rahul, { code: 'NEW-1' });

    await withServer(appFor(rahul), async (url) => {
      assert.equal(await newCount(url), 1);
      const list = await get(url, `${P}/tasks`);
      assert.equal(list.body.data.tasks[0].isNew, true);
    });
  });

  test('opening the Checklist clears it — and only for that person', async () => {
    await createTask(rahul, { code: 'NEW-2' });
    await createTask(priya, { code: 'NEW-3' });

    await withServer(appFor(rahul), async (url) => {
      await post(url, `${P}/seen`, {});
      assert.equal(await newCount(url), 0);
      assert.equal((await get(url, `${P}/tasks`)).body.data.tasks[0].isNew, false);
    });
    await withServer(appFor(priya), async (url) => {
      assert.equal(await newCount(url), 1, 'Priya has not looked yet');
    });
  });

  test('a task arriving after the visit is new again', async () => {
    await withServer(appFor(rahul), async (url) => { await post(url, `${P}/seen`, {}); });
    await pause();
    await createTask(rahul, { code: 'NEW-4' });

    await withServer(appFor(rahul), async (url) => {
      assert.equal(await newCount(url), 1);
    });
  });

  test('a recurring routine counts once, not once per generated date', async () => {
    const end = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    await createTask(rahul, { code: 'DAILY-1', frequency: 'daily', endDate: end });

    await withServer(appFor(rahul), async (url) => {
      assert.equal(await newCount(url), 1);
      const list = (await get(url, `${P}/tasks?limit=100`)).body.data.tasks;
      assert.ok(list.length > 1, 'the routine generated several dates');
      assert.equal(list.filter((t) => t.isNew).length, 1);
    });
  });

  test('a task reassigned to somebody is new for them', async () => {
    await createTask(rahul, { code: 'MOVE-1' });
    await withServer(appFor(priya), async (url) => { await post(url, `${P}/seen`, {}); });
    await pause();
    const occurrence = await ChecklistOccurrence.findOne({ taskCode: 'MOVE-1' });

    await withServer(appFor(admin), async (url) => {
      const res = await patch(url, `${P}/tasks/${occurrence._id}/reassign`, { newDoer: String(priya._id) });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    });
    await withServer(appFor(priya), async (url) => {
      assert.equal(await newCount(url), 1);
    });
  });

  test('a finished task is not new', async () => {
    await createTask(rahul, { code: 'DONE-1' });
    await ChecklistOccurrence.updateOne({ taskCode: 'DONE-1' }, { $set: { status: 'completed', completedDate: new Date() } });

    await withServer(appFor(rahul), async (url) => {
      assert.equal(await newCount(url), 0);
    });
  });
});
