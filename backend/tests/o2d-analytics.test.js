/**
 * FMS analytics and export.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE ARE REALLY GUARDING
 * ---------------------------------------------------------------------------
 *
 * The 2,315 migrated orders carry ACTUAL dates only — no per-stage planned
 * dates, confirmed with the business. So they cannot be scored for on-time
 * performance, but they can be measured for cycle time.
 *
 * A wrong denominator does not look wrong. "87% on-time" computed over the
 * wrong set is a plausible number on a dashboard that nobody questions until a
 * decision has been made on it. These tests pin the denominators in both
 * directions — that migrated orders are excluded where they must be, and
 * INCLUDED where excluding them would throw away a year of real history.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder, o2dKey } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as analytics from '../modules/o2d/analytics.service.js';
import * as exporter from '../modules/o2d/export.service.js';
import { STAGE_STATUS, ORDER_STATUS, STAGES } from '../shared/constants/o2d.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster);
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

/**
 * An order with hand-placed stage rows.
 *
 * Built directly rather than through the engine, because these tests need
 * specific on-time/late/missing-deadline shapes that would take a dozen
 * transitions each to produce honestly.
 */
async function makeOrder({
  poNumber,
  migrated = false,
  dispatchedAt = null,
  poDate = ist('2026-09-01', '09:00'),
  customerName = 'ABC Industries',
  stages = [],
  status = ORDER_STATUS.OPEN,
}) {
  const order = await O2dOrder.create({
    poNumber,
    poNumberKey: o2dKey(poNumber),
    poDate,
    customerName,
    customerKey: o2dKey(customerName),
    promiseDate: ist('2026-09-20', '10:00'),
    migrated,
    dispatchedAt,
    status,
  });

  if (stages.length > 0) {
    await O2dOrderStage.insertMany(
      stages.map((s) => ({
        order: order._id,
        stageNumber: s.stageNumber,
        stageKey: `k${s.stageNumber}`,
        stageName: s.stageName ?? `Stage ${s.stageNumber}`,
        ownerRole: s.ownerRole ?? 'Billing',
        status: s.status,
        sla: { type: 'WORKING_HOURS', value: 3, byMinute: null },
        // The distinguishing field: migrated history has NO deadline.
        plannedCompletion: s.plannedCompletion ?? null,
        actualCompletion: s.actualCompletion ?? ist('2026-09-02', '11:00'),
        delayMinutes: s.delayMinutes ?? 0,
        completedBy: s.completedBy ?? null,
        completedByName: s.completedByName ?? null,
        completedByRole: s.completedByRole ?? null,
        skipReason: s.skipReason ?? null,
      })),
    );
  }

  return order;
}

const onTime = (n, over = {}) => ({
  stageNumber: n,
  status: STAGE_STATUS.DONE_ON_TIME,
  plannedCompletion: ist('2026-09-02', '12:00'),
  delayMinutes: 0,
  ...over,
});

const late = (n, minutes, over = {}) => ({
  stageNumber: n,
  status: STAGE_STATUS.DONE_LATE,
  plannedCompletion: ist('2026-09-02', '10:00'),
  delayMinutes: minutes,
  ...over,
});

/** A migrated stage: completed, but with no deadline to have been judged by. */
const historical = (n, over = {}) => ({
  stageNumber: n,
  status: STAGE_STATUS.DONE_ON_TIME,
  plannedCompletion: null,
  delayMinutes: 0,
  ...over,
});

// ---------------------------------------------------------------------------

