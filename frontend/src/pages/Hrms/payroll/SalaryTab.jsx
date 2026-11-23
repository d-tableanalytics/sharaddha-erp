import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IndianRupee, History, ShieldCheck, Info } from "lucide-react";

import { ErrorState } from "../../../components/hrms/ErrorState";
import { SearchableSelect } from "../../../components/hrms/SearchableSelect";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { DateField } from "../../../components/ui/DateField";
import { employeesApi } from "../../../services/hrms/employees";
import { compensationApi, payGroupsApi, salaryStructuresApi } from "../../../services/hrms";
import { formatMoney } from "../../../services/hrms/payroll";
import { INDIAN_STATE_CODES } from "@shared/constants/hrms.js";

/**
 * Salary — configuring what one employee is paid.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THIS SCREEN COMPUTES NOTHING
 * ---------------------------------------------------------------------------
 * Every figure shown comes from `POST /payroll/compensation/preview`, which
 * runs the SAME engine the monthly payroll run runs, against the same hydrated
 * structure and the same statutory configuration. There is no arithmetic in
 * this file — not a multiplication, not a percentage, not a "roughly".
 *
 * That is deliberate and it is the point. A salary approved against a number
 * the browser worked out is a salary approved against a number that can
 * disagree with payday. The backend test `compensation-preview.test.js` holds
 * the preview to a real computed payroll run, line for line.
 *
 * ---------------------------------------------------------------------------
 * THE PREVIEW IS NEVER STALE
 * ---------------------------------------------------------------------------
 * Changing any input that affects the figure CLEARS the breakdown immediately
 * and recomputes after a pause. A breakdown that lingers beside a changed CTC
 * is the one failure this screen must not have: it would show the admin a net
 * pay belonging to a salary they have already edited away from.
 *
 * ---------------------------------------------------------------------------
 * A RAISE OPENS A REVISION. IT DOES NOT EDIT A ROW.
 * ---------------------------------------------------------------------------
 * Compensation is effective-dated, so saving here creates a NEW row and closes
 * the previous one the day before — which is what lets last month's payroll
 * still compute on last month's salary, and a historic payslip still match the
 * one the employee was given. The form says so rather than looking like an
 * edit form that happens to keep history.
 */

const REGIMES = [
  { value: "", label: "Company default" },
  { value: "new", label: "New regime" },
  { value: "old", label: "Old regime" },
];

const TYPE_TONES = {
  earning: "success",
  reimbursement: "primary",
  deduction: "warning",
  employer_contribution: "neutral",
};

const TYPE_LABELS = {
  earning: "Earning",
  reimbursement: "Reimbursement",
  deduction: "Deduction",
  employer_contribution: "Employer",
};

const today = () => new Date().toISOString().slice(0, 10);

/** Empty string for "not set" — never 0, which is a real salary. */
const blankForm = () => ({
  payGroupId: "",
  structureId: "",
  ctc: "",
  effectiveFrom: today(),
  stateCode: "",
  employeeRegime: "",
  pfExcluded: false,
  disabled: false,
  revisionReason: "",
});

