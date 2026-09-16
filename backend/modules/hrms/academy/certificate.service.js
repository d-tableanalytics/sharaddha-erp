/**
 * Certificates.
 *
 * ---------------------------------------------------------------------------
 * 🔴 A CERTIFICATE IS ISSUED, NOT REQUESTED
 * ---------------------------------------------------------------------------
 * There is no endpoint whose meaning is "give me a certificate". `issue()` is
 * called by the server when an assignment completes, and it RE-VERIFIES the
 * completion from the assignment record before writing anything - it does not
 * trust the caller's claim that the path is done, even though the only caller
 * is this codebase.
 *
 * That second check is not paranoia about the current call sites; it is what
 * makes the guarantee survive the next one. Section 26 asks that employees
 * cannot generate fake certificates, and the only durable way to promise that
 * is for the issuing function itself to be unable to produce one for an
 * incomplete path.
 *
 * The certificate NUMBER is 128 random bits rather than a sequence, for the
 * reason `AcademyModels.js` records: a sequence leaks how many were issued, and
 * by subtraction how many people did not pass.
 */

import crypto from 'node:crypto';

import {
  AcademyCertificate,
  LearningAssignment,
} from '../../../models/hrms/AcademyModels.js';
import Employee from '../../../models/hrms/Employee.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { notify } from '../inbox/notifier.service.js';
import { INBOX_TYPES } from '../../../shared/constants/inbox.js';
import { AUDIT_ACTIONS, STORAGE_CATEGORIES } from '../../../shared/constants/hrms.js';
import { CERTIFICATE_ID_BYTES } from '../../../shared/constants/academy.js';
import { paginationQuery } from '../../../shared/validation/common.js';
import { putObject } from '../../../utils/hrms/storage/index.js';
import { percentOf, toDay, addDays } from '../../../shared/academy/progress.js';
import { HrmsNotFoundError, HrmsConflictError } from '../hrms.errors.js';
import { hasHrmsPermission } from '../../../shared/permissions/has-permission.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from '../../../shared/permissions/constants.js';
import { renderCertificate } from './certificateDocument.js';
import {
  idStr,
  oid,
  iso,
  parse,
  canViewOrg,
  canViewTeam,
  assertCanManage,
  page,
  skipOf,
} from './academy.shared.js';

/**
 * A human-transcribable certificate number.
 *
 * Base32 without the characters people confuse when reading one off a printed
 * page - no 0/O, no 1/I/L - and grouped, because somebody will type this into a
 * verification box from a piece of paper.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function mintCertificateNo() {
  const bytes = crypto.randomBytes(CERTIFICATE_ID_BYTES);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `SIA-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

async function resolveCompanyName() {
  try {
    const { default: CompanyProfile } = await import('../../../models/hrms/CompanyProfile.js');
    const profile = await CompanyProfile.findOne({}).select('legalName displayName').lean();
    return profile?.legalName || profile?.displayName || null;
  } catch {
    return null;
  }
}

export function toCertificateDto(row) {
  return {
    id: idStr(row._id),
    certificateNo: row.certificateNo,
    assignmentId: idStr(row.assignmentId),
    employeeId: idStr(row.employeeId),
    employeeName: row.employeeName,
    employeeCode: row.employeeCode ?? null,
    pathId: idStr(row.pathId),
    pathName: row.pathName,
    issuedAt: iso(row.issuedAt),
    completionDate: row.completionDate,
    validUntil: row.validUntil ?? null,
    /**
     * Computed, never stored - the same decision as `overdue` on an assignment.
     * A stored `expired` flag is wrong from the day after it is written until
     * something touches the row again.
     */
    expired: Boolean(row.validUntil && row.validUntil < toDay(new Date())),
    revoked: Boolean(row.revokedAt),
    revokedAt: iso(row.revokedAt),
    revokeReason: row.revokeReason ?? null,
  };
}

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

