import { useEffect, useState } from "react";
import { AlertTriangle, Ban } from "lucide-react";
import toast from "react-hot-toast";

import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { employeesApi } from "../../../services/hrms";

/**
 * The permanent delete, behind one deliberate step.
 *
 * Opens on the server's preview — what would be erased, anything refusing it,
 * anything it leaves for somebody else — so the person confirming sees the
 * actual scale ("214 attendance days, 9 payslips") rather than a sentence
 * about records in general. The button stays off until the employee code is
 * typed back, the same rule the server applies, and while anything refuses.
 *
 * Mount it only while it is open: each opening then starts from a fresh
 * preview and an empty confirmation box, rather than from whatever the last
 * employee's dialog left behind.
 */

const sameCode = (typed, code) =>
  typed.trim().toUpperCase() === String(code ?? "").trim().toUpperCase();

export function DeleteEmployeeDialog({ employee, onClose, onDeleted }) {
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    employeesApi
      .erasurePreview(employee.id)
      .then((data) => {
        if (live) setPreview(data);
      })
      .catch((err) => {
        if (live) setLoadError(err.message || "Could not load what would be deleted.");
      });
    return () => {
      live = false;
    };
  }, [employee.id]);

  const blocked = (preview?.blockers ?? []).length > 0;
  const canConfirm = Boolean(preview) && !blocked && sameCode(typed, preview.employeeCode);

  const confirm = async () => {
    setBusy(true);
    try {
      await employeesApi.erase(employee.id, typed);
      toast.success(`${preview.displayName} has been permanently deleted.`);
      onDeleted?.();
    } catch (err) {
      toast.error(err.message || "Could not delete this employee.");
      setBusy(false);
    }
  };

  return (
    // Not dismissable while the delete is running, so the dialog cannot vanish
    // over a request whose outcome the user then has to guess.
    <Modal isOpen onClose={busy ? () => {} : onClose} title="Delete employee permanently?" size="md">
      {!preview && !loadError && (
        <p className="text-sm text-slate-500">Checking what would be deleted…</p>
      )}

      {loadError && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-error-600">{loadError}</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            This permanently deletes <strong className="text-slate-900">{preview.displayName}</strong>{" "}
            ({preview.employeeCode}),{" "}
            {preview.login ? (
              <>
                their login <strong className="text-slate-900">{preview.login.email}</strong>,{" "}
              </>
            ) : null}
            and every HRMS record about them. <strong className="text-slate-900">It cannot be undone.</strong>
          </p>

          {preview.records.length > 0 ? (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">
                What will be deleted
              </h4>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {preview.records.map((r) => (
                  <li key={r.key} className="flex justify-between gap-3 border-b border-slate-50 py-0.5">
                    <span className="text-slate-600">{r.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {r.count.toLocaleString("en-IN")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-slate-500">They have no HRMS records yet.</p>
          )}

          <p className="text-xs text-slate-500 leading-relaxed">
            Kept, without their name: checklists, delegations and O2D orders they handled, and what
            they did on other people&apos;s records, such as leave they approved.
          </p>

          {blocked && (
            <div className="flex flex-col gap-1.5 rounded-lg bg-error-50 px-3 py-2.5">
              {preview.blockers.map((b) => (
                <p key={b.code} className="flex items-start gap-2 text-sm font-semibold text-error-600">
                  <Ban size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {b.message}
                </p>
              ))}
            </div>
          )}

          {!blocked && preview.warnings.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg bg-warning-50 px-3 py-2.5">
              {preview.warnings.map((w) => (
                <p key={w.code} className="flex items-start gap-2 text-sm text-warning-600">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {w.message}
                </p>
              ))}
            </div>
          )}

          {!blocked && (
            <Input
              label={`Type ${preview.employeeCode} to confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          )}

          <div className="flex justify-end gap-3 mt-1">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={busy} disabled={!canConfirm}>
              Delete permanently
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default DeleteEmployeeDialog;
