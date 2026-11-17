/**
 * HB1: what a TEAM-scoped hiring viewer may reach.
 *
 * `hiring:view:team` (the manager's "interviewer view") used to admit the
 * caller to every hiring read, and no service narrowed by scope - so every
 * manager could read every offer's CTC, every requisition's budget, and every
 * candidate's contact details. hasHrmsPermission cannot narrow a collection
 * read (team + no resource = true), so it is narrowed here, from the
 * ownership fields the hiring models already carry:
 *
 *   owner        JobRequisition.createdByUserId  - the requisition's raiser
 *   interviewer  Interview.panel.employeeId      - sits on a panel
 *
 * Reach:
 *   requisitions / applications / candidates   owned OR interviewing on
 *   interviews                                 on the panel, or on an owned requisition
 *   feedback                                   same as interviews
 *   offers                                     owned requisitions only
 *   budget, candidate email/phone/expected pay owned requisitions only
 *
 * `null` means unrestricted (hiring:view:org).
 */

import mongoose from 'mongoose';

import {
  JobRequisition,
  Application,
  Interview,
} from '../../../models/hrms/HiringModels.js';
import { hasHrmsPermission } from '../../../shared/permissions/has-permission.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from '../../../shared/permissions/constants.js';

const idStr = (v) => (v === null || v === undefined ? null : String(v));
const oids = (set) => [...set].map((v) => new mongoose.Types.ObjectId(v));

export async function hiringReach(actor) {
  if (hasHrmsPermission(actor, M.HIRING, A.VIEW, S.ORG)) return null;

  const employeeId = actor?.employeeId && mongoose.isValidObjectId(actor.employeeId)
    ? actor.employeeId
    : null;
  const userId = actor?.userId && mongoose.isValidObjectId(actor.userId) ? actor.userId : null;

  const [owned, panel] = await Promise.all([
    userId
      ? JobRequisition.find({ createdByUserId: userId, deletedAt: null }).select('_id').lean()
      : [],
    employeeId
      ? Interview.find({ 'panel.employeeId': employeeId }).select('_id applicationId').lean()
      : [],
  ]);

  const ownedRequisitions = new Set(owned.map((r) => idStr(r._id)));
  const apps = await Application.find({
    $or: [
      { requisitionId: { $in: oids(ownedRequisitions) } },
      { _id: { $in: panel.map((i) => i.applicationId) } },
    ],
  })
    .select('_id candidateId requisitionId')
    .lean();

  const reach = {
    ownedRequisitions,
    requisitions: new Set(ownedRequisitions),
    applications: new Set(),
    ownedApplications: new Set(),
    candidates: new Set(),
    ownedCandidates: new Set(),
    panelInterviews: new Set(panel.map((i) => idStr(i._id))),
  };
  for (const a of apps) {
    const id = idStr(a._id);
    reach.applications.add(id);
    reach.requisitions.add(idStr(a.requisitionId));
    reach.candidates.add(idStr(a.candidateId));
    if (ownedRequisitions.has(idStr(a.requisitionId))) {
      reach.ownedApplications.add(id);
      reach.ownedCandidates.add(idStr(a.candidateId));
    }
  }
  return reach;
}

/** Mongo `$in` over one of the reach sets. */
export const inSet = (set) => ({ $in: oids(set) });

/** Is `id` within `set`? Unrestricted reach always is. */
export const within = (reach, key, id) => reach === null || reach[key].has(idStr(id));

/** Budget is the raiser's (and HR's) business, not the panel's. */
export function redactRequisition(dto, reach) {
  if (reach === null || reach.ownedRequisitions.has(dto.id)) return dto;
  return { ...dto, budgetMin: null, budgetMax: null, businessJustification: null };
}

/** Contact details and expected pay stay with whoever owns the requisition. */
export function redactCandidate(dto, reach) {
  if (reach === null || reach.ownedCandidates.has(dto.id)) return dto;
  return { ...dto, email: null, phone: null, expectedSalary: null };
}

export function redactApplication(dto, reach) {
  if (reach === null || reach.ownedApplications.has(dto.id)) return dto;
  return { ...dto, candidateEmail: null };
}

export default { hiringReach, inSet, within, redactRequisition, redactCandidate, redactApplication };
