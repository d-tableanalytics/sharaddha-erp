/**
 * O2D order documents.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS REUSED, AND WHERE THE REUSE DELIBERATELY STOPS
 * ---------------------------------------------------------------------------
 *
 * REUSED — the storage plumbing, unchanged:
 *   `sniffDocument`   decides the type from the LEADING BYTES, refusing what a
 *                     browser would execute. Getting this right a second time
 *                     is not a thing worth doing.
 *   `putObject`       mints an unguessable key and enforces the size ceiling.
 *   `getReadUrl`      short-lived presigned URL, same pattern in dev and prod.
 *
 * NOT REUSED — the authorisation. `modules/hrms/storage` authorises an object by
 * HRMS module/action/scope against the employee who owns it. An O2D document has
 * no employee owner and is authorised by the portal permission VIEW_O2D. Routing
 * O2D through that service would have meant giving every O2D user an HRMS grant,
 * which is exactly the cross-domain leak the portal separation exists to prevent.
 *
 * The audit entry is written HERE for the same reason it is written there: a
 * presigned URL is bearer-capable for its whole lifetime, so issuing it is the
 * only moment at which the access can be recorded at all.
 */

import { O2dDocument } from '../../models/o2d/O2dDocument.js';
import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { putObject, getReadUrl, ttlFor } from '../../utils/hrms/storage/index.js';
import { sniffDocument } from '../../modules/hrms/documents/documentUpload.js';
import { STORAGE_CATEGORIES } from '../../shared/constants/hrms.js';
import { O2D_AUDIT_ACTIONS, O2D_DOCUMENT_TYPES } from '../../shared/constants/o2d.js';
import { recordAudit } from '../../utils/auditLog.js';
import { hasPermission } from '../../middlewares/rbac.js';
import { PERMISSIONS } from '../../config/permissions.js';
import { O2dWorkflowError } from './stage.engine.js';

const CATEGORY = STORAGE_CATEGORIES.O2D_DOCUMENT;

/**
 * Store a file against an order.
 *
 * @param {object} file  multer's in-memory file: `{ buffer, mimetype, originalname, size }`
 */
export async function uploadDocument(orderId, file, meta, actor, { req = null } = {}) {
  if (!file?.buffer?.length) {
    throw new O2dWorkflowError('No file was received. Upload one file in a field named "file".', {
      status: 400,
      code: 'O2D_NO_FILE',
    });
  }

  // Checked here rather than left to the model's enum: this metadata arrives as
  // multipart TEXT fields, so it never passes through `validate()`, and a
  // mongoose ValidationError would surface as "`X` is not a valid enum value for
  // path `docType`" — accurate and useless to the person who picked it.
  if (!O2D_DOCUMENT_TYPES.includes(meta?.docType)) {
    throw new O2dWorkflowError(
      `"${meta?.docType ?? ''}" is not a document type. Expected one of: ${O2D_DOCUMENT_TYPES.join(', ')}.`,
      { status: 400, code: 'O2D_BAD_DOCUMENT_TYPE' },
    );
  }

  const order = await O2dOrder.findById(orderId).select('poNumber').lean();
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  // The client's declared type is a HINT, used only to disambiguate containers
  // that share a signature (a .docx and a .xlsx are both ZIPs). Anything whose
  // leading bytes are not recognised is refused outright.
  const sniffed = sniffDocument(file.buffer, file.mimetype);
  if (!sniffed) {
    throw new O2dWorkflowError(
      'That file type is not accepted. Upload a PDF, an image, or an Office document.',
      { status: 415, code: 'O2D_UNSUPPORTED_FILE_TYPE' },
    );
  }

  const { key } = await putObject({
    category: CATEGORY,
    body: file.buffer,
    contentType: sniffed.type,
    // Grouped by order, so the bucket is navigable and a whole order's
    // documents can be found without consulting the database.
    scope: String(orderId),
    filename: `f.${sniffed.ext}`,
    size: file.size ?? file.buffer.length,
  });

  const doc = await O2dDocument.create({
    order: orderId,
    poNumber: order.poNumber,
    docType: meta.docType,
    stageNumber: meta.stageNumber ?? null,
    storageKey: key,
    originalName: file.originalname ?? null,
    // The SNIFFED type is stored, never the declared one.
    contentType: sniffed.type,
    sizeBytes: file.size ?? file.buffer.length,
    remarks: meta.remarks ?? null,
    uploadedAt: new Date(),
    uploadedBy: actor?._id ?? null,
    uploadedByName: actor?.user ?? actor?.email ?? null,
  });

  await recordAudit(actor ?? null, O2D_AUDIT_ACTIONS.DOCUMENT_UPLOADED,
    `${meta.docType} attached to ${order.poNumber}`, req,
    {
      meta: {
        orderId: String(orderId),
        poNumber: order.poNumber,
        documentId: String(doc._id),
        docType: meta.docType,
        stageNumber: meta.stageNumber ?? null,
        contentType: sniffed.type,
        declaredContentType: file.mimetype ?? null,
        sizeBytes: doc.sizeBytes,
      },
    });

  return doc.toObject();
}

