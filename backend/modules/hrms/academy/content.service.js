/**
 * The Academy content library.
 *
 * One uploaded video, PDF or document per row, REUSABLE across courses: a
 * lesson holds a `contentId`, so the same security-policy PDF appears in the IT
 * induction and in the annual refresher without a second upload and without a
 * second object in the bucket. Section 15 asks for that, and it is also what
 * makes "replace the FY26 policy everywhere" a single edit.
 *
 * The reuse has a cost, and this file is mostly about paying it honestly:
 * deleting a content item can orphan lessons in courses nobody is looking at.
 * So deletion is soft, and `deleteContent` refuses outright while any live
 * lesson still points at the item - which is the only way to keep section 24's
 * "missing content must not break the course" true by construction rather than
 * by handling a null in six screens.
 */

import {
  AcademyContent,
  AcademyCourse,
} from '../../../models/hrms/AcademyModels.js';
import Employee from '../../../models/hrms/Employee.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS, STORAGE_CATEGORIES } from '../../../shared/constants/hrms.js';
import { CONTENT_LESSON_TYPES } from '../../../shared/constants/academy.js';
import {
  uploadContentSchema,
  updateContentSchema,
  contentListQuerySchema,
} from '../../../shared/schemas/academy.js';
import { putObject, deleteObject } from '../../../utils/hrms/storage/index.js';
import {
  HrmsNotFoundError,
  HrmsConflictError,
  HrmsValidationError,
} from '../hrms.errors.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from '../../../shared/permissions/constants.js';
import {
  idStr,
  oid,
  iso,
  parse,
  fullName,
  escapeRegex,
  assertCanManage,
  page,
  skipOf,
} from './academy.shared.js';
import { sniffAcademyContent, assertWithinTypeLimit } from './contentUpload.js';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * The wire shape.
 *
 * `storageKey` is absent, and that is not an oversight: reads go through
 * `issueReadUrl`, which authorises the caller, audits the access and returns a
 * URL that expires. A key in a DTO is a key in a browser's memory, in a log,
 * and eventually in a bug report.
 */
export function toContentDto(row) {
  return {
    id: idStr(row._id),
    title: row.title,
    description: row.description ?? null,
    type: row.type,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    originalFilename: row.originalFilename ?? null,
    durationSeconds: row.durationSeconds ?? null,
    tags: row.tags ?? [],
    active: row.active !== false,
    uploadedByName: row.uploadedByName || null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The library.
 *
 * Readable by anyone who can author the catalogue. A LEARNER never calls this -
 * they reach content through a lesson in a path assigned to them, which is a
 * different authorisation question entirely (see `resolveContentAccess`).
 */
export async function listContent(actor, query) {
  assertCanManage(actor, 'the content library');
  const q = parse(contentListQuerySchema, query, 'content query');

  const filter = { deletedAt: null };
  if (q.type) filter.type = q.type;
  if (q.active !== undefined) filter.active = q.active;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ title: rx }, { description: rx }, { tags: rx }];
  }

  const [rows, total] = await Promise.all([
    AcademyContent.find(filter)
      .sort({ createdAt: -1 })
      .skip(skipOf(q))
      .limit(q.pageSize)
      .lean(),
    AcademyContent.countDocuments(filter),
  ]);

  return page(rows.map(toContentDto), total, q);
}

export async function getContent(id, actor) {
  assertCanManage(actor, 'the content library');
  const row = await AcademyContent.findOne({ _id: id, deletedAt: null }).lean();
  if (!row) throw new HrmsNotFoundError('Content');
  return toContentDto(row);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Upload one piece of learning material.
 *
 * The bytes decide the type, the storage layer mints the key, and the declared
 * filename is kept for display only. None of that is novel - it is what
 * `document.service.js#uploadDocument` does, and doing it differently here
 * would be the bug.
 */
export async function uploadContent(file, body, actor, context = {}) {
  assertCanManage(actor, 'the content library');

  if (!file?.buffer?.length) {
    throw new HrmsValidationError('Attach a file to upload.');
  }

  const dto = parse(uploadContentSchema, body, 'content');

  assertWithinTypeLimit(dto.type, file.size ?? file.buffer.length);

  const sniffed = sniffAcademyContent(file.buffer, file.mimetype, dto.type);
  if (!sniffed) {
    throw new HrmsValidationError(
      dto.type === 'video'
        ? 'That is not a video this player can read. Upload an MP4 or a WebM.'
        : `That file is not a ${dto.type === 'pdf' ? 'PDF' : 'supported document'}.`,
    );
  }

  const stored = await putObject({
    category: STORAGE_CATEGORIES.ACADEMY_CONTENT,
    body: file.buffer,
    contentType: sniffed.type,
    scope: dto.type,
    filename: `content.${sniffed.ext}`,
    size: file.size ?? file.buffer.length,
  });

  const uploader = actor?.employeeId
    ? await Employee.findById(actor.employeeId).select('firstName lastName').lean().catch(() => null)
    : null;

  const row = await AcademyContent.create({
    title: dto.title,
    description: dto.description ?? null,
    type: dto.type,
    storageKey: stored.key,
    storageCategory: stored.category,
    mimeType: sniffed.type,
    fileSize: stored.size ?? file.size ?? file.buffer.length,
    originalFilename: file.originalname ?? null,
    // Only meaningful for video, and the schema already refuses a video without
    // one. Stored as null for the other types rather than 0, which would read
    // as "a zero-second document".
    durationSeconds: dto.type === 'video' ? dto.durationSeconds : null,
    tags: dto.tags ?? [],
    uploadedByEmployeeId: actor?.employeeId ?? null,
    uploadedByName: uploader ? fullName(uploader) : '',
  });

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_CONTENT_UPLOADED,
    `Uploaded academy content "${dto.title}"`,
    context.req,
    { meta: { contentId: idStr(row._id), type: dto.type, bytes: row.fileSize } },
  );

  return toContentDto(row.toObject());
}

