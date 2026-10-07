/**
 * Work Queue Buddy System.
 *
 * A buddy task has a primary and ordered backups; on each office day it
 * belongs to the first person in the chain who is available that day. These
 * tests drive the rotation with a fixed clock (`runBuddySweep({ now })`) over
 * a task running 1–10 Oct 2026, with availability coming from the real HRMS
 * records it reads — approved leave, attendance marks, employee status.
 *
 * The API tests at the end use the real clock, because the endpoints rotate
 * a new task at once "today".
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import User from '../models/User.js';
import Employee from '../models/hrms/Employee.js';
import AttendanceRecord from '../models/hrms/AttendanceRecord.js';
import { LeaveRequest } from '../models/hrms/LeaveRequest.js';
import { Holiday } from '../models/hrms/Holiday.js';
import { InboxItem } from '../models/hrms/InboxItem.js';
import Delegation from '../models/Delegation.js';
import { ChecklistRoutine, ChecklistOccurrence } from '../models/Checklist.js';
import delegationRoutes from '../modules/delegation/delegation.routes.js';
import checklistRoutes from '../modules/checklist/checklist.routes.js';
import { runBuddySweep, pickAssignee } from '../modules/workqueue/buddy.service.js';
import { INBOX_TYPES } from '../shared/constants/inbox.js';
import { officeDayKey, dayStamp } from '../utils/officeDay.js';
import { buildTestApp, stubProtect, withServer, post, put, patch } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

/** 10:00 IST on an October 2026 day. */
const at = (day, time = '10:00') => new Date(`2026-10-${String(day).padStart(2, '0')}T${time}:00+05:30`);
const D = (day) => `2026-10-${String(day).padStart(2, '0')}`;

let seq = 0;
let manager;
let rahul;
let priya;
let amit;

async function makePerson(name, { role = 'Billing', status = 'active' } = {}) {
  seq += 1;
  const user = await User.create({
    user: name,
    email: `p${seq}@shraddha.com`,
    password: 'Password123!',
    role,
    status: 'Active',
  });
  const employee = await Employee.create({
    userId: user._id,
    employeeCode: `BUD${String(seq).padStart(3, '0')}`,
    firstName: name.split(' ')[0],
    lastName: name.split(' ').slice(1).join(' ') || 'X',
    dateOfJoining: new Date('2024-01-01'),
    status,
  });
  return { user, employee, id: String(user._id), name };
}

async function onLeave(person, from, to = from, durationUnit = 'full_day') {
  await LeaveRequest.create({
    employeeId: person.employee._id,
    leaveTypeId: new mongoose.Types.ObjectId(),
    startDate: from,
    endDate: to,
    durationUnit,
    durationValue: durationUnit === 'half_day' ? 0.5 : 1,
    reason: 'Personal',
    status: 'approved',
  });
}

async function mark(person, day, status) {
  await AttendanceRecord.create({ employeeId: person.employee._id, date: new Date(`${day}T00:00:00.000Z`), status, source: 'manual' });
}

const chainOf = (...people) => people.map((p) => ({ userId: p.user._id, name: p.name }));

async function buddyDelegation(overrides = {}) {
  return Delegation.create({
    taskTitle: 'Submit Daily Sales Report',
    assignerId: manager.user._id,
    assignerName: manager.name,
    doerId: rahul.user._id,
    doerFirstName: 'Rahul',
    doerLastName: 'Sharma',
    startDate: new Date(`${D(1)}T00:00:00.000Z`),
    dueDate: new Date(`${D(10)}T00:00:00.000Z`),
    assignmentType: 'buddy',
    buddyChain: chainOf(rahul, priya, amit),
    ...overrides,
  });
}