describe('SLA compliance excludes what it cannot score', () => {
  test('a migrated order contributes nothing to the on-time percentage', async () => {
    await makeOrder({ poNumber: 'PO-LIVE', stages: [onTime(2), late(3, 60)] });
    await makeOrder({
      poNumber: 'PO-OLD',
      customerName: 'XYZ Traders',
      migrated: true,
      // Marked DONE_ON_TIME, but with no deadline it was never judged against
      // anything. Counting it would silently inflate the figure.
      stages: [historical(2), historical(3)],
    });

    const sla = await analytics.slaCompliance({});

    // Two scorable stages: one on time, one late.
    assert.equal(sla.completed, 2);
    assert.equal(sla.onTime, 1);
    assert.equal(sla.onTimePercentage, 50);
  });

  test('and the figure says so, rather than leaving the reader to infer it', async () => {
    await makeOrder({ poNumber: 'PO-LIVE', stages: [onTime(2)] });
    await makeOrder({ poNumber: 'PO-OLD', customerName: 'XYZ', migrated: true, stages: [historical(2)] });

    const { coverage } = await analytics.slaCompliance({});

    assert.equal(coverage.ordersInRange, 2);
    assert.equal(coverage.ordersScored, 1);
    assert.equal(coverage.ordersExcluded, 1);
    assert.equal(coverage.complete, false);
    // The sentence a manager reads under the percentage.
    assert.match(coverage.note, /migrated history and carry actual dates only/);
    assert.match(coverage.note, /included in cycle-time and volume/);
  });

  test('a range with no migrated orders reports complete coverage and no note', async () => {
    await makeOrder({ poNumber: 'PO-LIVE', stages: [onTime(2)] });

    const { coverage } = await analytics.slaCompliance({});
    assert.equal(coverage.complete, true);
    assert.equal(coverage.note, null);
  });

  test('nothing scorable gives null, NOT zero', async () => {
    await makeOrder({ poNumber: 'PO-OLD', migrated: true, stages: [historical(2)] });

    const sla = await analytics.slaCompliance({});
    // 0% means "everything was late" — a catastrophic finding. null means "we
    // cannot say". A dashboard rendering 0 here invents a crisis.
    assert.equal(sla.onTimePercentage, null);
    assert.equal(sla.completed, 0);
  });

  test('a skipped stage leaves the KPI and is reported as having done so', async () => {
    await makeOrder({
      poNumber: 'PO-LIVE',
      stages: [
        onTime(2),
        {
          stageNumber: STAGES.RECEIVE_ADVANCE,
          status: STAGE_STATUS.SKIPPED,
          plannedCompletion: ist('2026-09-02', '10:00'),
          skipReason: 'Not an advance order',
        },
      ],
    });

    const sla = await analytics.slaCompliance({});
    assert.equal(sla.completed, 1, 'the skip is not counted as work done');
    assert.equal(sla.onTimePercentage, 100);
    // Surfaced so a reader can confirm skips were not used to improve the score.
    assert.equal(sla.coverage.stagesSkipped, 1);
  });

  test('per-stage figures average the delay over LATE stages only', async () => {
    // Two ORDERS, not two stage-3 rows on one: a unique index enforces one
    // stage per order, which is correct and is what this fixture must respect.
    await makeOrder({
      poNumber: 'PO-A',
      stages: [onTime(3, { stageName: 'Send SOR + PI' })],
    });
    await makeOrder({
      poNumber: 'PO-B',
      customerName: 'XYZ Traders',
      stages: [late(3, 60, { stageName: 'Send SOR + PI' })],
    });

    const sla = await analytics.slaCompliance({});
    const stage3 = sla.byStage.find((s) => s.stageNumber === 3);

    assert.equal(stage3.completed, 2);
    assert.equal(stage3.onTimePercentage, 50);
    // 60, not 30. Averaging in the zeros of on-time stages produces a number
    // that falls as the team improves and understates how bad the late ones are.
    assert.equal(stage3.averageDelayMinutes, 60);
  });
});

// ---------------------------------------------------------------------------

