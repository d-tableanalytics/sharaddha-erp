/**
 * O2D order documents.
 *
 * The interesting assertions are about the file itself rather than the CRUD:
 * that the stored content type comes from the BYTES and not from what the
 * client claimed, that an executable-in-a-browser upload is refused, and that
 * removing a document keeps the record (§29).
 *
 * Runs against the local storage driver, which writes to a temp directory and
 * presents the same signed-URL interface S3 does — so the flow exercised here is
 * the flow that runs in production.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dDocument } from '../models/o2d/O2dDocument.js';
import AuditLog from '../models/AuditLog.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const NOW = ist('2026-09-14', '10:30');
const sales = { _id: undefined, user: 'A Sales', role: 'Sales' };

let documents;
let storageDir;

/** A real PDF, as far as the sniffer is concerned: it checks the header. */
const pdf = (body = 'hello') => Buffer.from(`%PDF-1.7\n${body}`, 'latin1');

const file = (buffer, over = {}) => ({
  buffer,
  size: buffer.length,
  mimetype: 'application/pdf',
  originalname: 'customer-po.pdf',
  ...over,
});

before(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'o2d-storage-'));
  process.env.STORAGE_DRIVER = 'local';
  // The local driver reads STORAGE_LOCAL_PATH, and reads it ONCE at module
  // load — hence the dynamic import below rather than a top-level one. Get the
  // name wrong and the tests silently write into ./uploads in the repo.
  process.env.STORAGE_LOCAL_PATH = storageDir;
  // The storage driver reads its config at first use, so the module is imported
  // AFTER the environment is set rather than at the top of the file.
  documents = await import('../modules/o2d/document.service.js');

  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dDocument);
});

after(async () => {
  await stopTestMongo();
  await fs.rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const makeOrder = async () => {
  const { order } = await orders.createOrder(
    {
      poNumber: 'PO-4471',
      poDate: ist('2026-09-14', '09:00').toISOString(),
      customerName: 'ABC Industries',
      promiseDate: ist('2026-09-25', '10:00').toISOString(),
      items: [],
    },
    sales,
    { now: NOW },
  );
  return order;
};

describe('attaching a document', () => {
  test('stores the file and stamps the order it belongs to', async () => {
    const order = await makeOrder();
    const doc = await documents.uploadDocument(order._id, file(pdf()), { docType: 'PO' }, sales);

    assert.equal(doc.docType, 'PO');
    assert.equal(doc.poNumber, 'PO-4471');
    assert.equal(doc.originalName, 'customer-po.pdf');
    assert.equal(doc.contentType, 'application/pdf');
    assert.ok(doc.storageKey.startsWith('o2d/documents/'));
  });

  test('the key is unguessable and never built from the filename', async () => {
    const order = await makeOrder();
    const doc = await documents.uploadDocument(
      order._id,
      file(pdf(), { originalname: '../../etc/passwd.pdf' }),
      { docType: 'PO' },
      sales,
    );

    assert.ok(!doc.storageKey.includes('passwd'));
    assert.ok(!doc.storageKey.includes('..'));
    // The name is kept for display only.
    assert.equal(doc.originalName, '../../etc/passwd.pdf');
  });

  test('believes the BYTES, not the declared content type', async () => {
    const order = await makeOrder();
    // A client claiming HTML while sending a PDF. The stored type is the PDF.
    const doc = await documents.uploadDocument(
      order._id,
      file(pdf(), { mimetype: 'text/html' }),
      { docType: 'PO' },
      sales,
    );
    assert.equal(doc.contentType, 'application/pdf');
  });

  test('refuses a file whose leading bytes are not a format we accept', async () => {
    const order = await makeOrder();
    // HTML claiming to be a PDF — the case that turns an upload into script
    // execution on the API origin if the declared type is believed.
    await assert.rejects(
      () => documents.uploadDocument(
        order._id,
        file(Buffer.from('<html><script>alert(1)</script></html>'), { mimetype: 'application/pdf' }),
        { docType: 'PO' },
        sales,
      ),
      (e) => e.code === 'O2D_UNSUPPORTED_FILE_TYPE' && e.statusCode === 415,
    );
  });

  test('refuses an unknown document type with a message naming the valid ones', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => documents.uploadDocument(order._id, file(pdf()), { docType: 'RANDOM' }, sales),
      (e) => e.code === 'O2D_BAD_DOCUMENT_TYPE' && /PO, SOR, PI/.test(e.message),
    );
  });

  test('refuses an empty upload', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => documents.uploadDocument(order._id, null, { docType: 'PO' }, sales),
      (e) => e.code === 'O2D_NO_FILE',
    );
  });

  test('records the upload, including what the client CLAIMED the type was', async () => {
    const order = await makeOrder();
    await documents.uploadDocument(
      order._id, file(pdf(), { mimetype: 'text/html' }), { docType: 'PO' }, sales,
    );

    const row = await AuditLog.findOne({ action: 'o2d.document.uploaded' }).lean();
    assert.ok(row);
    // Keeping the declared type is what makes a pattern of mismatches findable.
    assert.equal(row.meta.declaredContentType, 'text/html');
    assert.equal(row.meta.contentType, 'application/pdf');
  });

  test('several documents of the same type coexist — a revised PO is not an overwrite', async () => {
    const order = await makeOrder();
    await documents.uploadDocument(order._id, file(pdf('v1')), { docType: 'PO' }, sales);
    await documents.uploadDocument(order._id, file(pdf('v2')), { docType: 'PO' }, sales);

    const list = await documents.listDocuments(order._id);
    assert.equal(list.length, 2);
  });
});