/** A daily buddy routine 1–10 Oct with its ten occurrences, all on Rahul. */
async function buddyRoutine() {
  const routine = await ChecklistRoutine.create({
    taskName: 'Daily Sales Report',
    taskCode: `DSR-${seq += 1}`,
    frequency: 'daily',
    doer: rahul.user._id,
    doerFirstName: 'Rahul',
    doerLastName: 'Sharma',
    startDate: new Date(`${D(1)}T00:00:00.000Z`),
    endDate: new Date(`${D(10)}T00:00:00.000Z`),
    createdBy: manager.user._id,
    assignmentType: 'buddy',
    buddyChain: chainOf(rahul, priya, amit),
  });
  const rows = [];
  for (let d = 1; d <= 10; d += 1) {
    rows.push({
      routine: routine._id,
      taskName: routine.taskName,
      taskCode: routine.taskCode,
      doer: rahul.user._id,
      doerFirstName: 'Rahul',
      doerLastName: 'Sharma',
      frequency: 'daily',
      plannedDate: dayStamp(D(d)),
      createdBy: manager.user._id,
    });
  }
  await ChecklistOccurrence.insertMany(rows);
  return routine;
}

const occurrenceOn = (routine, day) => ChecklistOccurrence.findOne({ routine: routine._id, plannedDate: dayStamp(D(day)) });
const inboxFor = (person, type) => InboxItem.countDocuments({ recipientEmployeeId: person.employee._id, ...(type ? { type } : {}) });

before(async () => {
  await startTestMongo();
  await syncIndexes(User, Employee, AttendanceRecord, LeaveRequest, Holiday, InboxItem, Delegation, ChecklistRoutine, ChecklistOccurrence);
});

after(async () => {
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections();
  delete process.env.WORK_QUEUE_BUDDY_NO_SHOW_AFTER;
  manager = await makePerson('Meera Manager', { role: 'Admin' });
  rahul = await makePerson('Rahul Sharma');
  priya = await makePerson('Priya Singh');
  amit = await makePerson('Amit Verma');
});

// ── The nine required scenarios ──────────────────────────────────────────────

