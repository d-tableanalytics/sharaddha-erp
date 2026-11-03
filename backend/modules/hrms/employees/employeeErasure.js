/**
 * Permanently deleting an employee.
 *
 * `deactivateEmployee` in employee.service.js is the soft delete: the record
 * stays, marked exited, and everything that points at it keeps pointing at
 * something. This is the other one. It ERASES the employee record, their login
 * and every HRMS record that is about them, and nothing here can be undone —
 * which is why the caller must type the employee code back, and why the audit
 * entry is the one trace left of who they were.
 *
 * ---------------------------------------------------------------------------
 * WHAT GOES AND WHAT STAYS
 * ---------------------------------------------------------------------------
 *
 * The line is "about them" against "theirs on somebody else's file":
 *
 *   GOES   everything that exists because this person was employed — their
 *          attendance, leave, pay, documents, exit, claims, tickets, training,
 *          goals, the reviews and feedback ABOUT them, their survey answers and
 *          their inbox. Listed once, in ERASED below.
 *   STAYS  what they did on another person's record — a leave they approved, a
 *          review they wrote, feedback or a recognition they gave, an interview
 *          panel they sat on, a document they uploaded for the company. Those
 *          belong to the other person, or to the company, and deleting them
 *          would rewrite somebody else's history. The id stays on them and
 *          simply stops resolving to a name.
 *
 * ERP records follow the same rule at a larger scale: checklists, delegations
 * and O2D orders they handled stay, with no owner. Work Queue already treats a
 * login that no longer exists as away (workqueue/availability.service.js), so a
 * buddy task passes to the next person in its chain rather than to nobody.
 *
 * Payroll RUNS stay as they were. A run's totals are what the company actually
 * paid that month — the bank file and the PF/ESI returns were built from them —
 * so removing this person's payslip does not remove their pay from the total.
 *
 * ---------------------------------------------------------------------------
 * WHAT STILL REFUSES
 * ---------------------------------------------------------------------------
 *
 *   - yourself: the request would delete the login that is making it;
 *   - someone with direct reports: the rule deactivating has, for the same
 *     reason — their reports' manager chains would point at nothing;
 *   - the last active Super Admin: nobody would be left to administer HRMS.
 *
 * Assets still issued to them do NOT refuse. An asset keeps the holder's name
 * on its own history and IT can mark it returned afterwards (returnItem needs
 * no employee record), so refusing would only move that clean-up earlier. The
 * preview names them, so it is not forgotten.
 *
 * ---------------------------------------------------------------------------
 * ORDER, AND WHY THERE IS NO HALF-DELETED EMPLOYEE
 * ---------------------------------------------------------------------------
 *
 * One transaction where the deployment has them. Where it does not (a
 * standalone mongod) the records go first and the employee and the login LAST,
 * so a failure part-way leaves the employee in the directory with fewer records
 * rather than records belonging to nobody — and running the delete again
 * finishes the job, because every step is "delete whatever still matches".
 *
 * STORED FILES — selfies, documents, payslip PDFs, receipts, letters,
 * certificates — are read before anything is deleted and removed after the
 * database commits, off the request path: the storage driver deletes one object
 * per call, and a long-serving employee's selfies alone can run to hundreds. A
 * file that will not delete is logged, never fatal; the records pointing at it
 * are already gone.
 */

import mongoose from 'mongoose';

