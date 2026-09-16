import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, XCircle } from "lucide-react";

import { HrmsDataTable } from "../../../components/hrms/HrmsDataTable";
import { FilterBar } from "../../../components/hrms/FilterBar";
import { SearchableSelect } from "../../../components/hrms/SearchableSelect";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { employeesApi } from "../../../services/hrms/employees";
import { assignmentsApi, pathsApi, formatDay } from "../../../services/hrms/academy";
import { ProgressRow, AcademyStatusBadge, DueLabel } from "./academyShared";

const PAGE_SIZE = 25;

/**
 * Employee training status — the admin assignment queue.
 *
 * Section 14's "Employee | Learning Path | Progress | Due Date | Status" table,
 * plus the manual assignment flow section 12 describes.
 *
 * `overdue` is a FILTER here and not a column value, because it is not a stored
 * status: the server turns it into a date comparison. The badge shows it
 * because to a person reading the row it is the status that matters.
 */
export function AssignmentsTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "" });
  const [data, setData] = useState({ data: [], total: 0 });
  const [paths, setPaths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await assignmentsApi.list({
          page,
          pageSize: PAGE_SIZE,
          search: filters.search || undefined,
          status: filters.status ?? undefined,
          pathId: filters.pathId ?? undefined,
          overdue: filters.overdue ? true : undefined,
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

  useEffect(() => {
    // The path list feeds the filter and the assign modal. Loaded once.
    pathsApi
      .list({ pageSize: 200, active: true })
      .then((r) => setPaths(r.data ?? []))
      .catch(() => setPaths([]));
  }, []);

  const columns = [
    {
      header: "Employee",
      accessorKey: "employeeName",
      cell: (row) => (
        <Link
          to={`${HRMS_ROUTE_PREFIX}/academy/learn/${row.id}`}
          className="text-sm font-semibold text-slate-900 hover:text-primary-700 hover:underline"
        >
          {row.employeeName}
        </Link>
      ),
    },
    {
      header: "Learning path",
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-sm text-slate-700 truncate">{row.pathName}</p>
          <p className="text-[11px] text-slate-400">
            {row.source === "rule" ? `Rule: ${row.ruleName ?? "—"}` : "Assigned manually"}
          </p>
        </div>
      ),
    },
    {
      header: "Progress",
      cell: (row) => (
        <ProgressRow
          percent={row.percent}
          completed={row.completedLessons}
          total={row.totalLessons}
          tone={row.dueState === "overdue" ? "danger" : undefined}
          className="min-w-[160px]"
        />
      ),
    },
    {
      header: "Due",
      cell: (row) => (
        <div>
          <DueLabel dueState={row.dueState} dueLabel={row.dueLabel} dueDate={row.dueDate} />
          {row.dueDate && (
            <p className="text-[11px] text-slate-400">{formatDay(row.dueDate)}</p>
          )}
        </div>
      ),
    },
    {
      header: "Status",
      cell: (row) => <AcademyStatusBadge status={row.status} dueState={row.dueState} />,
    },
    {
      header: "",
      cell: (row) =>
        row.status === "cancelled" ? null : (
          <Button
            size="xs"
            variant="ghost"
            data-no-row-click
            onClick={() => setCancelling(row)}
            aria-label={`Cancel ${row.pathName} for ${row.employeeName}`}
          >
            <XCircle size={13} className="text-slate-400" />
          </Button>
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
          searchPlaceholder="Search employee or path…"
          filters={[
            {
              key: "pathId",
              placeholder: "Learning path",
              options: paths.map((p) => ({ value: p.id, label: p.name })),
            },
            {
              key: "status",
              placeholder: "Status",
              options: [
                { value: "assigned", label: "Not started" },
                { value: "in_progress", label: "In progress" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
              ],
            },
            {
              key: "overdue",
              placeholder: "Overdue",
              options: [{ value: true, label: "Overdue only" }],
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

        <Button size="sm" onClick={() => setAssigning(true)}>
          <Plus size={15} className="mr-1.5" />
          Assign a path
        </Button>
      </div>

      {notice && (
        <div
          role="status"
          className="p-3 rounded-lg bg-primary-50 border border-primary-200 text-xs text-primary-800"
        >
          {notice}
        </div>
      )}

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
        emptyTitle="Nothing assigned yet"
        emptyDescription="Assign a learning path to somebody, or set up a rule that assigns one automatically when a new employee is created."
      />

      {assigning && (
        <AssignModal
          paths={paths}
          onClose={() => setAssigning(false)}
          onAssigned={(result) => {
            setAssigning(false);
            setNotice(summarise(result));
            load();
          }}
        />
      )}

      {cancelling && (
        <CancelModal
          assignment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Turn the per-employee outcome into one sentence.
 *
 * The API reports each employee separately rather than failing the batch, so a
 * bulk assign to forty people of whom three already had the path succeeds for
 * thirty-seven — and this is where that gets explained rather than silently
 * looking like a partial failure.
 */
function summarise(result) {
  const parts = [`${result.assigned} assigned`];
  const already = result.skipped.filter((s) => s.reason === "ALREADY_ASSIGNED").length;
  const inactive = result.skipped.filter((s) => s.reason === "EMPLOYEE_NOT_ACTIVE").length;
  if (already > 0) parts.push(`${already} already had it`);
  if (inactive > 0) parts.push(`${inactive} skipped (not active)`);
  return `${parts.join(", ")}.`;
}

/** Manual assignment: pick employees, pick a path, optionally override the due date. */
function AssignModal({ paths, onClose, onAssigned }) {
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState([]);
  const [pathId, setPathId] = useState(null);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    employeesApi
      .list({ pageSize: 200 })
      .then((r) => setEmployees(r.data ?? []))
      .catch(() => setEmployees([]));
  }, []);

  const path = paths.find((p) => p.id === pathId);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const result = await assignmentsApi.create({
        employeeIds: selected,
        pathId,
        dueDate: dueDate || null,
      });
      onAssigned(result);
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  const add = (id) => {
    if (id && !selected.includes(id)) setSelected((s) => [...s, id]);
  };

  return (
    <Modal isOpen onClose={onClose} title="Assign a learning path" size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="w-full flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-700">Learning path</label>
          <SearchableSelect
            value={pathId}
            onChange={setPathId}
            options={paths.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Choose a path…"
          />
          {path && (
            <span className="text-[11px] text-slate-500">
              {path.courseCount} course{path.courseCount === 1 ? "" : "s"} ·{" "}
              {path.mandatory ? "Mandatory" : "Optional"}
              {path.requiresCertificate && " · Awards a certificate"}
            </span>
          )}
        </div>

        <div className="w-full flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-700">Employees</label>
          <SearchableSelect
            value={null}
            onChange={add}
            options={employees
              .filter((e) => !selected.includes(e.id))
              .map((e) => ({
                value: e.id,
                label: `${e.firstName} ${e.lastName} — ${e.employeeCode}`,
              }))}
            placeholder="Add an employee…"
          />

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {selected.map((id) => {
                const person = employees.find((e) => e.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelected((s) => s.filter((x) => x !== id))}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full transition-colors"
                  >
                    {person ? `${person.firstName} ${person.lastName}` : id}
                    <XCircle size={12} />
                  </button>
                );
              })}
            </div>
          )}
          <span className="text-[11px] text-slate-500">
            {selected.length} selected. Anyone who already has this path is skipped rather than
            duplicated.
          </span>
        </div>

        <Input
          label="Due date (optional)"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          helperText={
            path && path.dueDateMode !== "none"
              ? "Leave blank to use the path's own due-date rule, which is computed per employee."
              : "This path has no due-date rule, so leaving this blank means no deadline."
          }
        />

        {failure && (
          <p role="alert" className="text-xs text-error-600 font-medium">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={saving}
            disabled={!pathId || selected.length === 0}
          >
            Assign to {selected.length || "…"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Cancel an assignment.
 *
 * Says plainly what cancelling does and does not do — the progress record
 * survives, and the path can be assigned again — because "cancel" reads as
 * "delete" to most people, and this one is neither.
 */
function CancelModal({ assignment, onClose, onCancelled }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      await assignmentsApi.cancel(assignment.id, reason.trim() || undefined);
      onCancelled();
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Cancel this assignment?" size="md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-800">{assignment.employeeName}</span> will no
          longer owe <span className="font-semibold text-slate-800">{assignment.pathName}</span>.
          Their progress so far ({assignment.percent}%) is kept as a record, and the path can be
          assigned to them again later.
        </p>

        <Input
          label="Reason (optional)"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Changed role, no longer required…"
        />

        {failure && (
          <p role="alert" className="text-xs text-error-600 font-medium">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Keep it
          </Button>
          <Button type="submit" size="sm" variant="danger" loading={saving}>
            Cancel assignment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default AssignmentsTab;