describe('Buddy rotation — Delegation', () => {
  test('1. primary available → the task stays with the primary, nothing recorded', async () => {
    const task = await buddyDelegation();
    await runBuddySweep({ now: at(5) });

    const after5 = await Delegation.findById(task._id);
    assert.equal(String(after5.doerId), rahul.id);
    assert.equal(after5.assignmentSource, 'primary');
    assert.equal(after5.assignmentHistory.length, 0);
    assert.equal(await inboxFor(rahul), 0);
  });

  test('2. primary on approved leave → Buddy 1 is activated, told once, and the reason recorded', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6));
    const summary = await runBuddySweep({ now: at(6) });
    assert.equal(summary.activated, 1);

    const row = await Delegation.findById(task._id);
    assert.equal(String(row.doerId), priya.id);
    assert.equal(row.doerFirstName, 'Priya');
    assert.equal(row.assignmentSource, 'automatic');
    assert.match(row.assignmentReason, /Primary assignee Rahul Sharma is on approved leave today/);

    assert.equal(row.assignmentHistory.length, 1);
    const [event] = row.assignmentHistory;
    assert.equal(event.event, 'buddy_activated');
    assert.equal(event.source, 'automatic');
    assert.equal(event.day, D(6));
    assert.equal(String(event.fromUserId), rahul.id);
    assert.equal(String(event.toUserId), priya.id);
    assert.equal(event.unavailable[0].reason, 'on approved leave');

    assert.equal(await inboxFor(priya, INBOX_TYPES.WORK_QUEUE_BUDDY_ASSIGNED), 1);
  });

  test('3. primary and Buddy 1 away → Buddy 2 is activated', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6));
    await mark(priya, D(6), 'absent');
    await runBuddySweep({ now: at(6) });

    const row = await Delegation.findById(task._id);
    assert.equal(String(row.doerId), amit.id);
    assert.match(row.assignmentReason, /Rahul Sharma is on approved leave today; Priya Singh is marked absent/);
    assert.equal(row.assignmentHistory[0].unavailable.length, 2);
  });

  test('4. everyone away → flagged "no available assignee", kept with its doer, manager told once', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6));
    await mark(priya, D(6), 'absent');
    await mark(amit, D(6), 'on_leave');

    const first = await runBuddySweep({ now: at(6) });
    await runBuddySweep({ now: at(6, '10:15') });
    assert.equal(first.noAssignee, 1);

    const row = await Delegation.findById(task._id);
    assert.equal(String(row.doerId), rahul.id, 'never silently unassigned');
    assert.equal(row.noAssigneeDay, D(6));
    assert.match(row.assignmentReason, /Nobody in the buddy chain is available/);
    assert.equal(row.assignmentHistory.length, 1);
    assert.equal(row.assignmentHistory[0].event, 'no_assignee');
    assert.equal(await inboxFor(manager, INBOX_TYPES.WORK_QUEUE_NO_ASSIGNEE), 1);
  });

  test('4b. somebody becomes available later that day → they take it and the flag clears', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6));
    await mark(priya, D(6), 'absent');
    await mark(amit, D(6), 'absent');
    await runBuddySweep({ now: at(6) });

    await AttendanceRecord.updateOne({ employeeId: amit.employee._id }, { status: 'present' });
    await runBuddySweep({ now: at(6, '12:00') });

    const row = await Delegation.findById(task._id);
    assert.equal(String(row.doerId), amit.id);
    assert.equal(row.noAssigneeDay, null);
  });

  test('5 + 6. a one-day absence mid-task affects only that day; the primary is back the next', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6));

    await runBuddySweep({ now: at(5) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), rahul.id);

    await runBuddySweep({ now: at(6) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), priya.id);

    const summary = await runBuddySweep({ now: at(7) });
    assert.equal(summary.restored, 1);
    const row = await Delegation.findById(task._id);
    assert.equal(String(row.doerId), rahul.id);
    assert.equal(row.assignmentSource, 'primary');
    assert.equal(row.assignmentReason, '');
    assert.deepEqual(row.assignmentHistory.map((e) => [e.day, e.event]), [
      [D(6), 'buddy_activated'],
      [D(7), 'primary_restored'],
    ]);
    // One task throughout — no copies.
    assert.equal(await Delegation.countDocuments(), 1);
  });

  test('7. a completed (or submitted) task is never rotated', async () => {
    const done = await buddyDelegation({ status: 'Completed', completedAt: at(5) });
    const submitted = await buddyDelegation({ status: 'Awaiting Verification' });
    await onLeave(rahul, D(6));
    await runBuddySweep({ now: at(6) });

    for (const t of [done, submitted]) {
      const row = await Delegation.findById(t._id);
      assert.equal(String(row.doerId), rahul.id);
      assert.equal(row.assignmentHistory.length, 0);
    }
    assert.equal(await inboxFor(priya), 0);
  });

  test('9. the scheduler run repeatedly — and concurrently — writes and notifies once', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6));

    await Promise.all([runBuddySweep({ now: at(6) }), runBuddySweep({ now: at(6) })]);
    await runBuddySweep({ now: at(6, '10:15') });
    await runBuddySweep({ now: at(6, '10:30') });

    const row = await Delegation.findById(task._id);
    assert.equal(row.assignmentHistory.length, 1);
    assert.equal(await inboxFor(priya), 1);
  });
});