export async function updateContent(id, body, actor, context = {}) {
  assertCanManage(actor, 'the content library');
  const dto = parse(updateContentSchema, body, 'content');

  const row = await AcademyContent.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Content');

  for (const key of ['title', 'description', 'tags', 'active']) {
    if (dto[key] !== undefined) row[key] = dto[key];
  }
  await row.save();

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_CONTENT_UPDATED,
    `Updated academy content "${row.title}"`,
    context.req,
    { meta: { contentId: idStr(row._id), fields: Object.keys(dto) } },
  );

  return toContentDto(row.toObject());
}

/**
 * Remove a content item.
 *
 * REFUSED while any live lesson references it. That is the whole design: an
 * item can be reused by many courses, so deleting one is not a local act, and
 * discovering the consequence as a blank video player weeks later is not an
 * acceptable way to find out.
 *
 * The caller is told exactly which courses are in the way, because "it is in
 * use" without saying where is an error a person cannot act on.
 */
export async function deleteContent(id, actor, context = {}) {
  assertCanManage(actor, 'the content library');

  const row = await AcademyContent.findOne({ _id: id, deletedAt: null });
  if (!row) throw new HrmsNotFoundError('Content');

  const inUse = await AcademyCourse.find({
    deletedAt: null,
    lessons: { $elemMatch: { contentId: row._id, type: { $in: CONTENT_LESSON_TYPES } } },
  })
    .select('name')
    .limit(10)
    .lean();

  if (inUse.length > 0) {
    throw new HrmsConflictError(
      `"${row.title}" is used by ${inUse.length} course(s) and cannot be removed.`,
      {
        code: 'CONTENT_IN_USE',
        details: { courses: inUse.map((c) => ({ id: idStr(c._id), name: c.name })) },
      },
    );
  }

  row.deletedAt = new Date();
  row.active = false;
  await row.save();

  /**
   * The object goes too.
   *
   * Best-effort and after the row is settled: a bucket that refuses the delete
   * must not leave a library item nobody can remove. The row is already
   * unreachable, so the worst case is an orphaned object rather than a
   * dangling reference - which is the right direction for the failure.
   */
  await deleteObject(row.storageKey).catch((error) => {
    console.error('[hrms:academy] content object delete failed:', error?.message ?? error);
  });

  await recordAudit(
    { _id: actor.userId },
    AUDIT_ACTIONS.ACADEMY_CONTENT_DELETED,
    `Deleted academy content "${row.title}"`,
    context.req,
    { meta: { contentId: idStr(row._id), type: row.type } },
  );

  return { id: idStr(row._id), deleted: true };
}

// ---------------------------------------------------------------------------
// Storage access rule
// ---------------------------------------------------------------------------

/**
 * Who may read an academy content object.
 *
 * Registered in `hrms.bootstrap.js`; the storage layer fails closed for an
 * unregistered category, so until that runs no training video is readable at
 * all - which is the correct default.
 *
 * ---------------------------------------------------------------------------
 * THE AUTHORISATION QUESTION IS NOT "WHO OWNS THIS FILE"
 * ---------------------------------------------------------------------------
 * Every other category in this system resolves an object to an owning employee
 * and checks a scope against them. Learning content has no owner - it is
 * company material, and the question is "is this person entitled to study it",
 * which is a question about ASSIGNMENTS rather than about the file.
 *
 * So the rule returns a bare `academy:view:self` requirement and the ASSIGNMENT
 * check happens where the URL is issued (`contentUrlForLesson`), which is the
 * only place that knows which lesson the request is for. Returning an absolute
 * org requirement here - as the résumé rule does - would lock every learner out
 * of their own training; returning nothing would hand every authenticated HRMS
 * user the whole library.
 */
export async function resolveContentAccess(key) {
  const row = await AcademyContent.findOne({ storageKey: key })
    .select('_id deletedAt')
    .lean()
    .catch(() => null);

  if (!row || row.deletedAt) return null;

  return {
    owner: undefined,
    permissions: [{ module: M.ACADEMY, action: A.VIEW, scope: S.SELF }],
  };
}

/**
 * Resolve a content item to its storage key, for a caller who has ALREADY been
 * authorised against the lesson that uses it.
 *
 * Exported for `assignment.service.js` rather than made public: there is no
 * route that turns a bare contentId into a URL, because such a route would let
 * any employee read any material in the library by iterating ids.
 */
export async function contentStorageKey(contentId) {
  const row = await AcademyContent.findOne({ _id: contentId, deletedAt: null })
    .select('storageKey storageCategory title mimeType type durationSeconds active')
    .lean()
    .catch(() => null);

  if (!row) return null;
  return {
    key: row.storageKey,
    category: row.storageCategory,
    name: row.title,
    mimeType: row.mimeType,
    type: row.type,
    durationSeconds: row.durationSeconds ?? null,
    active: row.active !== false,
  };
}

/** Content items by id, for hydrating a course's lessons in one query. */
export async function contentByIds(ids) {
  const unique = [...new Set(ids.map(idStr).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await AcademyContent.find({ _id: { $in: unique.map(oid) } })
    .select('title type mimeType durationSeconds fileSize active deletedAt')
    .lean();

  return new Map(rows.map((r) => [idStr(r._id), r]));
}

export default {
  toContentDto,
  listContent,
  getContent,
  uploadContent,
  updateContent,
  deleteContent,
  resolveContentAccess,
  contentStorageKey,
  contentByIds,
};
