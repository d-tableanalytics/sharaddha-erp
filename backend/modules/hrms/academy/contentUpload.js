/**
 * Academy content upload: multipart handling and content sniffing.
 *
 * The documents module already sniffs PDFs and Office formats, and this reuses
 * that function rather than restating it - `sniffDocument` is the whitelist for
 * everything that is not a video. What it does NOT know about is video, because
 * an HR document repository has no reason to accept one.
 *
 * So this file adds exactly one thing: video container signatures, and the rule
 * that a video lesson may only ever be one of them.
 *
 * ---------------------------------------------------------------------------
 * Why the type is decided by the BYTES
 * ---------------------------------------------------------------------------
 * Same reason `documentUpload.js` gives: a file is served back to a browser
 * later, and a client-declared MIME type is a request, not a fact. An `.mp4`
 * that is really HTML is script execution if anything ever serves it inline.
 * Everything here is stored under a random key with the sniffed type, and read
 * through a presigned URL - so even a miss cannot become script on this origin.
 */

import multer from 'multer';

import { MAX_CONTENT_BYTES } from '../../../shared/constants/academy.js';
import { HrmsValidationError } from '../hrms.errors.js';
import { sniffDocument } from '../documents/documentUpload.js';

/** The largest thing the route will accept at all; per-type caps are tighter. */
export const MAX_ACADEMY_BYTES = Math.max(...Object.values(MAX_CONTENT_BYTES));

const startsWith = (buffer, bytes) =>
  buffer.length >= bytes.length && buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));

/**
 * An ISO-BMFF file (MP4, M4V, MOV) declares its brand in an `ftyp` box that
 * begins at offset 4, after a four-byte size. The brand that follows says which
 * flavour it is - and several of them are not video at all (`M4A` is audio),
 * so the brand is checked rather than just the box name.
 */
const ISO_BMFF_VIDEO_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash',
  'M4V ', 'M4VH', 'M4VP', 'qt  ',
]);

const isIsoBmffVideo = (b) => {
  if (b.length < 12) return false;
  if (b.subarray(4, 8).toString('latin1') !== 'ftyp') return false;
  return ISO_BMFF_VIDEO_BRANDS.has(b.subarray(8, 12).toString('latin1'));
};

/**
 * WebM and Matroska share the EBML header; the doctype that follows decides
 * which. Both are legitimate video containers a browser will play.
 */
const isMatroska = (b) =>
  startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) &&
  b.subarray(0, 64).toString('latin1').includes('webm');

const VIDEO_SIGNATURES = [
  { type: 'video/mp4', ext: 'mp4', match: isIsoBmffVideo },
  { type: 'video/webm', ext: 'webm', match: isMatroska },
];

/** Every video type the library admits, for the browser's `accept` attribute. */
export const ACCEPTED_VIDEO_TYPES = Object.freeze(VIDEO_SIGNATURES.map((s) => s.type));

/**
 * Decide what an uploaded file really is, for a declared academy content type.
 *
 * @param {Buffer} buffer       the uploaded bytes
 * @param {string} declaredMime the client's Content-Type - used only to
 *   disambiguate container formats whose signature is shared, exactly as
 *   `sniffDocument` uses it
 * @param {string} contentType  'video' | 'pdf' | 'document'
 * @returns {{ type: string, ext: string } | null} null when nothing matches
 */
export function sniffAcademyContent(buffer, declaredMime = '', contentType = 'document') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  if (contentType === 'video') {
    for (const signature of VIDEO_SIGNATURES) {
      if (signature.match(buffer)) return { type: signature.type, ext: signature.ext };
    }
    // A video lesson gets a video. Falling through to the document sniffer
    // here would let a PDF be uploaded as a video, and the player would then
    // render nothing with no explanation.
    return null;
  }

  const sniffed = sniffDocument(buffer, declaredMime);
  if (!sniffed) return null;

  // A `pdf` content item must actually be a PDF - the viewer embeds it inline
  // and a .docx in that slot is a broken page rather than a download.
  if (contentType === 'pdf' && sniffed.type !== 'application/pdf') return null;
  // ...and a `document` must not be a video smuggled past the document sniffer.
  if (contentType === 'document' && sniffed.type.startsWith('video/')) return null;

  return sniffed;
}

/**
 * Enforce the per-TYPE ceiling.
 *
 * The multer limit below is the largest of the three, because multer is
 * configured once and does not know which type this upload claims to be. This
 * is the check that makes a 90 MB "PDF" a 400 rather than a stored object.
 */
export function assertWithinTypeLimit(contentType, size) {
  const limit = MAX_CONTENT_BYTES[contentType] ?? MAX_CONTENT_BYTES.document;
  if (size > limit) {
    throw new HrmsValidationError(
      `That file is larger than the ${Math.round(limit / 1024 / 1024)} MB limit for a ${contentType}.`,
    );
  }
}

/**
 * Multipart, into memory - the same choice every other HRMS upload makes,
 * because nothing is ever written to a path built from user input.
 *
 * The cost is real at this size and is acknowledged in
 * `constants/academy.js#MAX_CONTENT_BYTES`: a 100 MB video is 100 MB of this
 * process's heap for the duration of the request, and the scalable shape is a
 * presigned PUT direct to S3. That is a change to two functions when the
 * library needs it.
 */
export const uploadAcademyFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ACADEMY_BYTES, files: 1 },
}).single('file');

/** Turn multer's own errors into the HRMS error shape. */
export function handleAcademyUploadErrors(error, req, res, next) {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return next(
      new HrmsValidationError(
        `That file is larger than the ${Math.round(MAX_ACADEMY_BYTES / 1024 / 1024)} MB limit.`,
      ),
    );
  }
  if (error?.code === 'LIMIT_UNEXPECTED_FILE') {
    return next(new HrmsValidationError('Upload one file, in a field named "file".'));
  }
  return next(error);
}

export default {
  uploadAcademyFile,
  handleAcademyUploadErrors,
  sniffAcademyContent,
  assertWithinTypeLimit,
  ACCEPTED_VIDEO_TYPES,
  MAX_ACADEMY_BYTES,
};
