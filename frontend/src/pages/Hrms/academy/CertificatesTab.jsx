import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Download, Search, BadgeCheck } from "lucide-react";

import { ErrorState } from "../../../components/hrms/ErrorState";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Input } from "../../../components/ui/Input";
import { certificatesApi, formatDay } from "../../../services/hrms/academy";
import { openFile } from "../../../services/fileUrl";

/**
 * My certificates.
 *
 * `certificates/mine` takes no id — the employee comes from the session, as
 * everywhere else in this module.
 *
 * The document URL is fetched ON DEMAND, when somebody actually opens one.
 * Every issued URL is audited as a certificate view, so prefetching the page
 * would file reads nobody performed — the same reasoning the onboarding
 * module's offer-letter service records.
 */
export function CertificatesTab() {
  const [rows, setRows] = useState(undefined);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await certificatesApi.mine());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback(async (id) => {
    setBusy(id);
    setError(null);
    try {
      const { url } = await certificatesApi.documentUrl(id);
      openFile(url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }, []);

  /**
   * Search covers the path name AND the certificate number.
   *
   * The number is the half people actually paste in: somebody chasing a
   * certificate has been given its number by whoever is verifying it, not its
   * course title.
   */
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !rows) return rows;
    return rows.filter(
      (cert) =>
        cert.pathName.toLowerCase().includes(q) ||
        String(cert.certificateNo).toLowerCase().includes(q),
    );
  }, [rows, search]);

  if (error) return <ErrorState description={error.message} onRetry={load} />;

  if (rows === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Award className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
        title="No certificates yet"
        description="Certificates appear here when you complete a learning path that awards one."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <div className="relative w-full sm:max-w-xs">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search certificates…"
            aria-label="Search certificates"
            className="pl-9"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="No certificates match that search"
          description="Try the name of the learning path, or the certificate number."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((cert) => (
            <CertificateCard
              key={cert.id}
              cert={cert}
              busy={busy === cert.id}
              onOpen={() => open(cert.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One certificate.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE PREVIEW IS A CARD, NOT A RENDER OF THE PDF
 * ---------------------------------------------------------------------------
 * The design reference shows a thumbnail of the certificate document. Nothing
 * renders one: the PDF is generated server-side and stored, and producing a
 * raster preview would mean a rasteriser, a second storage object and a
 * regeneration path for every re-issue.
 *
 * So this is styled AS a certificate — a ruled frame, a seal, the path name set
 * large — and carries the real facts off the record: the number, the completion
 * date, the expiry. It is deliberately not a facsimile of the document, because
 * a preview that differs from the file it claims to show is worse than no
 * preview. The document itself is one button away and is the authoritative
 * artefact.
 */
function CertificateCard({ cert, busy, onOpen }) {
  const state = cert.revoked ? "revoked" : cert.expired ? "expired" : "valid";

  const frame =
    state === "valid"
      ? "border-primary-200 bg-primary-50/40"
      : state === "expired"
        ? "border-warning-200 bg-warning-50/40"
        : "border-error-200 bg-error-50/30";

  const seal =
    state === "valid"
      ? "text-primary-600"
      : state === "expired"
        ? "text-warning-600"
        : "text-error-500";

  return (
    <article className="flex flex-col bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden transition-shadow hover:shadow-md">
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 leading-snug">{cert.pathName}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Completed on {formatDay(cert.completionDate)}
          </p>
        </div>
        {state === "valid" ? (
          <Badge variant="success">Valid</Badge>
        ) : state === "expired" ? (
          <Badge variant="warning">Expired</Badge>
        ) : (
          <Badge variant="danger">Revoked</Badge>
        )}
      </header>

      {/* The certificate panel. A double rule and a seal — the visual language
          of the document, at card scale. */}
      <div className="px-4">
        <div
          className={`relative flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 ${frame}`}
        >
          <span
            aria-hidden="true"
            className="absolute inset-1.5 rounded-md border border-current opacity-15"
          />

          <BadgeCheck size={28} strokeWidth={1.5} className={`relative ${seal}`} />

          <p className="relative text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Certificate of Completion
          </p>
          <p className="relative text-xs font-semibold text-slate-800 text-center leading-snug line-clamp-2">
            {cert.pathName}
          </p>
          <p className="relative font-mono text-[10px] text-slate-400 break-all text-center">
            {cert.certificateNo}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-xs">
        <div>
          <dt className="text-slate-400">Issued</dt>
          <dd className="font-semibold text-slate-700">{formatDay(cert.completionDate)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Valid until</dt>
          <dd className="font-semibold text-slate-700">
            {cert.validUntil ? formatDay(cert.validUntil) : "Does not expire"}
          </dd>
        </div>
      </dl>

      <div className="mt-auto px-4 pb-4">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          loading={busy}
          disabled={cert.revoked}
          onClick={onOpen}
        >
          <Download size={14} className="mr-1.5" />
          Download PDF
        </Button>
      </div>
    </article>
  );
}

export default CertificatesTab;
