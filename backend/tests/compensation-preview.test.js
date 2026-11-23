/**
 * The Salary section's preview.
 *
 * ---------------------------------------------------------------------------
 * THE TEST THAT MATTERS IS THE FIRST ONE
 * ---------------------------------------------------------------------------
 * A preview exists so an administrator can approve a salary on a figure. If
 * that figure is not what payday produces, the preview is worse than useless —
 * it is a confident lie. So the central assertion here is not "the preview
 * returns a number" or "the number looks about right": it is that the preview
 * and a REAL COMPUTED PAYROLL RUN agree, line for line, for the same employee
 * on the same compensation.
 *
 * That is the property the feature was asked for — "all salary calculations
 * should work automatically, following the same calculation logic" — and it is
 * the one that would break if anybody ever reimplemented the arithmetic behind
 * the preview.
 *
 * The rest of the file covers the inputs the structure-level preview ignores
 * and this one must not (PF exclusion, overrides, state resolution), and the
 * Super-Admin fence.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';

import Employee from '../models/hrms/Employee.js';
import User from '../models/User.js';
import CompanyProfile from '../models/hrms/CompanyProfile.js';
import LeaveType from '../models/hrms/LeaveType.js';
import LeaveRequest from '../models/hrms/LeaveRequest.js';
import Holiday from '../models/hrms/Holiday.js';
import {
  PayGroup,
  SalaryComponent,
  SalaryStructure,
  EmployeeCompensation,
  StatutoryConfig,
  PayrollRun,
  Payslip,
  PayrollAdjustment,
} from '../models/hrms/PayrollModels.js';

import payrollRoutes from '../modules/hrms/payroll/payroll.routes.js';
import { hrmsAuthorizationChain, setEmployeeResolver } from '../middlewares/hrmsAuth.js';
import { hrmsErrorHandler } from '../modules/hrms/hrms.errors.js';
import {
  registerReferenceProvider,
  __resetReferenceProviders,
} from '../modules/hrms/references/reference.service.js';
import { employeeReferenceProvider } from '../modules/hrms/employees/employee.provider.js';
import { HRMS_ROLES as R } from '../shared/permissions/constants.js';
import { buildTestApp, stubProtect, withServer, get, post } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const P = '/api/v1/hrms/payroll';

before(async () => {
  await startTestMongo();
  await syncIndexes(
    Employee, User, PayGroup, SalaryComponent, SalaryStructure, EmployeeCompensation,
    StatutoryConfig, PayrollRun, Payslip, PayrollAdjustment, LeaveType, LeaveRequest, Holiday,
  );
});

after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  __resetReferenceProviders();
  registerReferenceProvider('employee', employeeReferenceProvider);
  setEmployeeResolver((userId) => employeeReferenceProvider.byUserId(userId));
  await CompanyProfile.create({ key: 'company-profile', defaultStateCode: 'MP' });
});

function appFor(user) {
  return buildTestApp({
    mount: (app) => {
      const router = express.Router();
      router.use(stubProtect(user));
      router.use(hrmsAuthorizationChain);
      router.use('/payroll', payrollRoutes);
      router.use(hrmsErrorHandler);
      app.use('/api/v1/hrms', router);
    },
  });
}

let seq = 0;

/** `portalRole` is what the salary fence actually reads — see payroll-api.test.js. */
async function makeEmployee({ roles = [R.EMPLOYEE], portalRole = null } = {}) {
  seq += 1;
  const role = portalRole ?? (roles.includes(R.SUPER_ADMIN) ? 'Super Admin' : 'Management');
  const user = await User.create({
    email: `prev${seq}@example.com`,
    password: 'x'.repeat(60),
    user: `Person ${seq}`,
    role,
    roles,
    status: 'Active',
  });
  const employee = await Employee.create({
    userId: user._id,
    employeeCode: `PRV${String(seq).padStart(3, '0')}`,
    firstName: 'Person',
    lastName: String(seq),
    dateOfJoining: new Date('2024-01-01'),
    status: 'active',
  });
  return { user: { _id: user._id, role, roles, status: 'Active' }, employee, id: String(employee._id) };
}

const STATUTORY_PAYLOAD = {
  pf: { employeeRate: 0.12, employerRate: 0.12, wageCeiling: 15000, epsCap: 15000 },
  esi: { employeeRate: 0.0075, employerRate: 0.0325, grossThreshold: 21000 },
  pt: { MP: [{ maxMonthlyWage: 18750, tax: 0 }, { maxMonthlyWage: null, tax: 208 }] },
  lwf: { MP: { periodicity: 'monthly', employee: 10, employer: 30 } },
  tds: {
    regime: 'new',
    old: {
      slabs: [{ min: 0, max: null, rate: 0 }],
      standardDeduction: 50000, chapter6AMax: 150000, hraExemption: true,
    },
    new: { slabs: [{ min: 0, max: null, rate: 0 }], standardDeduction: 75000 },
    cess: 0.04,
  },
};

