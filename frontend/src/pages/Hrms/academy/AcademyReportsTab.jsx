import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";

import { TabNav } from "../../../components/hrms/TabNav";
import { HrmsDataTable } from "../../../components/hrms/HrmsDataTable";
import { SearchableSelect } from "../../../components/hrms/SearchableSelect";
import { Button } from "../../../components/ui/Button";
import { departmentsApi } from "../../../services/hrms/org";
import { academyReportsApi, pathsApi, formatDay } from "../../../services/hrms/academy";
import { PercentBar, AcademyStatusBadge } from "./academyShared";

const REPORTS = [
  { key: "path-completion", label: "Learning path completion" },
  { key: "employee-status", label: "Employee training status" },
];

/**
 * The two reports section 14 describes.
 *
 * Both are run server-side and aggregated in the database; this screen renders
 * the rows and offers a CSV. Exporting is audited on the server — the report
 * service records the filters and the row count, never the rows.
 */
export function AcademyReportsTab() {
  const [report, setReport] = useState("path-completion");
  const [filters, setFilters] = useState({});
  const [paths, setPaths] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        pathId: filters.pathId ?? undefined,
        departmentId: filters.departmentId ?? undefined,
        status: filters.status ?? undefined,
      };
      setData(
        report === "path-completion"
          ? await academyReportsApi.pathCompletion(params)
          : await academyReportsApi.employeeStatus(params),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [report, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      pathsApi.list({ pageSize: 200 }).then((r) => r.data ?? []),
      departmentsApi.list().catch(() => []),
    ])
      .then(([p, d]) => {
        setPaths(p);
        setDepartments(Array.isArray(d) ? d : (d?.data ?? []));
      })
      .catch(() => {});
  }, []);

  /**
   * CSV, built in the browser from rows already on screen.
   *
   * No extra request, and no server-side export endpoint to secure: whatever
   * the caller could see is what they can download, by construction. Values are
   * quoted and inner quotes doubled, so a path name containing a comma does not
   * shift every column after it.
   */
  const download = () => {
    if (!data?.rows?.length) return;
    const columns = Object.keys(data.rows[0]);
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      columns.join(","),
      ...data.rows.map((row) => columns.map((c) => escape(row[c])).join(",")),
    ].join("\r\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `si-academy-${report}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pathColumns = [
    { header: "Learning path", accessorKey: "pathName" },
    {
      header: "Assigned",
      cell: (r) => <span className="tabular-nums text-sm">{r.assigned}</span>,
      className: "text-center",
    },
    {
      header: "Completed",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold text-success-600">{r.completed}</span>
      ),
      className: "text-center",
    },
    {
      header: "In progress",
      cell: (r) => <span className="tabular-nums text-sm">{r.inProgress}</span>,
      className: "text-center",
    },
    {
      header: "Overdue",
      cell: (r) => (
        <span
          className={`tabular-nums text-sm ${r.overdue > 0 ? "font-semibold text-error-600" : ""}`}
        >
          {r.overdue}
        </span>
      ),
      className: "text-center",
    },
    {
      header: "Completion",
      cell: (r) => (
        <div className="flex items-center gap-2 min-w-[140px]">
          <PercentBar percent={r.completionPercent} size="sm" className="flex-1" />
          <span className="text-xs font-bold tabular-nums">{r.completionPercent}%</span>
        </div>
      ),
    },
  ];

  const employeeColumns = [
    { header: "Employee", accessorKey: "employeeName" },
    {
      header: "Department",
      cell: (r) => <span className="text-xs text-slate-600">{r.department ?? "—"}</span>,
    },
    { header: "Learning path", accessorKey: "pathName" },
    {
      header: "Progress",
      cell: (r) => (
        <div className="flex items-center gap-2 min-w-[130px]">
          <PercentBar
            percent={r.percent}
            size="sm"
            tone={r.overdue ? "danger" : undefined}
            className="flex-1"
          />
          <span className="text-xs font-bold tabular-nums">{r.percent}%</span>
        </div>
      ),
    },
    {
      header: "Due",
      cell: (r) => (
        <span className={`text-xs ${r.overdue ? "text-error-600 font-semibold" : "text-slate-600"}`}>
          {r.dueDate ? formatDay(r.dueDate) : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <AcademyStatusBadge status={r.status} dueState={r.overdue ? "overdue" : undefined} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <TabNav
        tabs={REPORTS}
        activeKey={report}
        onChange={(key) => setReport(key)}
        className="mb-1"
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <SearchableSelect
            value={filters.pathId ?? null}
            onChange={(v) => setFilters((f) => ({ ...f, pathId: v }))}
            options={paths.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="All learning paths"
          />
        </div>
        <div className="w-48">
          <SearchableSelect
            value={filters.departmentId ?? null}
            onChange={(v) => setFilters((f) => ({ ...f, departmentId: v }))}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="All departments"
          />
        </div>
        {report === "employee-status" && (
          <div className="w-44">
            <SearchableSelect
              value={filters.status ?? null}
              onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              options={[
                { value: "assigned", label: "Not started" },
                { value: "in_progress", label: "In progress" },
                { value: "completed", label: "Completed" },
              ]}
              placeholder="Any status"
            />
          </div>
        )}

        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!data?.rows?.length}
          onClick={download}
        >
          <Download size={14} className="mr-1.5" />
          Export CSV
        </Button>
      </div>

      {data && (
        <p className="text-[11px] text-slate-400">
          {data.rows.length} row{data.rows.length === 1 ? "" : "s"} · generated{" "}
          {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}

      <HrmsDataTable
        columns={report === "path-completion" ? pathColumns : employeeColumns}
        rows={data?.rows ?? []}
        loading={loading}
        error={error}
        onRetry={load}
        // Reports are returned whole rather than paged — the server caps the
        // employee report at 5,000 rows, which is the export ceiling.
        page={1}
        pageSize={data?.rows?.length || 1}
        total={data?.rows?.length ?? 0}
        rowKey={(row) => row.assignmentId ?? row.pathId}
        emptyTitle="Nothing to report"
        emptyDescription="No assignments match these filters."
      />
    </div>
  );
}

export default AcademyReportsTab;