describe('cycle time INCLUDES migrated history', () => {
  test('because it needs only actual dates', async () => {
    await makeOrder({
      poNumber: 'PO-LIVE',
      poDate: ist('2026-09-01', '10:00'),
      dispatchedAt: ist('2026-09-03', '10:00'),
      stages: [onTime(2)],
    });
    await makeOrder({
      poNumber: 'PO-OLD',
      customerName: 'XYZ Traders',
      migrated: true,
      poDate: ist('2026-09-01', '10:00'),
      dispatchedAt: ist('2026-09-05', '10:00'),
      stages: [historical(2)],
    });

    const cycle = await analytics.cycleTime({});

    // Both orders. Excluding the migrated one here would throw away exactly the
    // history the migration exists to preserve.
    assert.equal(cycle.count, 2);
    assert.equal(cycle.includesMigrated, true);
    assert.equal(cycle.migratedCount, 1);
    assert.equal(cycle.medianHours, 72);
  });

  test('reports a median alongside the mean, so one stuck order cannot distort it', async () => {
    const base = { customerName: 'ABC', stages: [] };
    await makeOrder({ ...base, poNumber: 'P1', poDate: ist('2026-09-01', '10:00'), dispatchedAt: ist('2026-09-02', '10:00') });
    await makeOrder({ ...base, poNumber: 'P2', customerName: 'B', poDate: ist('2026-09-01', '10:00'), dispatchedAt: ist('2026-09-02', '10:00') });
    // One order that sat for 90 days waiting on an import.
    await makeOrder({ ...base, poNumber: 'P3', customerName: 'C', poDate: ist('2026-09-01', '10:00'), dispatchedAt: ist('2026-11-30', '10:00') });

    const cycle = await analytics.cycleTime({});
    assert.equal(cycle.medianHours, 24, 'the typical order took a day');
    assert.ok(cycle.averageHours > 500, 'the mean is dragged somewhere no real order lives');
  });

  test('an empty range reports null rather than zero', async () => {
    const cycle = await analytics.cycleTime({});
    assert.equal(cycle.count, 0);
    assert.equal(cycle.medianHours, null);
  });
});

// ---------------------------------------------------------------------------

describe('volume counts include everything', () => {
  test('a migrated order is still an order the business shipped', async () => {
    await makeOrder({ poNumber: 'PO-LIVE', status: ORDER_STATUS.CLOSED });
    await makeOrder({ poNumber: 'PO-OLD', customerName: 'XYZ', migrated: true, status: ORDER_STATUS.CLOSED });

    const summary = await analytics.dashboardSummary({});
    assert.equal(summary.closed, 2, 'leaving migrated orders out would understate the year');
    assert.equal(summary.total, 2);
  });
});

// ---------------------------------------------------------------------------

describe('delay analysis', () => {
  test('ranks by total time lost, not by worst average', async () => {
    // Stage 3: late twice, 60 minutes each -> 120 total.
    await makeOrder({ poNumber: 'PO-A', stages: [late(3, 60, { stageName: 'SOR' })] });
    await makeOrder({ poNumber: 'PO-B', customerName: 'B', stages: [late(3, 60, { stageName: 'SOR' })] });
    // Stage 8: late once, 100 minutes -> worse average, less total impact.
    await makeOrder({ poNumber: 'PO-C', customerName: 'C', stages: [late(8, 100, { stageName: 'Invoice' })] });

    const { data } = await analytics.delayAnalysis({});
    assert.equal(data[0].stageNumber, 3, 'fixing the stage that loses the most time comes first');
    assert.equal(data[0].totalDelayMinutes, 120);
    assert.equal(data[0].lateCount, 2);
    assert.equal(data[1].stageNumber, 8);
  });

  test('carries the same coverage caveat', async () => {
    await makeOrder({ poNumber: 'PO-OLD', migrated: true, stages: [historical(2)] });
    const { coverage } = await analytics.delayAnalysis({});
    assert.equal(coverage.ordersExcluded, 1);
  });
});

// ---------------------------------------------------------------------------

describe('performance', () => {
  test('by role is a fair comparison and is reported plainly', async () => {
    await makeOrder({
      poNumber: 'PO-A',
      stages: [
        onTime(3, { ownerRole: 'Billing' }),
        late(9, 30, { ownerRole: 'Warehouse User' }),
      ],
    });

    const { data } = await analytics.performanceByRole({});
    const billing = data.find((r) => r.role === 'Billing');
    const warehouse = data.find((r) => r.role === 'Warehouse User');

    assert.equal(billing.onTimePercentage, 100);
    assert.equal(warehouse.onTimePercentage, 0);
    assert.equal(warehouse.averageDelayMinutes, 30);
  });

  test('by person ships with the caution it needs', async () => {
    await makeOrder({
      poNumber: 'PO-A',
      stages: [late(8, 15, { completedBy: undefined, completedByName: 'Ramesh', completedByRole: 'Billing' })],
    });

    const result = await analytics.performanceByPerson({});
    // The attribution is to whoever RECORDED the completion, who is often not
    // the cause — so the figure must not be presented as a ranking.
    assert.match(result.caution, /often not the cause/);
  });

  test('by customer measures what the customer experienced', async () => {
    await makeOrder({
      poNumber: 'PO-A',
      customerName: 'ABC Industries',
      poDate: ist('2026-09-01', '10:00'),
      dispatchedAt: ist('2026-09-03', '10:00'),
    });

    const { data } = await analytics.performanceByCustomer({});
    assert.equal(data[0].customerName, 'ABC Industries');
    assert.equal(data[0].averageHours, 48);
  });
});