import Employee from '../../../models/hrms/Employee.js';
import User from '../../../models/User.js';
import ArchivedUser from '../../../models/ArchivedUser.js';
import AttendanceRecord from '../../../models/hrms/AttendanceRecord.js';
import AttendanceCorrection from '../../../models/hrms/AttendanceCorrection.js';
import AttendanceConsent from '../../../models/hrms/AttendanceConsent.js';
import { LeaveRequest } from '../../../models/hrms/LeaveRequest.js';
import { LeaveBalance } from '../../../models/hrms/LeaveBalance.js';
import {
  EmployeeCompensation,
  Payslip,
  PayrollAdjustment,
} from '../../../models/hrms/PayrollModels.js';
import { HrmsDocument, DocumentAcknowledgment } from '../../../models/hrms/DocumentModels.js';
import { ExitRequest } from '../../../models/hrms/ExitRequest.js';
import { ExpenseClaim } from '../../../models/hrms/ExpenseClaim.js';
import { HelpdeskTicket } from '../../../models/hrms/HelpdeskModels.js';
import { LearningAssignment, AcademyCertificate } from '../../../models/hrms/AcademyModels.js';
import { AssetItem, AssetRequest } from '../../../models/hrms/AssetModels.js';
import { OnboardingChecklist, OfferLetter } from '../../../models/hrms/OnboardingModels.js';
import {
  Goal,
  ReviewResponse,
  Feedback,
  OneOnOne,
} from '../../../models/hrms/PerformanceModels.js';
import { Recognition, PollResponse, ENpsResponse } from '../../../models/hrms/EngageModels.js';
import { InboxItem } from '../../../models/hrms/InboxItem.js';
import { HrmsUserRole } from '../../../models/hrms/RoleModels.js';
import { WorkQueueSeen } from '../../../models/WorkQueueSeen.js';
import { O2dNotification } from '../../../models/o2d/O2dNotification.js';
import { deleteObjects } from '../../../utils/hrms/storage/index.js';
import { effectiveHrmsRoleKeys } from '../../../utils/hrmsAccessBridge.js';
import { hasHrmsPermission } from '../../../shared/permissions/has-permission.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
  HRMS_ROLES as R,
} from '../../../shared/permissions/constants.js';
import {
  HrmsNotFoundError,
  HrmsConflictError,
  HrmsForbiddenError,
  HrmsValidationError,
} from '../hrms.errors.js';
import { withTransaction } from './employee.service.js';

