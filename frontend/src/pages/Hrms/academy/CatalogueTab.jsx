import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Settings2 } from "lucide-react";

import { HrmsDataTable } from "../../../components/hrms/HrmsDataTable";
import { FilterBar } from "../../../components/hrms/FilterBar";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { DUE_DATE_MODE_LABELS } from "@shared/constants/academy.js";
import { pathsApi, formatDay } from "../../../services/hrms/academy";

/**
 * Server-paged, so the page size is a constant here rather than `usePagination`
 * — that hook slices a list already held in memory, which is the opposite of
 * what AD-13 asks a list screen to do.
 */
const PAGE_SIZE = 25;

/**
 * The learning path catalogue.
 *
 * The LIST lives here; the course-and-lesson builder for one path is its own
 * full-screen page (`PathBuilderPage`), reached by clicking a row. That split
 * follows the Employees module — a directory with a drawer for creation, and a
 * separate page for the detail that needs room.
 */
export function CatalogueTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "" });
  const [data, setData] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await pathsApi.list({
          page,
          pageSize: PAGE_SIZE,
          search: filters.search || undefined,
          active: filters.active,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      header: "Learning path",
      accessorKey: "name",
      cell: (row) => (
        <div className="min-w-0">
          <Link
            to={`${HRMS_ROUTE_PREFIX}/academy/paths/${row.id}`}
            className="text-sm font-semibold text-slate-900 hover:text-primary-700 hover:underline"
          >
            {row.name}
          </Link>
          {row.description && (
            <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      header: "Rules",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.mandatory ? (
            <Badge variant="primary">Mandatory</Badge>
          ) : (
            <Badge variant="neutral">Optional</Badge>
          )}
          {row.sequential && <Badge variant="neutral">In order</Badge>}
          {row.requiresCertificate && <Badge variant="success">Certificate</Badge>}
        </div>
      ),
    },
    {
      header: "Due",
      cell: (row) => (
        <span className="text-xs text-slate-600">
          {row.dueDateMode === "none"
            ? "—"
            : row.dueDateMode === "fixed"
              ? formatDay(row.dueDate)
              : `${row.dueDays} days ${row.dueDateMode === "joining_plus_days" ? "after joining" : "after assignment"}`}
        </span>
      ),
    },
    {
      header: "Courses",
      cell: (row) => <span className="text-sm tabular-nums">{row.courseCount ?? 0}</span>,
      className: "text-center",
    },
    {
      header: "Assigned",
      cell: (row) => <span className="text-sm tabular-nums">{row.assignedCount ?? 0}</span>,
      className: "text-center",
    },
    {
      header: "Status",
      cell: (row) =>
        row.active ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="neutral">Inactive</Badge>
        ),
    },
    {
      header: "",
      cell: (row) => (
        <Link to={`${HRMS_ROUTE_PREFIX}/academy/paths/${row.id}`} data-no-row-click>
          <Button size="xs" variant="ghost">
            <Settings2 size={13} className="mr-1" />
            Build
          </Button>
        </Link>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar
          search={filters.search}
          onSearchChange={(v) => {
            setFilters((f) => ({ ...f, search: v }));
            setPage(1);
          }}
          searchPlaceholder="Search learning paths…"
          filters={[
            {
              key: "active",
              placeholder: "Status",
              options: [
                { value: true, label: "Active" },
                { value: false, label: "Inactive" },
              ],
            },
          ]}
          values={filters}
          onChange={(key, value) => {
            setFilters((f) => ({ ...f, [key]: value }));
            setPage(1);
          }}
          onReset={() => {
            setFilters({ search: "" });
            setPage(1);
          }}
        />

        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={15} className="mr-1.5" />
          New learning path
        </Button>
      </div>

      <HrmsDataTable
        columns={columns}
        rows={data.data}
        loading={loading}
        error={error}
        onRetry={load}
        page={page}
        pageSize={PAGE_SIZE}
        total={data.total}
        onPageChange={setPage}
        emptyTitle="No learning paths yet"
        emptyDescription="Create a learning path, add courses and lessons to it, then assign it — manually or with a rule."
      />

      {creating && (
        <CreatePathModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Create a learning path.
 *
 * The due-date section is the part worth designing carefully: choosing "days
 * after joining" and leaving the number blank is the mistake people make, and
 * the field appears conditionally so the pairing is obvious rather than
 * enforced only by a server error.
 */
function CreatePathModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    dueDateMode: "none",
    dueDays: 15,
    dueDate: "",
    mandatory: true,
    sequential: false,
    requiresCertificate: false,
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const needsDays =
    form.dueDateMode === "joining_plus_days" || form.dueDateMode === "assigned_plus_days";

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      await pathsApi.create({
        name: form.name.trim(),
        description: form.description.trim() || null,
        dueDateMode: form.dueDateMode,
        dueDays: needsDays ? Number(form.dueDays) : null,
        dueDate: form.dueDateMode === "fixed" ? form.dueDate : null,
        mandatory: form.mandatory,
        sequential: form.sequential,
        requiresCertificate: form.requiresCertificate,
        active: form.active,
      });
      onCreated();
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New learning path" size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Name"
          required
          maxLength={160}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="IT — New Employee Onboarding"
        />

        <div className="w-full flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-700">Description</label>
          <textarea
            rows={2}
            maxLength={2000}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What this path covers, and who it is for."
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <fieldset className="flex flex-col gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
          <legend className="px-1.5 text-xs font-semibold text-slate-700">Due date</legend>

          <div className="w-full flex flex-col gap-1.5">
            <select
              value={form.dueDateMode}
              onChange={(e) => set("dueDateMode", e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            >
              {Object.entries(DUE_DATE_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {needsDays && (
            <Input
              label="Days"
              type="number"
              min={1}
              max={730}
              required
              value={form.dueDays}
              onChange={(e) => set("dueDays", e.target.value)}
              helperText={
                form.dueDateMode === "joining_plus_days"
                  ? "Counted from each employee's joining date, so the deadline differs per person."
                  : "Counted from the day the path is assigned — the right choice for a refresher assigned to existing staff."
              }
            />
          )}

          {form.dueDateMode === "fixed" && (
            <Input
              label="Due on"
              type="date"
              required
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              helperText="The same calendar date for everybody."
            />
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-xs font-semibold text-slate-700 mb-1">Behaviour</legend>

          <Toggle
            checked={form.mandatory}
            onChange={(v) => set("mandatory", v)}
            label="Mandatory"
            hint="Optional paths never hold anybody's record open."
          />
          <Toggle
            checked={form.sequential}
            onChange={(v) => set("sequential", v)}
            label="Complete courses in order"
            hint="Each course stays locked until the mandatory ones before it are done."
          />
          <Toggle
            checked={form.requiresCertificate}
            onChange={(v) => set("requiresCertificate", v)}
            label="Award a certificate on completion"
            hint="Generated automatically once every mandatory lesson is complete."
          />
          <Toggle
            checked={form.active}
            onChange={(v) => set("active", v)}
            label="Active"
            hint="An inactive path cannot be assigned."
          />
        </fieldset>

        {failure && (
          <p role="alert" className="text-xs text-error-600 font-medium">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={saving} disabled={!form.name.trim()}>
            Create path
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A labelled checkbox with a hint. Used by several Academy forms. */
export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
      />
      <span className="min-w-0">
        <span className="block text-sm text-slate-800">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

export default CatalogueTab;