// ---------------------------------------------------------------------------

describe('export', () => {
  test('the workbook leads with the coverage sheet', async () => {
    await makeOrder({ poNumber: 'PO-LIVE', stages: [onTime(2)] });
    await makeOrder({ poNumber: 'PO-OLD', customerName: 'XYZ', migrated: true, stages: [historical(2)] });

    const { buffer, filename } = await exporter.exportWorkbook('orders', {});
    const book = XLSX.read(buffer, { type: 'buffer' });

    // First, so it is the sheet that opens — the caveat must travel with the
    // file, which outlives the dashboard it came from.
    assert.equal(book.SheetNames[0], 'Coverage');
    assert.ok(book.SheetNames.includes('Orders'));
    assert.match(filename, /^o2d-orders-\d{4}-\d{2}-\d{2}\.xlsx$/);

    const coverage = XLSX.utils.sheet_to_json(book.Sheets.Coverage, { header: 1 });
    const flat = coverage.flat().join(' ');
    assert.match(flat, /cannot be scored|migrated history/i);
  });

  test('marks which rows are migrated, so a filtered sheet reaches the same answer', async () => {
    await makeOrder({ poNumber: 'PO-LIVE', stages: [onTime(2)] });
    await makeOrder({ poNumber: 'PO-OLD', customerName: 'XYZ', migrated: true, stages: [historical(2)] });

    const { buffer } = await exporter.exportWorkbook('orders', {});
    const book = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets.Orders);

    const old = rows.find((r) => r['PO Number'] === 'PO-OLD');
    const live = rows.find((r) => r['PO Number'] === 'PO-LIVE');
    assert.equal(old['Migrated History'], 'YES');
    assert.equal(live['Migrated History'], 'no');
  });

  test('neutralises a formula so a customer name cannot execute in Excel', async () => {
    await makeOrder({ poNumber: 'PO-A', customerName: "=cmd|'/c calc'!A1" });

    const { buffer } = await exporter.exportWorkbook('orders', {});
    const book = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets.Orders);

    const cell = rows.find((r) => r['PO Number'] === 'PO-A').Customer;
    // Prefixed, so Excel treats it as text. xlsx will happily write a string
    // that Excel then evaluates; it does not guard this for you.
    assert.ok(cell.startsWith("'"), `expected the formula to be neutralised, got ${cell}`);
  });

  test('the stage export says per-row whether each stage is scorable', async () => {
    await makeOrder({ poNumber: 'PO-LIVE', stages: [onTime(2)] });
    await makeOrder({ poNumber: 'PO-OLD', customerName: 'XYZ', migrated: true, stages: [historical(2)] });

    const { buffer } = await exporter.exportWorkbook('stages', {});
    const book = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets.Stages);

    assert.equal(rows.find((r) => r['PO Number'] === 'PO-LIVE').Scorable, 'yes');
    assert.equal(rows.find((r) => r['PO Number'] === 'PO-OLD').Scorable, 'no');
  });

  test('CSV carries the caveat as its first line', async () => {
    await makeOrder({ poNumber: 'PO-OLD', migrated: true, stages: [historical(2)] });

    const { csv } = await exporter.exportCsv('orders', {});
    assert.ok(csv.startsWith('# '), 'a CSV has no second sheet, so the caveat leads the file');
    assert.match(csv.split('\n')[0], /migrated history/);
  });

  test('an unknown dataset is refused by name', async () => {
    await assert.rejects(
      () => exporter.exportWorkbook('everything', {}),
      (e) => e.code === 'O2D_UNKNOWN_EXPORT',
    );
  });
});