/** The same setup an admin would build: statutory, group, components, structure. */
async function seedCatalogue(url) {
  assert.equal(
    (await post(url, `${P}/statutory`, { effectiveFrom: '2020-01-01', config: STATUTORY_PAYLOAD })).status,
    201,
  );
  const group = await post(url, `${P}/pay-groups`, {
    code: 'MAIN', name: 'Main Payroll', legalEntityName: 'Shraddha Impex Private Limited', isDefault: true,
  });
  const mk = (body) => post(url, `${P}/components`, body);
  const basic = await mk({
    code: 'BASIC', name: 'Basic', type: 'earning',
    calculationType: 'percent_of', formula: { pct_of_annual: 'CTC', percent: 40 }, order: 1,
  });
  const hra = await mk({
    code: 'HRA', name: 'House Rent Allowance', type: 'earning',
    calculationType: 'percent_of', formula: { of: 'BASIC', percent: 40 }, order: 2,
  });
  const pf = await mk({
    code: 'PF_EE', name: 'Provident Fund', type: 'deduction',
    calculationType: 'statutory', statutoryLink: 'pf', taxable: false, order: 10,
  });
  for (const r of [group, basic, hra, pf]) assert.equal(r.status, 201, JSON.stringify(r.body));

  const structure = await post(url, `${P}/structures`, {
    name: 'Standard',
    payGroupId: group.body.data.id,
    isDefault: true,
    components: [
      { componentId: basic.body.data.id, order: 1 },
      { componentId: hra.body.data.id, order: 2 },
      { componentId: pf.body.data.id, order: 10 },
    ],
  });
  assert.equal(structure.status, 201, JSON.stringify(structure.body));

  return { payGroupId: group.body.data.id, structureId: structure.body.data.id };
}

// ===========================================================================
// The preview agrees with payroll
// ===========================================================================

describe('the preview and the payroll run agree', () => {
  test('line for line, and on gross, deductions and net', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    const alice = await makeEmployee();

    await withServer(appFor(admin.user), async (url) => {
      const { payGroupId, structureId } = await seedCatalogue(url);

      const proposal = { structureId, ctc: '900000', stateCode: 'MP', month: 6, year: 2026 };

      // 1. What the Salary screen shows BEFORE anything is saved.
      const preview = await post(url, `${P}/compensation/preview`, proposal);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));

      // 2. Save that exact compensation and run payroll for the same month.
      const saved = await post(url, `${P}/compensation`, {
        employeeId: alice.id,
        payGroupId,
        structureId,
        ctc: '900000',
        effectiveFrom: '2024-01-01',
        stateCode: 'MP',
      });
      assert.equal(saved.status, 201, JSON.stringify(saved.body));

      const run = await post(url, `${P}/runs`, { payGroupId, month: 6, year: 2026 });
      assert.equal(run.status, 201, JSON.stringify(run.body));
      const computed = await post(url, `${P}/runs/${run.body.data.id}/compute`, {});
      assert.equal(computed.status, 200, JSON.stringify(computed.body));
      assert.equal(computed.body.data.payslipsGenerated, 1);

      const slips = await get(url, `${P}/payslips`, { runId: run.body.data.id });
      assert.equal(slips.status, 200);
      const slip = (slips.body.data.data ?? slips.body.data)[0];
      assert.ok(slip, 'the run produced a payslip');

      // 3. THE ASSERTION. Not "close enough" — identical.
      const p = preview.body.data;
      assert.equal(p.monthlyGross, slip.gross, 'gross');
      assert.equal(p.monthlyDeductions, slip.totalDeductions, 'deductions');
      assert.equal(p.monthlyNet, slip.netPay, 'net pay');
      assert.equal(p.employerContributions, slip.employerContributions, 'employer contributions');

      const previewLines = p.lines.map((l) => [l.componentCode, l.monthly]).sort();
      const slipLines = slip.lines.map((l) => [l.componentCode, l.amount]).sort();
      assert.deepEqual(previewLines, slipLines, 'every component line matches the payslip');
    });
  });
});

// ===========================================================================
// The employee-specific inputs the structure preview ignores
// ===========================================================================