const idStr = (v) => (v === null || v === undefined ? null : String(v));
const nameOf = (e) => `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim();
const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * Every record that is ABOUT one employee, and the field that says so.
 *
 * The preview counts with exactly these filters and the erase deletes with
 * them, so the dialog cannot promise anything that does not then happen.
 * Ordered as the dialog lists them.
 */
const ERASED = Object.freeze([
  { key: 'attendance', label: 'Attendance days', model: AttendanceRecord, by: 'employeeId' },
  { key: 'attendanceCorrections', label: 'Attendance corrections', model: AttendanceCorrection, by: 'employeeId' },
  { key: 'attendanceConsents', label: 'Attendance consents', model: AttendanceConsent, by: 'employeeId' },
  { key: 'leaveRequests', label: 'Leave requests', model: LeaveRequest, by: 'employeeId' },
  { key: 'leaveBalances', label: 'Leave balances', model: LeaveBalance, by: 'employeeId' },
  { key: 'payslips', label: 'Payslips', model: Payslip, by: 'employeeId' },
  { key: 'payrollAdjustments', label: 'Payroll adjustments', model: PayrollAdjustment, by: 'employeeId' },
  { key: 'compensation', label: 'Salary records', model: EmployeeCompensation, by: 'employeeId' },
  { key: 'documents', label: 'Documents', model: HrmsDocument, by: 'employeeId' },
  { key: 'acknowledgments', label: 'Document acknowledgements', model: DocumentAcknowledgment, by: 'employeeId' },
  { key: 'exitRequests', label: 'Exit requests', model: ExitRequest, by: 'employeeId' },
  { key: 'expenseClaims', label: 'Expense claims', model: ExpenseClaim, by: 'employeeId' },
  { key: 'helpdeskTickets', label: 'Helpdesk tickets raised', model: HelpdeskTicket, by: 'requesterEmployeeId' },
  { key: 'assetRequests', label: 'Asset requests', model: AssetRequest, by: 'employeeId' },
  { key: 'onboarding', label: 'Onboarding checklists', model: OnboardingChecklist, by: 'employeeId' },
  { key: 'offerLetters', label: 'Offer letters', model: OfferLetter, by: 'employeeId' },
  { key: 'training', label: 'Training assignments', model: LearningAssignment, by: 'employeeId' },
  { key: 'certificates', label: 'Training certificates', model: AcademyCertificate, by: 'employeeId' },
  { key: 'goals', label: 'Goals', model: Goal, by: 'employeeId' },
  { key: 'reviews', label: 'Performance reviews', model: ReviewResponse, by: 'employeeId' },
  { key: 'feedback', label: 'Feedback received', model: Feedback, by: 'toEmployeeId' },
  { key: 'oneOnOnes', label: 'One-on-ones', model: OneOnOne, by: 'reportEmployeeId' },
  { key: 'recognitions', label: 'Recognitions received', model: Recognition, by: 'toEmployeeId' },
  { key: 'pollResponses', label: 'Poll answers', model: PollResponse, by: 'respondentEmployeeId' },
  { key: 'enpsResponses', label: 'eNPS answers', model: ENpsResponse, by: 'respondentEmployeeId' },
  { key: 'inbox', label: 'Inbox items', model: InboxItem, by: 'recipientEmployeeId' },
]);

/**
 * The login's own rows, which mean nothing once it is gone: its HRMS role
 * assignments, its Work Queue read markers and its O2D notifications. Deleted
 * with the login and not itemised — the preview already says the login goes.
 */
const LOGIN_ROWS = Object.freeze([
  { model: HrmsUserRole, by: 'userId' },
  { model: WorkQueueSeen, by: 'user' },
  { model: O2dNotification, by: 'user' },
]);

function assertMayErase(actor) {
  if (!hasHrmsPermission(actor, M.EMPLOYEES, A.DELETE, S.ORG)) {
    throw new HrmsForbiddenError('Cannot delete employees.');
  }
}

/**
 * The employee, deactivated or not. A deactivated record is exactly the one
 * somebody may later want gone for good, and its code and login stay taken
 * until it is.
 */
async function loadTarget(id) {
  if (!mongoose.isValidObjectId(id)) throw new HrmsNotFoundError('Employee');
  const employee = await Employee.findById(id)
    .select('employeeCode firstName lastName userId')
    .lean();
  if (!employee) throw new HrmsNotFoundError('Employee');
  return employee;
}

/**
 * The login, wherever it lives. A login suspended from the Users screen is
 * moved to `archivedusers` (see models/ArchivedUser.js), and is just as much
 * this person's.
 */
async function loginOf(userId) {
  if (!userId) return null;
  return (
    (await User.findById(userId).select('email').lean())
    ?? (await ArchivedUser.findById(userId).select('email').lean())
  );
}

/**
 * Would deleting this login leave no active account able to administer HRMS?
 *
 * "Super Admin" is the HRMS key, which the portal's own Super Admin and Admin
 * roles imply (utils/hrmsAccessBridge.js) as well as an explicit grant. That
 * comes from each account's role, which no query can see, so the accounts are
 * scanned — stopping at the first other administrator.
 */
async function isLastSuperAdmin(userId) {
  if (!userId) return false;
  const login = await User.findById(userId).select('role roles extraGrants status').lean();
  if (!login || login.status !== 'Active' || !effectiveHrmsRoleKeys(login).includes(R.SUPER_ADMIN)) {
    return false;
  }

  const others = User.find({ _id: { $ne: userId }, status: 'Active' })
    .select('role roles extraGrants')
    .lean()
    .cursor();
  for await (const other of others) {
    if (effectiveHrmsRoleKeys(other).includes(R.SUPER_ADMIN)) return false;
  }
  return true;
}

/**
 * What refuses the delete outright. The preview reports these so the dialog
 * can say so before anybody types a code; the erase checks them again, and that
 * is the check that counts.
 */
async function blockersFor(employee, actor) {
  const blockers = [];

  const isSelf =
    idStr(employee._id) === idStr(actor.employeeId)
    || (employee.userId && idStr(employee.userId) === idStr(actor.userId));
  if (isSelf) {
    blockers.push({ code: 'CANNOT_ERASE_SELF', message: 'You cannot delete your own employee record.' });
  }

  const reports = await Employee.countDocuments({ reportingManagerId: employee._id, deletedAt: null });
  if (reports > 0) {
    blockers.push({
      code: 'HAS_DIRECT_REPORTS',
      message: `This employee has ${reports} direct ${plural(reports, 'report', 'reports')}. Reassign them first.`,
    });
  }

  if (await isLastSuperAdmin(employee.userId)) {
    blockers.push({
      code: 'LAST_SUPER_ADMIN',
      message: 'This is the only active Super Admin login. Give another login Super Admin access first.',
    });
  }

  return blockers;
}

/**
 * What the delete leaves for somebody else to pick up. Reported, never refused
 * on — see the note on assets at the top.
 */
async function warningsFor(employee) {
  const waitingOnThem = {
    $elemMatch: { approverEmployeeId: employee._id, decision: 'pending' },
  };
  const [assets, leaveApprovals, claimApprovals] = await Promise.all([
    AssetItem.countDocuments({ assignedToEmployeeId: employee._id, deletedAt: null }),
    LeaveRequest.countDocuments({
      status: 'pending',
      employeeId: { $ne: employee._id },
      approvalChain: waitingOnThem,
    }),
    ExpenseClaim.countDocuments({
      status: { $in: ['submitted', 'manager_approved'] },
      employeeId: { $ne: employee._id },
      approvalChain: waitingOnThem,
    }),
  ]);

  const warnings = [];
  if (assets > 0) {
    warnings.push({
      code: 'HOLDS_ASSETS',
      count: assets,
      message: `${assets} ${plural(assets, 'asset is', 'assets are')} still issued to them. Mark ${plural(assets, 'it', 'them')} returned in Assets.`,
    });
  }
  if (leaveApprovals > 0) {
    warnings.push({
      code: 'PENDING_LEAVE_APPROVALS',
      count: leaveApprovals,
      message: `${leaveApprovals} leave ${plural(leaveApprovals, 'request is', 'requests are')} waiting for their approval. HR will need to decide ${plural(leaveApprovals, 'it', 'them')}.`,
    });
  }
  if (claimApprovals > 0) {
    warnings.push({
      code: 'PENDING_CLAIM_APPROVALS',
      count: claimApprovals,
      message: `${claimApprovals} expense ${plural(claimApprovals, 'claim is', 'claims are')} waiting for their approval. HR will need to decide ${plural(claimApprovals, 'it', 'them')}.`,
    });
  }
  return warnings;
}

/**
 * The stored files those records point at.
 *
 * Read BEFORE the delete: afterwards nothing is left that says which files were
 * this person's.
 */
async function storedFilesOf(employeeId) {
  const [attendance, documents, acknowledgments, exits, claims, offers, payslips, certificates] =
    await Promise.all([
      AttendanceRecord.find({ employeeId }).select('clockInCapture.selfieKey clockOutCapture.selfieKey').lean(),
      HrmsDocument.find({ employeeId }).select('storageKey').lean(),
      DocumentAcknowledgment.find({ employeeId }).select('signatureKey').lean(),
      ExitRequest.find({ employeeId }).select('relievingLetter.storageKey').lean(),
      ExpenseClaim.find({ employeeId }).select('lineItems.receiptKey').lean(),
      OfferLetter.find({ employeeId }).select('documentKey').lean(),
      Payslip.find({ employeeId }).select('pdfKey').lean(),
      AcademyCertificate.find({ employeeId }).select('storageKey').lean(),
    ]);

  const keys = [
    ...attendance.flatMap((r) => [r.clockInCapture?.selfieKey, r.clockOutCapture?.selfieKey]),
    ...documents.map((d) => d.storageKey),
    ...acknowledgments.map((a) => a.signatureKey),
    ...exits.map((x) => x.relievingLetter?.storageKey),
    ...claims.flatMap((c) => (c.lineItems ?? []).map((l) => l.receiptKey)),
    ...offers.map((o) => o.documentKey),
    ...payslips.map((p) => p.pdfKey),
    ...certificates.map((c) => c.storageKey),
  ];
  return [...new Set(keys.filter(Boolean))];
}

/** Off the request path, and never throwing — see STORED FILES at the top. */
function removeStoredFiles(keys, employeeCode) {
  if (!keys.length) return;
  deleteObjects(keys)
    .then(({ failed }) => {
      if (failed.length) {
        console.error(
          `[hrms] ${failed.length} stored file(s) of erased employee ${employeeCode} could not be deleted:`,
          failed.map((f) => f.key).join(', '),
        );
      }
    })
    .catch((err) => {
      console.error(`[hrms] stored files of erased employee ${employeeCode} were not deleted:`, err.message);
    });
}

/**
 * What a permanent delete would remove, and anything that would stop it.
 *
 * @returns {Promise<{id, employeeCode, displayName, login: {email}|null,
 *   records: {key, label, count}[], warnings: object[], blockers: object[]}>}
 *   `records` lists only what this employee actually has.
 */
export async function previewErasure(id, actor) {
  assertMayErase(actor);
  const employee = await loadTarget(id);

  const [login, counts, blockers, warnings] = await Promise.all([
    loginOf(employee.userId),
    Promise.all(
      ERASED.map(async ({ key, label, model, by }) => ({
        key,
        label,
        count: await model.countDocuments({ [by]: employee._id }),
      })),
    ),
    blockersFor(employee, actor),
    warningsFor(employee),
  ]);

  return {
    id: idStr(employee._id),
    employeeCode: employee.employeeCode,
    displayName: nameOf(employee),
    login: login ? { email: login.email } : null,
    records: counts.filter((r) => r.count > 0),
    warnings,
    blockers,
  };
}

/**
 * Erase the employee, their login and every record about them.
 *
 * @param {object} [options]
 * @param {string} [options.confirmEmployeeCode]  the code, typed back. Compared
 *        ignoring case and surrounding space — the point is that it was typed,
 *        not that the shift key was held.
 * @returns {Promise<{id, employeeCode, displayName, email, erased: object, files: number}>}
 *          `erased` is the deleted count per record kind; `files` is how many
 *          stored files were queued for deletion.
 */
export async function eraseEmployee(id, actor, { confirmEmployeeCode } = {}) {
  assertMayErase(actor);
  const employee = await loadTarget(id);

  const typed = String(confirmEmployeeCode ?? '').trim().toUpperCase();
  if (typed !== String(employee.employeeCode).trim().toUpperCase()) {
    throw new HrmsValidationError(`Type the employee code ${employee.employeeCode} to confirm.`);
  }

  const [blocker] = await blockersFor(employee, actor);
  if (blocker) throw new HrmsConflictError(blocker.message, { code: blocker.code });

  const [login, files] = await Promise.all([loginOf(employee.userId), storedFilesOf(employee._id)]);

  // Sequential, not Promise.all: operations sharing one transaction's session
  // must not run concurrently.
  const erased = await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    const counts = {};
    for (const { key, model, by } of ERASED) {
      const result = await model.deleteMany({ [by]: employee._id }, opts);
      counts[key] = result.deletedCount ?? 0;
    }
    if (employee.userId) {
      for (const { model, by } of LOGIN_ROWS) {
        await model.deleteMany({ [by]: employee.userId }, opts);
      }
    }

    // Last — see ORDER at the top.
    await Employee.deleteOne({ _id: employee._id }, opts);
    if (employee.userId) {
      await User.deleteOne({ _id: employee.userId }, opts);
      await ArchivedUser.deleteOne({ _id: employee.userId }, opts);
    }
    return counts;
  });

  removeStoredFiles(files, employee.employeeCode);

  return {
    id: idStr(employee._id),
    employeeCode: employee.employeeCode,
    displayName: nameOf(employee),
    email: login?.email ?? null,
    erased,
    files: files.length,
  };
}

export default { previewErasure, eraseEmployee };
