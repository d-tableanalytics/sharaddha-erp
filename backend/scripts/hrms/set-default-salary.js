#!/usr/bin/env node
/**
 * Put every employee on the default salary.
 *
 *   node scripts/hrms/set-default-salary.js              # dry run, changes nothing
 *   node scripts/hrms/set-default-salary.js --execute    # writes
 *
 * DRY RUN IS THE DEFAULT, and `--execute` is the only thing that opens a write.
 * The dry run prints the same plan the execution will follow, employee by
 * employee, so the whole effect can be read before any of it happens.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THIS OVERWRITES REAL PAY
 * ---------------------------------------------------------------------------
 * It is not a backfill. It puts EVERY active employee on the default salary,
 * including people who are already on a different, deliberately set figure —
 * that is what it was asked to do, and it is the reason for every safeguard
 * below. `--only-missing` is here for the far more usual intention: give the
 * default to people who have no salary at all and leave everybody else alone.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EDITED IN PLACE
 * ---------------------------------------------------------------------------
 * Compensation is effective-dated: a change OPENS A NEW ROW and closes the
 * previous one the day before (compensation.service.js's header explains why).
 * This script goes through `createCompensation` for exactly that reason, so:
 *
 *   - last month's payroll still computes on last month's salary, and a
 *     historic payslip regenerated afterwards still matches the one the
 *     employee was given;
 *   - every change lands in the audit log with its before and after;
 *   - the previous figure is still on the record, so this is reversible by
 *     opening another revision rather than by restoring a backup.
 *
 * The consequence is a rule this script cannot bend: a revision must start
 * AFTER the row it supersedes. An employee whose current row already starts
 * today or later is REPORTED AND SKIPPED, never forced — `--effective-from`
 * can move the whole run to a later date if that is what is wanted.
 *
 * ---------------------------------------------------------------------------
 * AMOUNT
 * ---------------------------------------------------------------------------
 * Rs 10,000 a month, stored as a Rs 1,20,000 annual CTC. The figure, both
 * readings of it and why monthly is the one used live in
 * `shared/payroll/defaultSalary.js`; `--ctc-basis annual` selects the other.
 * No amount is printed to a log or written into audit metadata.
 */

import process from 'node:process';
import path from 'node:path';
import mongoose from 'mongoose';
import 'dotenv/config';

import { connectDatabase } from '../../config/database.js';
import Employee from '../../models/hrms/Employee.js';
import { PayGroup, SalaryStructure, SalaryComponent, EmployeeCompensation } from '../../models/hrms/PayrollModels.js';
import { createCompensation } from '../../modules/hrms/payroll/compensation.service.js';
import { bootstrapHrms } from '../../modules/hrms/hrms.bootstrap.js';
import { CTC_BASIS, DEFAULT_CTC_BASIS, DEFAULT_SALARY_INSTRUCTION } from '../../shared/payroll/defaultSalary.js';

const today = () => new Date().toISOString().slice(0, 10);