describe('reading a document', () => {
  test('issues a short-lived URL to a holder of VIEW_O2D, and audits the issuance', async () => {
    const order = await makeOrder();
    const doc = await documents.uploadDocument(order._id, file(pdf()), { docType: 'PO' }, sales);

    const { url, expiresInSeconds } = await documents.issueDocumentUrl(doc._id, sales);
    assert.ok(url);
    assert.ok(expiresInSeconds > 0);

    const issued = await AuditLog.findOne({ 'meta.action': 'read_url_issued' }).lean();
    assert.ok(issued, 'issuing a bearer-capable URL is the auditable act');
  });

  test('refuses a caller without VIEW_O2D', async () => {
    const order = await makeOrder();
    const doc = await documents.uploadDocument(order._id, file(pdf()), { docType: 'PO' }, sales);

    await assert.rejects(
      () => documents.issueDocumentUrl(doc._id, { role: 'Employee', user: 'Nobody' }),
      (e) => e.statusCode === 403,
    );
  });
});

describe('removing a document (§29)', () => {
  test('hides it but keeps the row, the reason and the stored object', async () => {
    const order = await makeOrder();
    const doc = await documents.uploadDocument(order._id, file(pdf()), { docType: 'PO' }, sales);

    await documents.deleteDocument(doc._id, 'Wrong customer PO attached', sales);

    assert.equal((await documents.listDocuments(order._id)).length, 0);

    const kept = await O2dDocument.findById(doc._id).lean();
    assert.ok(kept, 'the record survives — the point of a soft delete');
    assert.match(kept.deleteReason, /Wrong customer PO/);
    assert.ok(kept.deletedAt);
  });

  test('needs a reason', async () => {
    const order = await makeOrder();
    const doc = await documents.uploadDocument(order._id, file(pdf()), { docType: 'PO' }, sales);

    await assert.rejects(
      () => documents.deleteDocument(doc._id, '   ', sales),
      (e) => e.code === 'O2D_DELETE_REASON_REQUIRED',
    );
  });

  test('a removed document cannot be read back through a URL', async () => {
    const order = await makeOrder();
    const doc = await documents.uploadDocument(order._id, file(pdf()), { docType: 'PO' }, sales);
    await documents.deleteDocument(doc._id, 'Attached in error', sales);

    await assert.rejects(
      () => documents.issueDocumentUrl(doc._id, sales),
      (e) => e.statusCode === 404,
    );
  });
});
