/**
 * Exporting O2D data to Excel and CSV (§41).
 *
 * ---------------------------------------------------------------------------
 * FORMULA INJECTION APPLIES TO XLSX TOO
 * ---------------------------------------------------------------------------
 *
 * The HRMS report exporter already guards CSV: a cell beginning `=`, `+`, `-`
 * or `@` is prefixed with an apostrophe, because every column is user-supplied
 * text and a customer named `=cmd|'/c calc'!A1` becomes a live formula in Excel
 * for whoever opens it.
 *
 * The same is true of a real .xlsx — arguably more so, since `sheet_to_*` will
 * happily write a string that Excel then evaluates. `xlsx` does not do this for
 * you. So every cell written here goes through the SAME `csvCell` guard, reused
 * rather than reimplemented, and the type is pinned to string so a value cannot
 * be re-interpreted on open.
 *
 * ---------------------------------------------------------------------------
 * AN EXPORT CARRIES ITS CAVEAT
 * ---------------------------------------------------------------------------
 *
 * A spreadsheet outlives the screen it came from. It gets emailed, filtered and
 * quoted in a meeting six weeks later, by which time nobody remembers that the
 * on-time column excluded 2,315 migrated orders. So every workbook gets a
 * COVERAGE sheet, and the CSV gets the same text as a leading comment block —
 * the caveat travels with the file rather than staying on the dashboard.
 */

import XLSX from 'xlsx';

import { csvCell, toCsv } from '../hrms/reports/report.service.js';
import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import * as analytics from './analytics.service.js';
import { TERMINAL_STAGE_STATUSES } from '../../shared/constants/o2d.js';
import { O2dWorkflowError } from './stage.engine.js';

/** A hard ceiling, so one click cannot try to serialise the whole database. */
const MAX_ROWS = 20_000;

const iso = (d) => (d ? new Date(d).toISOString() : '');

// ---------------------------------------------------------------------------
// The datasets
// ---------------------------------------------------------------------------

const ORDER_COLUMNS = [
  { key: 'poNumber', label: 'PO Number' },
  { key: 'customerName', label: 'Customer' },
  { key: 'poDate', label: 'PO Date' },
  { key: 'promiseDate', label: 'Promise Date' },
  { key: 'status', label: 'Status' },
  { key: 'currentStage', label: 'Current Stage' },
  { key: 'dispatchedAt', label: 'Dispatched At' },
  { key: 'invoiceNumber', label: 'Invoice' },
  { key: 'totalOrderedQty', label: 'Ordered Qty' },
  { key: 'totalDispatchedQty', label: 'Dispatched Qty' },
  { key: 'cycleHours', label: 'Cycle Time (hours)' },
  // Present in the export precisely so a reader filtering the sheet can see
  // which rows cannot be scored, rather than discovering it from a footnote.
  { key: 'migrated', label: 'Migrated History' },
];

const STAGE_COLUMNS = [
  { key: 'poNumber', label: 'PO Number' },
  { key: 'customerName', label: 'Customer' },
  { key: 'stageNumber', label: 'Stage No' },
  { key: 'stageName', label: 'Stage' },
  { key: 'ownerRole', label: 'Owner Role' },
  { key: 'status', label: 'Status' },
  { key: 'plannedCompletion', label: 'Planned Completion' },
  { key: 'actualCompletion', label: 'Actual Completion' },
  { key: 'delayMinutes', label: 'Delay (working minutes)' },
  { key: 'completedByName', label: 'Completed By' },
  { key: 'skipReason', label: 'Skip Reason' },
  { key: 'overrideReason', label: 'Override Reason' },
  { key: 'scorable', label: 'Scorable' },
];

async function orderRows({ from = null, to = null, status = null } = {}) {
  const match = {};
  if (from || to) {
    match.poDate = {};
    if (from) match.poDate.$gte = new Date(from);
    if (to) match.poDate.$lte = new Date(to);
  }
  if (status?.length) match.status = { $in: status };

  const rows = await O2dOrder.find(match).sort({ poDate: -1 }).limit(MAX_ROWS + 1).lean();
  const truncated = rows.length > MAX_ROWS;

  return {
    truncated,
    rows: rows.slice(0, MAX_ROWS).map((o) => ({
      poNumber: o.poNumber,
      customerName: o.customerName,
      poDate: iso(o.poDate),
      promiseDate: iso(o.promiseDate),
      status: o.status,
      currentStage: o.currentStage,
      dispatchedAt: iso(o.dispatchedAt),
      invoiceNumber: o.invoiceNumber ?? '',
      totalOrderedQty: o.totalOrderedQty ?? 0,
      totalDispatchedQty: o.totalDispatchedQty ?? 0,
      cycleHours:
        o.dispatchedAt && o.poDate
          ? Number(((new Date(o.dispatchedAt) - new Date(o.poDate)) / 3_600_000).toFixed(1))
          : '',
      migrated: o.migrated ? 'YES' : 'no',
    })),
  };
}