describe('Buddy rotation — the day rules', () => {
  test('within a day the holder keeps it: a primary back at 15:00 does not snatch it back', async () => {
    const task = await buddyDelegation();
    await mark(rahul, D(6), 'absent');
    await runBuddySweep({ now: at(6) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), priya.id);

    await AttendanceRecord.updateOne({ employeeId: rahul.employee._id }, { status: 'present' });
    await runBuddySweep({ now: at(6, '15:00') });
    assert.equal(String((await Delegation.findById(task._id)).doerId), priya.id);
  });

  test('a backup who becomes unavailable mid-day hands it on', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6));
    await runBuddySweep({ now: at(6) });
    await mark(priya, D(6), 'absent');
    await runBuddySweep({ now: at(6, '13:00') });
    assert.equal(String((await Delegation.findById(task._id)).doerId), amit.id);
  });

  test('a task that starts while its primary is already away goes straight to the backup', async () => {
    const task = await buddyDelegation({ startDate: new Date(`${D(6)}T00:00:00.000Z`) });
    await onLeave(rahul, D(4), D(8));
    await runBuddySweep({ now: at(5) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), rahul.id, 'not started yet');
    await runBuddySweep({ now: at(6) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), priya.id);
  });

  test('past its due day the task is not rotated', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(11));
    await runBuddySweep({ now: at(11) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), rahul.id);
  });

  test('half-day leave leaves the primary on duty', async () => {
    const task = await buddyDelegation();
    await onLeave(rahul, D(6), D(6), 'half_day');
    await runBuddySweep({ now: at(6) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), rahul.id);
  });

  test('an exited employee is unavailable', async () => {
    const task = await buddyDelegation();
    await Employee.updateOne({ _id: rahul.employee._id }, { status: 'exited' });
    await runBuddySweep({ now: at(6) });
    assert.equal(String((await Delegation.findById(task._id)).doerId), priya.id);
  });

  test('a company holiday pauses the rotation', async () => {
    const task = await buddyDelegation();
    await Holiday.create({ name: 'Festival', date: D(6), year: 2026 });
    await onLeave(rahul, D(6));
    const summary = await runBuddySweep({ now: at(6) });
    assert.equal(summary.holiday, true);
    assert.equal(String((await Delegation.findById(task._id)).doerId), rahul.id);
  });

  test('no punch counts as absent only past the configured cutoff', async () => {
    const task = await buddyDelegation();
    await mark(priya, D(6), 'present');

    await runBuddySweep({ now: at(6, '12:00') });
    assert.equal(String((await Delegation.findById(task._id)).doerId), rahul.id, 'off by default');

    process.env.WORK_QUEUE_BUDDY_NO_SHOW_AFTER = '11:00';
    await runBuddySweep({ now: at(7, '10:30') });
    assert.equal(String((await Delegation.findById(task._id)).doerId), rahul.id, 'before the cutoff');

    await mark(priya, D(7), 'present');
    await runBuddySweep({ now: at(7, '11:30') });
    const row = await Delegation.findById(task._id);
    assert.equal(String(row.doerId), priya.id);
    assert.match(row.assignmentReason, /has not checked in today/);
  });

  test('pickAssignee walks the chain in priority order', () => {
    const chain = [{ userId: 'a', name: 'A' }, { userId: 'b', name: 'B' }, { userId: 'c', name: 'C' }];
    const avail = new Map([['a', { available: false, reason: 'away', name: 'A' }], ['b', { available: true }], ['c', { available: true }]]);
    assert.equal(pickAssignee(chain, avail).chosen.userId, 'b');
    assert.equal(pickAssignee(chain, avail, { currentId: 'c', sameDay: true }).chosen.userId, 'c');
    assert.equal(pickAssignee(chain, avail, { currentId: 'c', sameDay: false }).chosen.userId, 'b');
    avail.set('b', { available: false, reason: 'away', name: 'B' });
    avail.set('c', { available: false, reason: 'away', name: 'C' });
    const none = pickAssignee(chain, avail);
    assert.equal(none.chosen, null);
    assert.equal(none.skipped.length, 3);
  });
});

describe('Buddy rotation — Checklist', () => {
  test('each occurrence is decided on its own day; other days keep the primary', async () => {
    const routine = await buddyRoutine();
    await onLeave(rahul, D(6));

    await runBuddySweep({ now: at(6) });
    const sixth = await occurrenceOn(routine, 6);
    assert.equal(String(sixth.doer), priya.id);
    assert.equal(sixth.assignmentSource, 'automatic');
    assert.equal(sixth.assignmentHistory[0].event, 'buddy_activated');
    assert.equal(String((await occurrenceOn(routine, 7)).doer), rahul.id);

    await runBuddySweep({ now: at(7) });
    const seventh = await occurrenceOn(routine, 7);
    assert.equal(String(seventh.doer), rahul.id);
    assert.equal(seventh.assignmentHistory.length, 0);
    assert.equal(String((await occurrenceOn(routine, 6)).doer), priya.id, 'yesterday is history');
    assert.equal(await ChecklistOccurrence.countDocuments(), 10, 'no new rows');
  });

  test('7. a completed occurrence and a stopped routine are left alone', async () => {
    const routine = await buddyRoutine();
    await onLeave(rahul, D(6), D(7));
    await ChecklistOccurrence.updateOne({ _id: (await occurrenceOn(routine, 6))._id }, { status: 'completed' });
    await runBuddySweep({ now: at(6) });
    assert.equal(String((await occurrenceOn(routine, 6)).doer), rahul.id);

    await ChecklistRoutine.updateOne({ _id: routine._id }, { isActive: false });
    await runBuddySweep({ now: at(7) });
    assert.equal(String((await occurrenceOn(routine, 7)).doer), rahul.id);
  });

  test('everyone away → manager told through the Checklist notification', async () => {
    const routine = await buddyRoutine();
    for (const p of [rahul, priya, amit]) await mark(p, D(6), 'absent');
    await runBuddySweep({ now: at(6) });
    await runBuddySweep({ now: at(6, '11:00') });
    assert.equal((await occurrenceOn(routine, 6)).noAssigneeDay, D(6));
    assert.equal(await inboxFor(manager, INBOX_TYPES.WORK_QUEUE_CHECKLIST_NO_ASSIGNEE), 1);
  });
});