describe('the preview honours the employee-specific inputs', () => {
  test('excluding PF removes the deduction, and raises net by exactly that much', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const base = { structureId, ctc: '900000', stateCode: 'MP', month: 6, year: 2026 };

      const withPf = (await post(url, `${P}/compensation/preview`, base)).body.data;
      const withoutPf = (await post(url, `${P}/compensation/preview`, { ...base, pfExcluded: true })).body.data;

      const pfLine = withPf.lines.find((l) => l.componentCode === 'PF_EE');
      assert.ok(pfLine && pfLine.monthly > 0, 'PF is deducted by default');
      assert.equal(
        withoutPf.lines.find((l) => l.componentCode === 'PF_EE')?.monthly ?? 0,
        0,
        'PF is not deducted when excluded',
      );
      assert.equal(withoutPf.monthlyNet, withPf.monthlyNet + pfLine.monthly, 'net rises by the PF');
      assert.equal(withoutPf.monthlyGross, withPf.monthlyGross, 'gross is unaffected');
    });
  });

  test('a per-component override pins that component', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', stateCode: 'MP', month: 6, year: 2026,
        overrides: { BASIC: 50000 },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const basic = res.body.data.lines.find((l) => l.componentCode === 'BASIC');
      assert.equal(basic.monthly, 50000, 'the override wins over the formula');
      // HRA is 40% OF BASIC, so pinning BASIC moves it too — the dependency is
      // the engine's, and the preview inherits it rather than restating it.
      assert.equal(res.body.data.lines.find((l) => l.componentCode === 'HRA').monthly, 20000);
    });
  });

  test('the annual column is the monthly figure times twelve', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', stateCode: 'MP', month: 6, year: 2026,
      });
      for (const line of res.body.data.lines) {
        assert.equal(line.annual, Math.round(line.monthly * 12 * 100) / 100, line.componentCode);
      }
    });
  });
});

// ===========================================================================
// State resolution — AD-12
// ===========================================================================

describe('state resolution', () => {
  test('an omitted state falls back to the company default, and says so', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', month: 6, year: 2026,
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.stateCode, 'MP');
      assert.equal(res.body.data.stateCodeSource, 'company-default');
    });
  });

  test('an explicit state is reported as the compensation\'s own', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', stateCode: 'MP', month: 6, year: 2026,
      });
      assert.equal(res.body.data.stateCodeSource, 'compensation');
    });
  });

  test('no state anywhere BLOCKS rather than silently deducting zero (AD-12)', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await CompanyProfile.updateOne({ key: 'company-profile' }, { $unset: { defaultStateCode: 1 } });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', month: 6, year: 2026,
      });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /state/i);
    });
  });

  test('no statutory configuration is refused with the reason, not a zero', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      // A structure, but deliberately no statutory config.
      const group = await post(url, `${P}/pay-groups`, {
        code: 'G2', name: 'Group 2', legalEntityName: 'Shraddha Impex Private Limited',
      });
      const basic = await post(url, `${P}/components`, {
        code: 'BASIC', name: 'Basic', type: 'earning',
        calculationType: 'percent_of', formula: { pct_of_annual: 'CTC', percent: 40 }, order: 1,
      });
      const structure = await post(url, `${P}/structures`, {
        name: 'Bare', payGroupId: group.body.data.id,
        components: [{ componentId: basic.body.data.id, order: 1 }],
      });

      const res = await post(url, `${P}/compensation/preview`, {
        structureId: structure.body.data.id, ctc: '900000', stateCode: 'MP', month: 6, year: 2026,
      });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /statutory/i);
    });
  });
});

// ===========================================================================
// The fence
// ===========================================================================

describe('only a portal Super Admin may preview a salary', () => {
  test('an HR admin is refused', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    let structureId;
    await withServer(appFor(admin.user), async (url) => {
      ({ structureId } = await seedCatalogue(url));
    });

    const hr = await makeEmployee({ roles: [R.HR_ADMIN] });
    await withServer(appFor(hr.user), async (url) => {
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', stateCode: 'MP',
      });
      assert.equal(res.status, 403, JSON.stringify(res.body));
    });
  });

  test('an hrms_super_admin on a NON-Super-Admin portal account is refused', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    let structureId;
    await withServer(appFor(admin.user), async (url) => {
      ({ structureId } = await seedCatalogue(url));
    });

    // The fence reads the PORTAL role, not the HRMS one — ticking the HRMS
    // role is exactly the escalation SUPER_ADMIN_ONLY_MODULES exists to stop.
    const fenced = await makeEmployee({ roles: [R.SUPER_ADMIN], portalRole: 'Management' });
    await withServer(appFor(fenced.user), async (url) => {
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', stateCode: 'MP',
      });
      assert.equal(res.status, 403, JSON.stringify(res.body));
    });
  });

  test('an unauthenticated caller is refused', async () => {
    await withServer(appFor(null), async (url) => {
      assert.equal((await post(url, `${P}/compensation/preview`, {})).status, 401);
    });
  });
});

// ===========================================================================
// The route does not collide with /compensation/:employeeId
// ===========================================================================

describe('routing', () => {
  test('"preview" is not read as an employee id', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const res = await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', stateCode: 'MP', month: 6, year: 2026,
      });
      assert.equal(res.status, 200, 'the preview route answered, not the id route');
      assert.ok(res.body.data.lines.length > 0);
    });
  });

  test('the preview writes nothing', async () => {
    const admin = await makeEmployee({ roles: [R.SUPER_ADMIN] });
    await withServer(appFor(admin.user), async (url) => {
      const { structureId } = await seedCatalogue(url);
      const before = await EmployeeCompensation.countDocuments({});
      await post(url, `${P}/compensation/preview`, {
        structureId, ctc: '900000', stateCode: 'MP', month: 6, year: 2026,
      });
      assert.equal(await EmployeeCompensation.countDocuments({}), before, 'no row was created');
    });
  });
});
