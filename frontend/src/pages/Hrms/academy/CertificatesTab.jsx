import { useCallback, useEffect, useState } from "react";
import { Award, ExternalLink } from "lucide-react";

import { ErrorState } from "../../../components/hrms/ErrorState";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { certificatesApi, formatDay } from "../../../services/hrms/academy";

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
      // `noopener` because the target is a storage origin and must never get a
      // handle on this window.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }, []);

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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((cert) => (
        <article
          key={cert.id}
          className="flex flex-col bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden"
        >
          <div className="flex-1 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Award size={17} className="mt-0.5 shrink-0 text-primary-600" />
                <h3 className="text-sm font-bold text-slate-900 leading-snug">{cert.pathName}</h3>
              </div>
              {cert.revoked ? (
                <Badge variant="danger">Revoked</Badge>
              ) : cert.expired ? (
                <Badge variant="warning">Expired</Badge>
              ) : (
                <Badge variant="success">Valid</Badge>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
              <div>
                <dt className="text-slate-400">Completed</dt>
                <dd className="font-semibold text-slate-700">{formatDay(cert.completionDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Valid until</dt>
                <dd className="font-semibold text-slate-700">
                  {cert.validUntil ? formatDay(cert.validUntil) : "Does not expire"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-400">Certificate number</dt>
                <dd className="font-mono text-[11px] font-semibold text-slate-700 break-all">
                  {cert.certificateNo}
                </dd>
              </div>
            </dl>
          </div>

          <div className="px-4 sm:px-5 py-3 bg-slate-50/50 border-t border-slate-100">
            <Button
              size="xs"
              variant="outline"
              loading={busy === cert.id}
              disabled={cert.revoked}
              onClick={() => open(cert.id)}
            >
              <ExternalLink size={12} className="mr-1.5" />
              View / download
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default CertificatesTab;