/** An order's live documents, newest first. */
export const listDocuments = (orderId) =>
  O2dDocument.find({ order: orderId, deletedAt: null }).sort({ uploadedAt: -1 }).lean();

/**
 * Authorise, audit, and mint a read URL.
 *
 * The permission check is on the CALLER's portal permission rather than on the
 * document: every O2D document belongs to an order that anyone with VIEW_O2D may
 * already see in the tracker, so a narrower per-document rule would be a
 * different access model from the one the rest of the module uses — and two
 * access models is how one of them ends up wrong.
 */
export async function issueDocumentUrl(documentId, actor, { req = null } = {}) {
  const doc = await O2dDocument.findOne({ _id: documentId, deletedAt: null }).lean();
  if (!doc) throw new O2dWorkflowError('That document is not available.', { status: 404 });

  if (!hasPermission(actor, PERMISSIONS.VIEW_O2D)) {
    throw new O2dWorkflowError('Forbidden. You may not read this file.', { status: 403 });
  }

  const expiresInSeconds = ttlFor(CATEGORY);
  const url = await getReadUrl(doc.storageKey, { category: CATEGORY, ttlSeconds: expiresInSeconds });

  await recordAudit(actor ?? null, O2D_AUDIT_ACTIONS.DOCUMENT_UPLOADED,
    `Issued a ${expiresInSeconds}s read URL for ${doc.docType} on ${doc.poNumber}`, req,
    {
      meta: {
        orderId: String(doc.order),
        poNumber: doc.poNumber,
        documentId: String(doc._id),
        docType: doc.docType,
        action: 'read_url_issued',
      },
    });

  return { url, expiresInSeconds, document: doc };
}

/**
 * Soft-delete a document (§29).
 *
 * The stored object is deliberately LEFT IN PLACE. Removing the bytes would make
 * the row a record of something nobody can check, and a wrongly attached
 * document is usually removed precisely because somebody needs to establish what
 * it was. Purging belongs to a retention job with its own policy, not to a user
 * clicking a cross.
 */
export async function deleteDocument(documentId, reason, actor, { req = null } = {}) {
  const doc = await O2dDocument.findOne({ _id: documentId, deletedAt: null });
  if (!doc) throw new O2dWorkflowError('That document is not available.', { status: 404 });

  if (!reason?.trim()) {
    throw new O2dWorkflowError('Removing a document needs a reason.', {
      status: 400,
      code: 'O2D_DELETE_REASON_REQUIRED',
    });
  }

  doc.deletedAt = new Date();
  doc.deletedBy = actor?._id ?? null;
  doc.deleteReason = reason.trim();
  await doc.save();

  await recordAudit(actor ?? null, O2D_AUDIT_ACTIONS.DOCUMENT_UPLOADED,
    `${doc.docType} removed from ${doc.poNumber} — ${doc.deleteReason}`, req,
    {
      meta: {
        orderId: String(doc.order),
        poNumber: doc.poNumber,
        documentId: String(doc._id),
        action: 'soft_deleted',
        reason: doc.deleteReason,
      },
    });

  return doc.toObject();
}

export default { uploadDocument, listDocuments, issueDocumentUrl, deleteDocument };