// ── API: creation, validation, chain edits, manual override ──────────────────

function appFor(user, routes, prefix) {
  return buildTestApp({
    mount: (app) => {
      app.use((req, res, next) => stubProtect(user)(req, res, next));
      app.use(prefix, routes);
    },
  });
}

const DP = '/api/v1/delegation';
const CP = '/api/v1/checklist';
const today = () => officeDayKey();
const inDays = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('Buddy System API', () => {
  test('creating a delegation validates the chain', async () => {
    await withServer(appFor(manager.user, delegationRoutes, DP), async (url) => {
      const base = { taskTitle: 'Report', dueDate: inDays(3), assignmentType: 'buddy' };

      const one = await post(url, DP, { ...base, buddyChain: [rahul.id] });
      assert.equal(one.status, 400);
      assert.match(one.body.message, /at least one backup/);

      const dup = await post(url, DP, { ...base, buddyChain: [rahul.id, priya.id, rahul.id] });
      assert.equal(dup.status, 400);
      assert.match(dup.body.message, /cannot appear twice/);

      const ghost = await post(url, DP, { ...base, buddyChain: [rahul.id, String(new mongoose.Types.ObjectId())] });
      assert.equal(ghost.status, 400);

      await User.updateOne({ _id: amit.user._id }, { status: 'Suspended' });
      const inactive = await post(url, DP, { ...base, buddyChain: [rahul.id, amit.id] });
      assert.equal(inactive.status, 400);
      assert.match(inactive.body.message, /Amit Verma is not an active user/);

      const ok = await post(url, DP, { ...base, buddyChain: [rahul.id, priya.id] });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.data.assignmentType, 'buddy');
      assert.equal(String(ok.body.data.doerId), rahul.id);
      assert.deepEqual(ok.body.data.buddyChain.map((m) => m.name), ['Rahul Sharma', 'Priya Singh']);
    });
  });

  test('a task created while the primary is already on leave goes to the backup at once', async () => {
    await onLeave(rahul, today(), inDays(2));
    await withServer(appFor(manager.user, delegationRoutes, DP), async (url) => {
      const res = await post(url, DP, {
        taskTitle: 'Report', dueDate: inDays(3), assignmentType: 'buddy', buddyChain: [rahul.id, priya.id],
      });
      assert.equal(res.status, 201);
      assert.equal(String(res.body.data.doerId), priya.id);
    });
  });

  test('removing the backup who holds the task re-decides it from the new chain', async () => {
    await onLeave(rahul, today(), inDays(2));
    await withServer(appFor(manager.user, delegationRoutes, DP), async (url) => {
      const created = await post(url, DP, {
        taskTitle: 'Report', dueDate: inDays(3), assignmentType: 'buddy', buddyChain: [rahul.id, priya.id, amit.id],
      });
      assert.equal(String(created.body.data.doerId), priya.id);

      const edited = await put(url, `${DP}/${created.body.data._id}`, { buddyChain: [rahul.id, amit.id] });
      assert.equal(edited.status, 200);
      assert.equal(String(edited.body.data.doerId), amit.id);
      assert.ok(edited.body.data.assignmentHistory.some((e) => e.event === 'chain_changed'));
    });
  });

  test('a backup can read the task; only an owner can override its assignee', async () => {
    const task = await buddyDelegation({ startDate: new Date(), dueDate: new Date(`${inDays(3)}T00:00:00.000Z`) });
    await withServer(appFor(priya.user, delegationRoutes, DP), async (url) => {
      const res = await patch(url, `${DP}/${task._id}/assignee`, { doerId: priya.id });
      assert.equal(res.status, 403);
    });
  });

  test('8. a manual override pins the doer until the rotation is resumed', async () => {
    const task = await buddyDelegation({ startDate: new Date(), dueDate: new Date(`${inDays(3)}T00:00:00.000Z`) });
    await withServer(appFor(manager.user, delegationRoutes, DP), async (url) => {
      const res = await patch(url, `${DP}/${task._id}/assignee`, { doerId: amit.id, reason: 'Covering the audit' });
      assert.equal(res.status, 200);
      assert.equal(String(res.body.data.doerId), amit.id);
      assert.equal(res.body.data.assignmentSource, 'manual');
      const event = res.body.data.assignmentHistory.at(-1);
      assert.equal(event.event, 'manual_override');
      assert.equal(event.source, 'manual');
      assert.equal(event.byName, 'Meera Manager');

      // Rahul and Priya are both available; the pinned task stays with Amit.
      await runBuddySweep();
      await runBuddySweep({ now: new Date(Date.now() + 24 * 60 * 60 * 1000) });
      assert.equal(String((await Delegation.findById(task._id)).doerId), amit.id);

      const resumed = await patch(url, `${DP}/${task._id}/assignee`, { resume: true });
      assert.equal(resumed.status, 200);
      assert.equal(String(resumed.body.data.doerId), rahul.id);
      assert.notEqual(resumed.body.data.assignmentSource, 'manual');
    });
    assert.equal(await inboxFor(amit, INBOX_TYPES.WORK_QUEUE_BUDDY_ASSIGNED), 1);
  });

  test('override refuses inactive employees and single-assignee tasks', async () => {
    const buddy = await buddyDelegation({ startDate: new Date(), dueDate: new Date(`${inDays(3)}T00:00:00.000Z`) });
    const single = await Delegation.create({
      taskTitle: 'Single', assignerId: manager.user._id, doerId: rahul.user._id, dueDate: new Date(`${inDays(3)}T00:00:00.000Z`),
    });
    await Employee.updateOne({ _id: amit.employee._id }, { status: 'exited' });
    await withServer(appFor(manager.user, delegationRoutes, DP), async (url) => {
      const exited = await patch(url, `${DP}/${buddy._id}/assignee`, { doerId: amit.id });
      assert.equal(exited.status, 400);
      assert.match(exited.body.message, /exited/);
      const notBuddy = await patch(url, `${DP}/${single._id}/assignee`, { doerId: priya.id });
      assert.equal(notBuddy.status, 400);
    });
  });

  test('checklist: a buddy routine rotates today at creation; a manual reassign is respected', async () => {
    await onLeave(rahul, today());
    await withServer(appFor(manager.user, checklistRoutes, CP), async (url) => {
      const res = await post(url, `${CP}/routines`, {
        taskName: 'Daily Sales Report',
        taskCode: 'DSR-API',
        frequency: 'daily',
        startDate: today(),
        endDate: inDays(2),
        assignmentType: 'buddy',
        buddyChain: [rahul.id, priya.id, amit.id],
      });
      assert.equal(res.status, 201);

      const todays = await ChecklistOccurrence.findOne({ taskCode: 'DSR-API', plannedDate: dayStamp(today()) });
      assert.equal(String(todays.doer), priya.id);
      const later = await ChecklistOccurrence.find({ taskCode: 'DSR-API', plannedDate: { $gt: dayStamp(today()) } });
      assert.ok(later.every((o) => String(o.doer) === rahul.id));

      const moved = await patch(url, `${CP}/tasks/${todays._id}/reassign`, { newDoer: amit.id });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.data.assignmentSource, 'manual');
      assert.equal(moved.body.data.assignmentHistory.at(-1).event, 'manual_override');

      await runBuddySweep();
      assert.equal(String((await ChecklistOccurrence.findById(todays._id)).doer), amit.id);
    });
  });

  test('checklist: only managers can set up a buddy chain', async () => {
    await withServer(appFor(rahul.user, checklistRoutes, CP), async (url) => {
      const res = await post(url, `${CP}/routines`, {
        taskName: 'X', taskCode: 'X-1', frequency: 'once', startDate: today(),
        assignmentType: 'buddy', buddyChain: [rahul.id, priya.id],
      });
      assert.equal(res.status, 403);
    });
  });
});