/**
 * Issue the certificate for a completed assignment.
 *
 * Returns null - rather than throwing - when the path does not require one or
 * the assignment is not actually complete. The caller is a completion handler
 * that has just done something worth keeping, and a certificate is the last
 * step of it; failing the whole request because a certificate could not be
 * rendered would discard a real completion over a cosmetic artefact.
 *
 * Idempotent: a second call returns the existing certificate. The unique index
 * on `assignmentId` is the guarantee, and re-entry is a genuine case - a
 * reopened-then-recompleted path calls this again.
 */
export async function issue(assignment, context = {}) {
  try {
    if (!assignment?.requiresCertificate) return null;
    if (assignment.status !== 'completed') return null;

    /**
     * RE-VERIFY. The status field is recomputed on every write and should be
     * right - but "should be right" is not the standard for the document that
     * proves somebody completed mandatory compliance training.
     */
    if (percentOf(assignment.lessons ?? []) !== 100) return null;

    const existing = await AcademyCertificate.findOne({
      assignmentId: assignment._id,
    }).lean();
    if (existing) return toCertificateDto(existing);

    const employee = await Employee.findById(assignment.employeeId)
      .select('firstName lastName employeeCode')
      .lean();

    const completionDate = toDay(assignment.completedAt ?? new Date());
    const validUntil = await resolveValidity(assignment, completionDate);

    const certificateNo = mintCertificateNo();
    const companyName = await resolveCompanyName();

    const rendered = renderCertificate({
      employeeName: assignment.employeeName || `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim(),
      employeeCode: employee?.employeeCode ?? null,
      pathName: assignment.pathName,
      completionDate,
      certificateNo,
      validUntil,
      companyName,
    });

    const stored = await putObject({
      category: STORAGE_CATEGORIES.ACADEMY_CERTIFICATE,
      body: Buffer.from(rendered.body, 'utf8'),
      contentType: rendered.contentType,
      scope: idStr(assignment.employeeId),
      filename: rendered.filename,
      size: Buffer.byteLength(rendered.body, 'utf8'),
    });

    let row;
    try {
      row = await AcademyCertificate.create({
        certificateNo,
        assignmentId: assignment._id,
        employeeId: assignment.employeeId,
        employeeName: assignment.employeeName,
        employeeCode: employee?.employeeCode ?? null,
        pathId: assignment.pathId,
        pathName: assignment.pathName,
        issuedAt: new Date(),
        completionDate,
        validUntil,
        storageKey: stored.key,
        storageCategory: stored.category,
      });
    } catch (error) {
      // Two completion handlers raced. The index held; return the winner's.
      if (error?.code === 11000) {
        const winner = await AcademyCertificate.findOne({
          assignmentId: assignment._id,
        }).lean();
        return winner ? toCertificateDto(winner) : null;
      }
      throw error;
    }

    await LearningAssignment.updateOne(
      { _id: assignment._id },
      { $set: { certificateId: row._id } },
    );

    await notify({
      to: idStr(assignment.employeeId),
      type: INBOX_TYPES.ACADEMY_CERTIFICATE_ISSUED,
      title: `Your certificate for ${assignment.pathName} is ready`,
      body: null,
      entity: 'academy_certificate',
      entityId: idStr(row._id),
    });

    await recordAudit(
      context.actorUserId ? { _id: context.actorUserId } : null,
      AUDIT_ACTIONS.ACADEMY_CERTIFICATE_ISSUED,
      `Issued certificate ${certificateNo} to ${assignment.employeeName} for "${assignment.pathName}"`,
      context.req,
      {
        meta: {
          certificateId: idStr(row._id),
          certificateNo,
          employeeId: idStr(assignment.employeeId),
          pathId: idStr(assignment.pathId),
          completionDate,
          validUntil,
        },
      },
    );

    return toCertificateDto(row.toObject());
  } catch (error) {
    /**
     * Swallowed, deliberately, and logged loudly.
     *
     * The completion is already recorded and already audited. A certificate
     * that could not be rendered is re-issuable from the Certificates screen;
     * a completion rolled back because a bucket was briefly unreachable is
     * work a person has to do again.
     */
    console.error('[hrms:academy] certificate issue failed:', error?.message ?? error);
    return null;
  }
}

/** Validity window, from the path's configuration at issue time. */
async function resolveValidity(assignment, completionDate) {
  try {
    const { LearningPath } = await import('../../../models/hrms/AcademyModels.js');
    const path = await LearningPath.findById(assignment.pathId)
      .select('certificateValidityMonths')
      .lean();
    if (!path?.certificateValidityMonths) return null;

    // Calendar months, so a 12-month certificate issued on 29 February expires
    // on 28 February - `addDays(365)` would drift a day every leap year.
    const [y, m, d] = completionDate.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + path.certificateValidityMonths, d));
    // Overflow (31 Jan + 1 month) lands in the next month; pull it back to the
    // last day of the intended one.
    if (target.getUTCDate() !== d) target.setUTCDate(0);
    return target.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List certificates.
 *
 * Scoped exactly like assignments: an employee sees their own, a manager their
 * reports', HR everybody's. A certificate is a statement about a person, so the
 * visibility rule is the same one that governs their progress.
 */
export async function listCertificates(actor, query) {
  const q = parse(paginationQuery, query, 'certificate query');

  const filter = {};
  if (!canViewOrg(actor)) {
    if (canViewTeam(actor) && actor?.employeeId) {
      const reports = await Employee.find({
        managerChain: oid(actor.employeeId),
        deletedAt: null,
      })
        .select('_id')
        .lean();
      filter.employeeId = { $in: [oid(actor.employeeId), ...reports.map((r) => r._id)] };
    } else if (actor?.employeeId) {
      filter.employeeId = oid(actor.employeeId);
    } else {
      // An HR administrator with no employee record of their own, holding only
      // the self baseline. Nothing to show, and nothing to leak.
      return page([], 0, q);
    }
  }

  const [rows, total] = await Promise.all([
    AcademyCertificate.find(filter)
      .sort({ issuedAt: -1 })
      .skip(skipOf(q))
      .limit(q.pageSize)
      .lean(),
    AcademyCertificate.countDocuments(filter),
  ]);

  return page(rows.map(toCertificateDto), total, q);
}

/** The caller's own certificates. The employee id comes from the session. */
export async function myCertificates(actor) {
  if (!actor?.employeeId) return [];
  const rows = await AcademyCertificate.find({ employeeId: oid(actor.employeeId) })
    .sort({ issuedAt: -1 })
    .lean();
  return rows.map(toCertificateDto);
}

/** Resolve a certificate to its storage key, once the caller is authorised. */
export async function certificateStorageKey(id, actor) {
  const row = await AcademyCertificate.findById(id).lean();
  if (!row) throw new HrmsNotFoundError('Certificate');

  const subject = await Employee.findById(row.employeeId).select('managerChain').lean();
  const resource = {
    ownerEmployeeId: idStr(row.employeeId),
    ownerManagerChain: (subject?.managerChain ?? []).map(idStr),
  };

  const allowed =
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.ORG) ||
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.TEAM, resource) ||
    hasHrmsPermission(actor, M.ACADEMY, A.VIEW, S.SELF, resource);

  if (!allowed) throw new HrmsNotFoundError('Certificate');

  if (row.revokedAt) {
    throw new HrmsConflictError('This certificate has been revoked.', {
      code: 'CERTIFICATE_REVOKED',
    });
  }
  if (!row.storageKey) {
    throw new HrmsConflictError(
      'This certificate has no document. Ask HR to re-issue it.',
      { code: 'CERTIFICATE_NOT_RENDERED' },
    );
  }

  return {
    key: row.storageKey,
    category: row.storageCategory,
    name: `${row.pathName} — ${row.certificateNo}`,
  };
}

/**
 * Who may read a certificate object.
 *
 * Registered in `hrms.bootstrap.js`. Unlike learning content, a certificate DOES
 * have an owner, so this resolves one and the normal self/team/org scope rules
 * decide - a certificate is a statement about a named person, not company
 * material.
 */
export async function resolveCertificateAccess(key) {
  const row = await AcademyCertificate.findOne({ storageKey: key })
    .select('employeeId revokedAt')
    .lean()
    .catch(() => null);

  if (!row || row.revokedAt) return null;

  const employee = await Employee.findById(row.employeeId)
    .select('managerChain departmentId userId')
    .lean()
    .catch(() => null);

  return {
    owner: {
      ownerUserId: idStr(employee?.userId),
      ownerEmployeeId: idStr(row.employeeId),
      ownerDepartmentId: idStr(employee?.departmentId) ?? undefined,
      ownerManagerChain: (employee?.managerChain ?? []).map(idStr),
    },
    permissions: [
      { module: M.ACADEMY, action: A.VIEW, scope: S.SELF },
      { module: M.ACADEMY, action: A.VIEW, scope: S.TEAM },
      { module: M.ACADEMY, action: A.VIEW, scope: S.ORG },
    ],
  };
}

// ---------------------------------------------------------------------------
// Revoking
// ---------------------------------------------------------------------------

/**
 * Revoke a certificate.
 *
 * The row stays. A revoked certificate is a fact worth keeping - "this was
 * issued and then withdrawn on this date for this reason" is precisely what an
 * audit needs, and deleting it would leave a certificate number in circulation
 * that resolves to nothing.
 */
export async function revokeCertificate(id, reason, actor, context = {}) {
  assertCanManage(actor, 'certificates');

  const row = await AcademyCertificate.findById(id);
  if (!row) throw new HrmsNotFoundError('Certificate');
  if (row.revokedAt) {
    throw new HrmsConflictError('That certificate is already revoked.', {
      code: 'ALREADY_REVOKED',
    });
  }

  row.revokedAt = new Date();
  row.revokeReason = reason ?? null;
  await row.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_CERTIFICATE_REVOKED,
    `Revoked certificate ${row.certificateNo} (${row.employeeName})`,
    context.req,
    {
      meta: {
        certificateId: idStr(row._id),
        certificateNo: row.certificateNo,
        employeeId: idStr(row.employeeId),
        reason: reason ?? null,
      },
    },
  );

  return toCertificateDto(row.toObject());
}

/**
 * Issue a certificate for an assignment that completed but has none.
 *
 * The repair path for the swallowed failure in `issue()`. Needs the management
 * grant, re-verifies completion exactly as the automatic path does, and cannot
 * manufacture a certificate for incomplete work.
 */
export async function reissueForAssignment(assignmentId, actor, context = {}) {
  assertCanManage(actor, 'certificates');

  const assignment = await LearningAssignment.findById(assignmentId);
  if (!assignment) throw new HrmsNotFoundError('Learning assignment');

  if (!assignment.requiresCertificate) {
    throw new HrmsConflictError(
      `"${assignment.pathName}" does not issue certificates.`,
      { code: 'CERTIFICATE_NOT_REQUIRED' },
    );
  }
  if (assignment.status !== 'completed' || percentOf(assignment.lessons ?? []) !== 100) {
    throw new HrmsConflictError(
      `${assignment.employeeName} has not completed "${assignment.pathName}".`,
      { code: 'ASSIGNMENT_NOT_COMPLETE' },
    );
  }

  const result = await issue(assignment, { ...context, actorUserId: actor.userId });
  if (!result) {
    throw new HrmsConflictError(
      'The certificate could not be generated. Check the server log and try again.',
      { code: 'CERTIFICATE_RENDER_FAILED' },
    );
  }
  return result;
}

export default {
  issue,
  toCertificateDto,
  listCertificates,
  myCertificates,
  certificateStorageKey,
  resolveCertificateAccess,
  revokeCertificate,
  reissueForAssignment,
};