async function stageRows({ from = null, to = null } = {}) {
  const match = {};
  if (from || to) {
    match.poDate = {};
    if (from) match.poDate.$gte = new Date(from);
    if (to) match.poDate.$lte = new Date(to);
  }

  const orders = await O2dOrder.find(match).select('poNumber customerName').lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));

  const rows = await O2dOrderStage.find({ order: { $in: orders.map((o) => o._id) } })
    .sort({ order: 1, stageNumber: 1 })
    .limit(MAX_ROWS + 1)
    .lean();
  const truncated = rows.length > MAX_ROWS;

  return {
    truncated,
    rows: rows.slice(0, MAX_ROWS).map((s) => {
      const order = byId.get(String(s.order));
      return {
        poNumber: order?.poNumber ?? '',
        customerName: order?.customerName ?? '',
        stageNumber: s.stageNumber,
        stageName: s.stageName,
        ownerRole: s.ownerRole,
        status: s.status,
        plannedCompletion: iso(s.plannedCompletion),
        actualCompletion: iso(s.actualCompletion),
        delayMinutes: s.delayMinutes ?? '',
        completedByName: s.completedByName ?? '',
        skipReason: s.skipReason ?? '',
        overrideReason: s.overrideReason ?? '',
        // The per-row answer to "can this be counted?", so a reader filtering
        // the sheet reaches the same denominator the dashboard used.
        scorable:
          s.plannedCompletion && TERMINAL_STAGE_STATUSES.includes(s.status) ? 'yes' : 'no',
      };
    }),
  };
}

const DATASETS = Object.freeze({
  orders: { columns: ORDER_COLUMNS, load: orderRows, label: 'Orders' },
  stages: { columns: STAGE_COLUMNS, load: stageRows, label: 'Stages' },
});

export const DATASET_KEYS = Object.keys(DATASETS);

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Every cell, through the injection guard, written as a STRING.
 *
 * `csvCell` also quotes and escapes for CSV — harmless here, because the value
 * lands in a single xlsx cell either way, and reusing the one audited guard is
 * worth more than a cosmetically cleaner cell.
 */
const sheetFrom = (columns, rows) =>
  XLSX.utils.aoa_to_sheet([
    columns.map((c) => c.label),
    ...rows.map((row) => columns.map((c) => csvCell(row[c.key]))),
  ]);

/** The caveat, as rows, so it can be a sheet or a comment block. */
function coverageRows(coverage, cycle) {
  return [
    ['O2D Export — read this first'],
    [],
    ['Orders in range', coverage?.ordersInRange ?? '—'],
    ['Orders scored for on-time performance', coverage?.ordersScored ?? '—'],
    ['Orders EXCLUDED from on-time performance', coverage?.ordersExcluded ?? 0],
    ['Stages skipped (excluded from KPI by design)', coverage?.stagesSkipped ?? 0],
    [],
    ['Why some orders are excluded'],
    [
      coverage?.note
        ?? 'All orders in this range carry recorded deadlines and can be scored.',
    ],
    [],
    ['Cycle time INCLUDES migrated orders', cycle?.includesMigrated ? 'yes' : 'no'],
    ['Migrated orders in the cycle-time figure', cycle?.migratedCount ?? 0],
    [],
    [
      'Cycle time needs only actual dates, so migrated history can be measured. '
      + 'On-time performance needs a recorded deadline, which migrated history does not have. '
      + 'The two figures therefore have different denominators. This is deliberate.',
    ],
  ];
}

/**
 * Build a workbook.
 *
 * @returns {Promise<{buffer: Buffer, filename: string, rows: number, truncated: boolean}>}
 */
export async function exportWorkbook(dataset, params = {}) {
  const definition = DATASETS[dataset];
  if (!definition) {
    throw new O2dWorkflowError(
      `"${dataset}" is not an export. Expected one of: ${DATASET_KEYS.join(', ')}.`,
      { status: 400, code: 'O2D_UNKNOWN_EXPORT' },
    );
  }

  const { rows, truncated } = await definition.load(params);
  const [sla, cycle] = await Promise.all([
    analytics.slaCompliance(params),
    analytics.cycleTime(params),
  ]);

  const book = XLSX.utils.book_new();
  // Coverage FIRST, so it is the sheet that opens.
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(coverageRows(sla.coverage, cycle)),
    'Coverage',
  );
  XLSX.utils.book_append_sheet(book, sheetFrom(definition.columns, rows), definition.label);

  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  return {
    buffer,
    filename: `o2d-${dataset}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    rows: rows.length,
    truncated,
  };
}

/** The same data as CSV, with the caveat as a leading comment block. */
export async function exportCsv(dataset, params = {}) {
  const definition = DATASETS[dataset];
  if (!definition) {
    throw new O2dWorkflowError(
      `"${dataset}" is not an export. Expected one of: ${DATASET_KEYS.join(', ')}.`,
      { status: 400, code: 'O2D_UNKNOWN_EXPORT' },
    );
  }

  const { rows, truncated } = await definition.load(params);
  const sla = await analytics.slaCompliance(params);

  // A CSV has no second sheet, so the caveat leads the file. `#` is not a CSV
  // comment convention, but a reader opening this in Excel sees it in row 1,
  // which is the point.
  const preamble = sla.coverage?.note ? `# ${sla.coverage.note}\n` : '';

  return {
    csv: preamble + toCsv(definition.columns, rows),
    filename: `o2d-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`,
    rows: rows.length,
    truncated,
  };
}

export default { exportWorkbook, exportCsv, DATASET_KEYS };