export function parseArgs(argv) {
  const args = {
    execute: false,
    onlyMissing: false,
    ctcBasis: DEFAULT_CTC_BASIS,
    effectiveFrom: today(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--only-missing') args.onlyMissing = true;
    else if (a === '--ctc-basis') args.ctcBasis = (argv[++i] ?? '').toLowerCase();
    else if (a === '--effective-from') args.effectiveFrom = argv[++i] ?? '';
    else if (a === '--help' || a === '-h') args.help = true;
    else args.unknown = a;
  }
  return args;
}

const USAGE = `
Usage: node scripts/hrms/set-default-salary.js [options]

  --execute                 Write. Without it, nothing is changed.
  --only-missing            Only employees who have no compensation at all.
  --ctc-basis monthly|annual  How to read ${DEFAULT_SALARY_INSTRUCTION} (default: ${DEFAULT_CTC_BASIS}).
  --effective-from YYYY-MM-DD  When the new salary starts (default: today).
`.trim();

/**
 * The pay group and structure a compensation row needs.
 *
 * Compensation cannot exist without both, and a structure cannot exist without
 * at least one component. Where an employee already has a compensation row, THAT
 * row's pay group and structure are reused — moving someone between pay groups
 * is a payroll decision, not something a salary default gets to do silently.
 *
 * For an employee with no row, the default pay group and its default structure
 * are used. If none exists this REFUSES rather than inventing one: the importer
 * creates a one-component structure because it is standing up an empty system,
 * which is a different situation from a live one that should already have them.
 */
async function resolveDefaults() {
  const payGroup = await PayGroup.findOne({ deletedAt: null }).sort({ isDefault: -1, createdAt: 1 }).lean();
  if (!payGroup) return { error: 'No pay group exists. Create one in Payroll > Pay Groups first.' };

  const structure = await SalaryStructure.findOne({ deletedAt: null, payGroupId: payGroup._id })
    .sort({ isDefault: -1, createdAt: 1 })
    .lean();
  if (!structure) {
    return { error: `Pay group "${payGroup.name}" has no salary structure. Create one in Payroll > Structures first.` };
  }

  const components = await SalaryComponent.countDocuments({ deletedAt: null });
  return { payGroup, structure, components };
}

/**
 * Work out what would happen to every employee, without writing anything.
 *
 * @returns {{plan: Array, blocked: Array, defaults: object}}
 */
export async function planRun({ onlyMissing, effectiveFrom }) {
  const defaults = await resolveDefaults();
  if (defaults.error) return { error: defaults.error };

  const employees = await Employee.find({ deletedAt: null, status: { $ne: 'exited' } })
    .select('_id employeeCode firstName lastName dateOfJoining')
    .sort({ employeeCode: 1 })
    .lean();

  const current = await EmployeeCompensation.find({ effectiveTo: null })
    .select('employeeId payGroupId structureId effectiveFrom')
    .lean();
  const byEmployee = new Map(current.map((c) => [String(c.employeeId), c]));

  const plan = [];
  const blocked = [];

  for (const emp of employees) {
    const name = `${emp.employeeCode} ${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim();
    const live = byEmployee.get(String(emp._id));

    if (live && onlyMissing) continue;

    if (live && live.effectiveFrom >= effectiveFrom) {
      // The effective-dating rule, reported rather than worked around. See the
      // header: a revision must start after the row it supersedes.
      blocked.push({
        name,
        why: `current salary already starts ${live.effectiveFrom}; a revision must start after it`,
      });
      continue;
    }

    plan.push({
      employeeId: String(emp._id),
      name,
      action: live ? 'revise' : 'create',
      payGroupId: String(live?.payGroupId ?? defaults.payGroup._id),
      structureId: String(live?.structureId ?? defaults.structure._id),
      reusing: Boolean(live),
    });
  }

  return { plan, blocked, defaults, total: employees.length };
}

async function main({
  argv = process.argv.slice(2),
  connect = connectDatabase,
  disconnect = () => mongoose.disconnect(),
} = {}) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(USAGE);
    return { refused: false };
  }
  if (args.unknown) {
    console.error(`Unknown option: ${args.unknown}\n\n${USAGE}`);
    process.exitCode = 1;
    return { refused: true };
  }
  if (!CTC_BASIS[args.ctcBasis]) {
    console.error(`--ctc-basis must be "monthly" or "annual", not "${args.ctcBasis}".`);
    process.exitCode = 1;
    return { refused: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom)) {
    console.error(`--effective-from must be YYYY-MM-DD, not "${args.effectiveFrom}".`);
    process.exitCode = 1;
    return { refused: true };
  }

  const basis = CTC_BASIS[args.ctcBasis];
  const mode = args.execute ? 'EXECUTE' : 'DRY RUN';

  console.log(`\n=== HRMS default salary — ${mode} ===`);
  console.log(`amount:         ${basis.describe}`);
  console.log(`effective from: ${args.effectiveFrom}`);
  console.log(`scope:          ${args.onlyMissing ? 'employees with no salary yet' : 'EVERY active employee, overwriting what they are on'}\n`);

  await connect();
  await bootstrapHrms();

  try {
    const { error, plan, blocked, defaults, total } = await planRun(args);
    if (error) {
      console.error(`REFUSED: ${error}`);
      process.exitCode = 1;
      return { refused: true };
    }

    console.log(`pay group:      ${defaults.payGroup.name}`);
    console.log(`structure:      ${defaults.structure.name} (for employees with no salary yet)\n`);
    console.log(`active employees: ${total}`);
    console.log(`  revise (already on a salary): ${plan.filter((p) => p.action === 'revise').length}`);
    console.log(`  create (no salary yet):       ${plan.filter((p) => p.action === 'create').length}`);
    console.log(`  skipped:                      ${blocked.length}\n`);

    for (const p of plan) console.log(`  ${p.action.padEnd(6)} ${p.name}`);
    if (blocked.length) {
      console.log('\nSKIPPED — nothing was changed for these:');
      for (const b of blocked) console.log(`  ${b.name}: ${b.why}`);
    }

    if (!args.execute) {
      console.log('\nDry run. Nothing was written. Re-run with --execute to apply.');
      return { refused: false, applied: 0, plan, blocked };
    }

    let applied = 0;
    const failures = [];
    for (const p of plan) {
      try {
        await createCompensation(
          {
            employeeId: p.employeeId,
            payGroupId: p.payGroupId,
            structureId: p.structureId,
            ctc: basis.annual,
            effectiveFrom: args.effectiveFrom,
            revisionReason: 'Default salary applied for all employees.',
          },
          // No acting user: this is an operator script, and the audit entry
          // records the change itself rather than attributing it to a person
          // who did not press anything.
          { user: null, req: null },
        );
        applied += 1;
      } catch (err) {
        failures.push(`${p.name}: ${err.message}`);
      }
    }

    console.log(`\nApplied to ${applied} employee(s).`);
    if (failures.length) {
      console.log(`${failures.length} failed:`);
      for (const f of failures) console.log(`  ${f}`);
      process.exitCode = 1;
    }
    return { refused: false, applied, failures };
  } finally {
    await disconnect();
  }
}

const isDirect = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirect) {
  main().catch(async (error) => {
    console.error('\nFAILED:', error.message);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exitCode = 1;
  });
}

export { main };
