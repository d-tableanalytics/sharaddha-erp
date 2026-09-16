/**
 * Rendering a completion certificate.
 *
 * HTML, not PDF, for exactly the reason `offerLetterDocument.js` gives: no PDF
 * dependency exists in this repository, and the document LIFECYCLE is what
 * carries the behaviour - generated server-side, stored privately, every read
 * authorised, audited and time-boxed. The byte format is a rendering detail
 * behind this one function, and swapping in a real PDF renderer later is a
 * change to `render()` and the content type beside it.
 *
 * Self-contained: no external stylesheet, no script, no remote font. A browser
 * opens it from a presigned URL and prints it to PDF if a PDF is wanted.
 *
 * The company name comes from CompanyProfile at the call site rather than being
 * baked in - AD-1's rule about customer-specific values.
 */

/** Everything that reaches the document is escaped. A path name is user input. */
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `YYYY-MM-DD` to "1 September 2026", without a locale.
 *
 * Node's ICU data differs between builds - the same `toLocaleDateString` call
 * renders "Sept" on one and "Sep" on another. A certificate is a document
 * somebody may have to produce to an auditor; its dates do not get to depend on
 * which Node the server happens to run.
 */
function formatDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

/**
 * Render the certificate.
 *
 * @param {object} data
 * @param {string} data.employeeName
 * @param {string} [data.employeeCode]
 * @param {string} data.pathName
 * @param {string} data.completionDate  YYYY-MM-DD
 * @param {string} data.certificateNo
 * @param {string} [data.validUntil]    YYYY-MM-DD, or null
 * @param {string} [data.companyName]   from CompanyProfile
 * @returns {{ body: string, contentType: string, filename: string }}
 */
export function renderCertificate(data) {
  const company = data.companyName || 'Our company';

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certificate of completion — ${esc(data.employeeName)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f1f5f9; color: #0f172a;
         font: 15px/1.6 Georgia, 'Times New Roman', serif; }
  .sheet { max-width: 900px; margin: 32px auto; background: #fff; padding: 0;
           box-shadow: 0 1px 3px rgba(15,23,42,.12); }
  .frame { margin: 14px; border: 2px solid #02407b; padding: 46px 56px 38px; }
  header { text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; }
  .company { font-family: system-ui, sans-serif; font-size: 12px; font-weight: 700;
             letter-spacing: .18em; text-transform: uppercase; color: #64748b; }
  h1 { margin: 12px 0 0; font-size: 30px; letter-spacing: .08em;
       text-transform: uppercase; color: #02407b; }
  .lede { margin: 34px 0 6px; text-align: center; font-size: 14px; color: #475569; }
  .name { text-align: center; font-size: 30px; font-weight: 700; margin: 6px 0 4px; }
  .code { text-align: center; font-family: system-ui, sans-serif; font-size: 12px;
          color: #64748b; }
  .path { text-align: center; font-size: 21px; font-weight: 700; color: #02407b;
          margin: 8px 0 2px; }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
       gap: 14px 24px; margin: 38px 0 0; padding: 20px 24px;
       background: #f8fafc; border: 1px solid #e2e8f0; }
  dt { font-family: system-ui, sans-serif; font-size: 11px; font-weight: 700;
       text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin-bottom: 3px; }
  dd { margin: 0; font-weight: 700; font-size: 14px; }
  .serial { font-family: ui-monospace, 'Courier New', monospace; letter-spacing: .04em; }
  footer { margin-top: 26px; padding-top: 16px; border-top: 1px solid #e2e8f0;
           font-family: system-ui, sans-serif; font-size: 11px; color: #64748b;
           text-align: center; line-height: 1.7; }
  @media print {
    body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; }
    @page { size: A4 landscape; margin: 10mm; }
  }
  @media (max-width: 640px) {
    .frame { padding: 28px 22px 24px; }
    h1 { font-size: 22px; }
    .name { font-size: 23px; }
    .path { font-size: 18px; }
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="frame">
    <header>
      <div class="company">${esc(company)}</div>
      <h1>Certificate of Completion</h1>
    </header>

    <p class="lede">This is to certify that</p>
    <p class="name">${esc(data.employeeName)}</p>
    ${data.employeeCode ? `<p class="code">Employee ID ${esc(data.employeeCode)}</p>` : ''}

    <p class="lede">has successfully completed the learning path</p>
    <p class="path">${esc(data.pathName)}</p>

    <dl>
      <div><dt>Completed on</dt><dd>${esc(formatDay(data.completionDate))}</dd></div>
      <div><dt>Certificate number</dt><dd class="serial">${esc(data.certificateNo)}</dd></div>
      ${
        data.validUntil
          ? `<div><dt>Valid until</dt><dd>${esc(formatDay(data.validUntil))}</dd></div>`
          : '<div><dt>Validity</dt><dd>Does not expire</dd></div>'
      }
    </dl>

    <footer>
      Issued by ${esc(company)} through SI Academy on
      ${esc(formatDay(new Date().toISOString().slice(0, 10)))}.<br>
      This certificate is verifiable by its certificate number in the SI Academy
      certificate register.
    </footer>
  </div>
</div>
</body>
</html>`;

  return {
    body,
    contentType: 'text/html; charset=utf-8',
    filename: 'certificate.html',
  };
}

export { formatDay };
export default { renderCertificate };