export function SalaryTab() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  const [payGroups, setPayGroups] = useState([]);
  const [structures, setStructures] = useState([]);

  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingSalary, setLoadingSalary] = useState(false);

  const [form, setForm] = useState(blankForm);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(null);

  const [error, setError] = useState(null);

  // ---- reference data ----------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [groups, list] = await Promise.all([
          payGroupsApi.list(),
          salaryStructuresApi.list(),
        ]);
        if (cancelled) return;
        setPayGroups(groups ?? []);
        setStructures(list ?? []);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The employee picker. Server-paginated, so it searches rather than downloads. */
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingEmployees(true);
      try {
        const res = await employeesApi.list({ search: employeeQuery, pageSize: 50, status: "active" });
        if (!cancelled) setEmployees(res?.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [employeeQuery]);

  // ---- the selected employee's salary ------------------------------------

  const loadSalary = useCallback(async (id) => {
    if (!id) {
      setCurrent(null);
      setHistory([]);
      return;
    }
    setLoadingSalary(true);
    try {
      const [cur, hist] = await Promise.all([
        compensationApi.current(id),
        compensationApi.history(id),
      ]);
      setCurrent(cur ?? null);
      setHistory(hist?.data ?? []);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingSalary(false);
    }
  }, []);

  useEffect(() => {
    loadSalary(employeeId);
    setSaved(null);
    setSaveError(null);
  }, [employeeId, loadSalary]);

  /**
   * Seed the form from what the employee is on today.
   *
   * A revision usually changes ONE thing — the CTC — so starting from the
   * current pay group, structure, state and flags means an admin does not
   * re-pick four unchanged fields and cannot accidentally move someone to a
   * different structure by forgetting one. The CTC itself is seeded too, so
   * the figure being replaced is visible in the field being typed over.
   *
   * `effectiveFrom` deliberately resets to TODAY rather than copying the old
   * row's date: a revision must start after the row it supersedes, and
   * pre-filling the superseded date would guarantee the server refuses it.
   */
  useEffect(() => {
    if (!employeeId) {
      setForm(blankForm());
      return;
    }
    if (!current) {
      const fallbackGroup = payGroups.find((g) => g.isDefault) ?? payGroups[0] ?? null;
      setForm({
        ...blankForm(),
        payGroupId: fallbackGroup ? fallbackGroup.id : "",
      });
      return;
    }
    setForm({
      payGroupId: current.payGroupId ?? "",
      structureId: current.structureId ?? "",
      ctc: current.ctc != null ? String(current.ctc) : "",
      effectiveFrom: today(),
      stateCode: current.stateCode ?? "",
      employeeRegime: current.employeeRegime ?? "",
      pfExcluded: Boolean(current.pfExcluded),
      disabled: Boolean(current.disabled),
      revisionReason: "",
    });
  }, [employeeId, current, payGroups]);

  /** Structures belong to one pay group; crossing them is refused server-side. */
  const structuresForGroup = useMemo(
    () => structures.filter((s) => !form.payGroupId || String(s.payGroupId) === String(form.payGroupId)),
    [structures, form.payGroupId],
  );

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Choosing a different pay group drops a structure that no longer belongs to
   * it, rather than leaving an invalid pair for the server to reject.
   */
  const setPayGroup = (payGroupId) => {
    const stillValid = structures.some(
      (s) => String(s.id) === String(form.structureId) && String(s.payGroupId) === String(payGroupId),
    );
    const theDefault = structures.find(
      (s) => String(s.payGroupId) === String(payGroupId) && s.isDefault,
    );
    set({
      payGroupId,
      structureId: stillValid ? form.structureId : (theDefault?.id ?? ""),
    });
  };

  // ---- the preview -------------------------------------------------------

  /** Everything the computed figure depends on. Nothing else retriggers it. */
  const previewKey = JSON.stringify({
    structureId: form.structureId,
    ctc: form.ctc,
    stateCode: form.stateCode,
    employeeRegime: form.employeeRegime,
    pfExcluded: form.pfExcluded,
    disabled: form.disabled,
  });

  const canPreview = Boolean(form.structureId) && Number(form.ctc) > 0;
  const previewSeq = useRef(0);

  useEffect(() => {
    // Cleared FIRST and synchronously: a breakdown beside a changed input is
    // worse than no breakdown.
    setPreview(null);
    setPreviewError(null);
    if (!canPreview) return undefined;

    const ticket = (previewSeq.current += 1);
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const result = await compensationApi.preview({
          structureId: form.structureId,
          ctc: String(form.ctc),
          ...(form.stateCode ? { stateCode: form.stateCode } : {}),
          ...(form.employeeRegime ? { employeeRegime: form.employeeRegime } : {}),
          pfExcluded: form.pfExcluded,
          disabled: form.disabled,
        });
        // A superseded request must never overwrite a newer answer.
        if (ticket === previewSeq.current) setPreview(result);
      } catch (err) {
        if (ticket === previewSeq.current) {
          // The commonest failures are real blockers an admin has to fix — no
          // statutory configuration, no resolvable state — so the reason is
          // shown rather than swallowed.
          setPreviewError(err?.message ?? "The salary could not be computed.");
        }
      } finally {
        if (ticket === previewSeq.current) setPreviewing(false);
      }
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, canPreview]);

  // ---- saving ------------------------------------------------------------

  const save = async (event) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(null);

    if (!employeeId) return setSaveError("Choose an employee first.");
    if (!form.payGroupId) return setSaveError("Choose a pay group.");
    if (!form.structureId) return setSaveError("Choose a salary structure.");
    if (!(Number(form.ctc) > 0)) return setSaveError("Enter an annual CTC above zero.");
    if (!form.effectiveFrom) return setSaveError("Choose the date this salary takes effect.");

    setSaving(true);
    try {
      await compensationApi.create({
        employeeId,
        payGroupId: form.payGroupId,
        structureId: form.structureId,
        // A STRING. The server builds a Decimal128 from it, so the figure never
        // becomes a float in transit — see the note in services/hrms/payroll.js.
        ctc: String(form.ctc),
        effectiveFrom: form.effectiveFrom,
        ...(form.stateCode ? { stateCode: form.stateCode } : {}),
        ...(form.employeeRegime ? { employeeRegime: form.employeeRegime } : {}),
        pfExcluded: form.pfExcluded,
        disabled: form.disabled,
        ...(form.revisionReason.trim() ? { revisionReason: form.revisionReason.trim() } : {}),
      });
      setSaved("Salary saved. Payroll will use it from the effective date.");
      await loadSalary(employeeId);
    } catch (err) {
      setSaveError(err?.message ?? "The salary could not be saved.");
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  // ---- render ------------------------------------------------------------

  if (error) {
    return (
      <ErrorState
        variant={error.isForbidden ? "forbidden" : "error"}
        description={error.message}
        onRetry={() => {
          setError(null);
          loadSalary(employeeId);
        }}
      />
    );
  }

  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: e.displayName || e.employeeCode,
    hint: [e.employeeCode, e.designation, e.departmentName].filter(Boolean).join(" · "),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-500">
          Salary is visible and editable to a Super Admin only. Every figure below is computed by
          the payroll engine itself — the same one that produces payslips — so what is shown here is
          what the month will pay. Saving records a dated revision; it never overwrites history.
        </p>
      </div>

      <div className="max-w-md">
        <SearchableSelect
          label="Employee"
          value={employeeId}
          onChange={setEmployeeId}
          options={employeeOptions}
          loading={loadingEmployees}
          placeholder="Choose an employee…"
          searchPlaceholder="Search by name or code…"
          emptyText="No matching employee"
          onSearch={setEmployeeQuery}
        />
      </div>

      {!employeeId ? (
        <EmptyState
          icon={<IndianRupee className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
          title="Choose an employee"
          description="Pick someone above to see what they are paid and to record a revision."
        />
      ) : loadingSalary ? (
        <div className="flex min-h-[20vh] items-center justify-center">
          <LoadingSpinner size={28} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---- the form ------------------------------------------------ */}
          <form onSubmit={save} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                {current ? "Record a revision" : "Set this employee's salary"}
              </h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                {current
                  ? `Currently on ₹ ${formatMoney(current.ctc)} a year from ${current.effectiveFrom}. Saving opens a new revision from the date below and closes this one the day before.`
                  : "This employee has no salary on record, so payroll cannot pay them yet."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Pay group"
                value={form.payGroupId}
                onChange={(e) => setPayGroup(e.target.value)}
              >
                <option value="">Choose…</option>
                {payGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>

              <Select
                label="Salary structure"
                value={form.structureId}
                onChange={(e) => set({ structureId: e.target.value })}
                disabled={!form.payGroupId}
                helperText={
                  form.payGroupId && structuresForGroup.length === 0
                    ? "This pay group has no structure yet — create one under Structures."
                    : undefined
                }
              >
                <option value="">Choose…</option>
                {structuresForGroup.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </Select>

              <Input
                label="Annual CTC"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={form.ctc}
                onChange={(e) => set({ ctc: e.target.value })}
                helperText={
                  Number(form.ctc) > 0
                    ? `₹ ${formatMoney(Number(form.ctc) / 12)} a month`
                    : "The yearly cost to company."
                }
              />

              <DateField
                label="Effective from"
                value={form.effectiveFrom}
                onChange={(v) => set({ effectiveFrom: v })}
              />

              <Select
                label="State"
                value={form.stateCode}
                onChange={(e) => set({ stateCode: e.target.value })}
                helperText="Drives professional tax and LWF. Blank uses the company default."
              >
                <option value="">Company default</option>
                {INDIAN_STATE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>

              <Select
                label="Tax regime"
                value={form.employeeRegime}
                onChange={(e) => set({ employeeRegime: e.target.value })}
              >
                {REGIMES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-wrap gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.pfExcluded}
                  onChange={(e) => set({ pfExcluded: e.target.checked })}
                />
                Excluded from PF
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.disabled}
                  onChange={(e) => set({ disabled: e.target.checked })}
                />
                Disability (raises the ESI threshold)
              </label>
            </div>

            <Input
              label="Reason for the revision"
              value={form.revisionReason}
              onChange={(e) => set({ revisionReason: e.target.value })}
              placeholder="Annual increment, promotion…"
              maxLength={300}
            />

            {saveError && (
              <p role="alert" className="text-xs font-medium text-error-500">
                {saveError}
              </p>
            )}
            {saved && (
              <p role="status" className="text-xs font-medium text-success-600">
                {saved}
              </p>
            )}

            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" loading={saving}>
                {current ? "Save revision" : "Save salary"}
              </Button>
            </div>
          </form>

          {/* ---- the computed breakdown ---------------------------------- */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800">What this pays</h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                  Computed by the payroll engine for a full month. Loss of pay and one-off
                  adjustments are applied when the month is actually run.
                </p>
              </div>
              {previewing && <LoadingSpinner size={18} />}
            </div>

            {!canPreview && !previewError && (
              <EmptyState
                icon={<IndianRupee className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
                title="Choose a structure and a CTC"
                description="The breakdown appears as soon as there is something to compute."
              />
            )}

            {previewError && (
              <p role="alert" className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-xs font-medium text-error-600">
                {previewError}
              </p>
            )}

            {preview && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["Monthly gross", preview.monthlyGross, "text-slate-900"],
                    ["Deductions", preview.monthlyDeductions, "text-slate-900"],
                    ["Monthly net", preview.monthlyNet, "text-success-600"],
                  ].map(([label, value, tone]) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                      <p className={`text-base font-bold tabular-nums ${tone}`}>
                        ₹ {formatMoney(value)}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  Professional tax and LWF computed for{" "}
                  <span className="font-semibold text-slate-600">{preview.stateCode}</span>
                  {preview.stateCodeSource === "company-default" && " (the company default)"}.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full overflow-hidden rounded-lg border border-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Component
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Monthly
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Annual
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.lines.map((line) => (
                        <tr key={line.componentCode}>
                          <td className="px-3 py-1.5 text-xs text-slate-700">
                            {line.componentName}
                            <Badge variant={TYPE_TONES[line.type] ?? "neutral"} className="ml-2">
                              {TYPE_LABELS[line.type] ?? line.type}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                            ₹ {formatMoney(line.monthly)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500">
                            ₹ {formatMoney(line.annual)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-slate-400">
                  Employer contributions on top: ₹ {formatMoney(preview.employerContributions)} a month.
                </p>
              </>
            )}
          </div>

          {/* ---- history ------------------------------------------------- */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
            <div className="mb-2 flex items-center gap-2">
              <History size={15} className="text-slate-400" />
              <h3 className="text-sm font-bold text-slate-800">Salary history</h3>
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No salary has been recorded for this employee yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full overflow-hidden rounded-lg border border-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      {["From", "To", "Annual CTC", "State", "Regime", "Reason"].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((row) => (
                      <tr key={row.id} className={row.isCurrent ? "bg-success-50/40" : undefined}>
                        <td className="px-3 py-1.5 text-xs text-slate-700">
                          {row.effectiveFrom}
                          {row.isCurrent && (
                            <Badge variant="success" className="ml-2">
                              Current
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{row.effectiveTo ?? "—"}</td>
                        <td className="px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-800">
                          ₹ {formatMoney(row.ctc)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{row.stateCode ?? "—"}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{row.employeeRegime ?? "—"}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{row.revisionReason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SalaryTab;
