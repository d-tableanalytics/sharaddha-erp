import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";

import { HrmsDataTable } from "../../components/hrms/HrmsDataTable";
import { FilterBar } from "../../components/hrms/FilterBar";
import { PageHeader } from "../../components/common/PageHeader";
import { Button } from "../../components/ui/Button";
import { useUserStore } from "../../store/userStore";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import {
  o2dApi,
  ORDER_STATUS_LABELS,
  HOLD_REASON_LABELS,
  formatDate,
  formatDateTime,
  formatRelative,
} from "../../services/o2d/orders";
import { O2dApiError } from "../../services/o2d/client";
import { OrderDrawer } from "./OrderDrawer";
import { AnalyticsTab } from "./AnalyticsTab";
import { StagesTab } from "./StagesTab";
import { OrderStatusBadge, BucketBadge } from "./o2dShared";
import { ORDER_STATUS, o2dRoute } from "@shared/constants/o2d.js";

/**
 * Order-to-Dispatch, as three tabs over one dataset.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TABLE COMPONENTS ARE THE HRMS ONES
 * ---------------------------------------------------------------------------
 *
 * `HrmsDataTable` and `FilterBar` are named for the module that happened to
 * need them first; neither knows anything about HRMS. They are server-paginated,
 * they render a skeleton while loading and an error state that reads
 * `error.isForbidden`, which `O2dApiError` also answers. Copying them under an
 * O2D name would be two components to fix the next time pagination changes.
 *
 * ---------------------------------------------------------------------------
 * THE TAB IS IN THE URL
 * ---------------------------------------------------------------------------
 *
 * `/fms/o2d/:tab` — so a link to the Exit Register survives being pasted into chat,
 * and the back button moves between tabs the way a user expects. Same shape the
 * HRMS tabbed modules use.
 */

const PAGE_SIZE = 25;

export function O2dPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);

  const canCreate = hasPermission(user, PERMISSIONS.CREATE_O2D_ORDER);

  /**
   * The tabs this account can actually use.
   *
   * Everything here needs VIEW_O2D, which the route already checked — so the
   * list is the same for every viewer today. It is computed rather than
   * hardcoded because the analytics tab lands in P5 behind its own permission,
   * and a hardcoded array is what gets forgotten then.
   */
  const tabs = useMemo(
    () => [
      { key: "tasks", label: "My Tasks" },
      { key: "orders", label: "Order Tracker" },
      // Every stage, as its own tab, one level down — see StagesTab for why the
      // twelve are a second row rather than twelve more tabs up here.
      { key: "stages", label: "Stages" },
      { key: "exits", label: "Exit Register" },
      // Its own permission, not VIEW_O2D. Seeing the orders you work is a
      // different thing from seeing how fast each team closes them, and the
      // server refuses the endpoint either way — this only decides whether the
      // tab is offered, so nobody clicks into a 403.
      ...(hasPermission(user, PERMISSIONS.VIEW_O2D_ANALYTICS)
        ? [{ key: "analytics", label: "Analytics" }]
        : []),
    ],
    [user],
  );

  const activeTab = tabs.some((t) => t.key === tab) ? tab : null;

  // An unknown or absent tab redirects rather than rendering nothing, so a
  // bare /o2d and a typo both land somewhere real.
  if (!activeTab) return <Navigate to={o2dRoute("tasks")} replace />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="FMS — Order to Dispatch"
        subtitle="Every customer PO, from receipt to the AWB."
        actions={
          canCreate && (
            <Button size="sm" onClick={() => navigate(o2dRoute("orders", "new"))}>
              New order
            </Button>
          )
        }
      />

      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            onClick={() => navigate(o2dRoute(t.key))}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === t.key
                ? "border-b-2 border-primary-600 text-primary-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "tasks" && <MyTasksTab />}
      {activeTab === "orders" && <OrderTrackerTab />}
      {activeTab === "stages" && <StagesTab />}
      {activeTab === "exits" && <ExitRegisterTab />}
      {activeTab === "analytics" && <AnalyticsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Tasks
// ---------------------------------------------------------------------------

function MyTasksTab() {
  const [rows, setRows] = useState({ data: [], total: 0 });
  const [counts, setCounts] = useState(null);
  const [bucket, setBucket] = useState(undefined);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, c] = await Promise.all([
        o2dApi.myTasks({ page, pageSize: PAGE_SIZE, bucket, search: search || undefined }),
        o2dApi.taskCounts(),
      ]);
      setRows(list);
      setCounts(c);
    } catch (err) {
      setError(err instanceof O2dApiError ? err : new O2dApiError(err.message));
    } finally {
      setLoading(false);
    }
  }, [page, bucket, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const columns = useMemo(
    () => [
      {
        header: "PO",
        cell: (row) => (
          <div>
            <p className="font-medium text-slate-900">{row.order?.poNumber ?? "—"}</p>
            <p className="text-xs text-slate-500">{row.order?.customerName}</p>
          </div>
        ),
      },
      {
        header: "Stage",
        cell: (row) => (
          <div>
            <p className="text-sm text-slate-900">
              {row.stageNumber}. {row.stageName}
            </p>
            <p className="text-xs text-slate-500">{row.ownerRole}</p>
          </div>
        ),
      },
      { header: "Due", cell: (row) => formatDateTime(row.plannedCompletion) },
      {
        header: "",
        cell: (row) => <BucketBadge bucket={row.bucket} />,
      },
      {
        header: "",
        cell: (row) =>
          /*
            The distinction the backend draws and the screen must not blur: a
            stage you OWN but somebody else records is visible, not closeable.
          */
          row.actionable ? (
            <span className="text-xs font-medium text-primary-700">Yours to complete</span>
          ) : (
            <span className="text-xs text-slate-400">Waiting on another team</span>
          ),
      },
    ],
    [],
  );

  return (
    <>
      {counts && (
        <div className="flex flex-wrap gap-2">
          {[
            { key: undefined, label: `All ${counts.total}` },
            { key: "overdue", label: `Overdue ${counts.overdue}` },
            { key: "due_soon", label: `Due soon ${counts.dueSoon}` },
            { key: "on_track", label: `On track ${counts.onTrack}` },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => {
                setBucket(chip.key);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                bucket === chip.key
                  ? "border-primary-600 bg-primary-50 text-primary-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by PO or customer…"
        onReset={() => {
          setSearch("");
          setBucket(undefined);
          setPage(1);
        }}
      />

      <HrmsDataTable
        columns={columns}
        rows={rows.data}
        loading={loading}
        error={error}
        onRetry={load}
        page={page}
        pageSize={PAGE_SIZE}
        total={rows.total}
        onPageChange={setPage}
        rowKey={(row) => row._id}
        onRowClick={(row) => setOpenId(row.order?._id)}
        emptyTitle="Nothing waiting on you"
        emptyDescription="No open stage is assigned to your role right now."
      />

      {openId && (
        <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Order Tracker
// ---------------------------------------------------------------------------

function OrderTrackerTab() {
  const [rows, setRows] = useState({ data: [], total: 0 });
  const [filters, setFilters] = useState({ status: undefined, overdueOnly: false });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sortBy: "poDate", sortDir: "desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(
        await o2dApi.list({
          page,
          pageSize: PAGE_SIZE,
          search: search || undefined,
          status: filters.status || undefined,
          // Sent only when true: the backend coerces the string "false" to
          // boolean true, so an always-present flag would pin the filter on.
          ...(filters.overdueOnly ? { overdueOnly: true } : {}),
          ...sort,
        }),
      );
    } catch (err) {
      setError(err instanceof O2dApiError ? err : new O2dApiError(err.message));
    } finally {
      setLoading(false);
    }
  }, [page, search, filters, sort]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const columns = useMemo(
    () => [
      {
        header: "PO",
        accessorKey: "poNumber",
        sortable: false,
        cell: (row) => (
          <div>
            <p className="font-medium text-slate-900">{row.poNumber}</p>
            <p className="text-xs text-slate-500">{row.customerName}</p>
          </div>
        ),
      },
      { header: "PO date", cell: (row) => formatDate(row.poDate) },
      {
        header: "Stage",
        cell: (row) => <span className="text-sm text-slate-700">{row.currentStage} / 12</span>,
      },
      { header: "Status", cell: (row) => <OrderStatusBadge status={row.status} /> },
      {
        header: "Promise",
        cell: (row) =>
          row.promiseDate ? (
            <div>
              <p className="text-sm">{formatDate(row.promiseDate)}</p>
              <p className="text-xs text-slate-500">{formatRelative(row.promiseDate)}</p>
            </div>
          ) : (
            <span className="text-xs text-amber-700">None — overridden</span>
          ),
      },
      { header: "Dispatched", cell: (row) => formatDate(row.dispatchedAt) },
    ],
    [],
  );

  return (
    <>
      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by PO, customer or invoice…"
        filters={[
          {
            key: "status",
            placeholder: "Status",
            options: Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          },
        ]}
        values={filters}
        onChange={(key, value) => {
          setFilters((f) => ({ ...f, [key]: value }));
          setPage(1);
        }}
        onReset={() => {
          setFilters({ status: undefined, overdueOnly: false });
          setSearch("");
          setPage(1);
        }}
      >
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={filters.overdueOnly}
            onChange={(e) => {
              setFilters((f) => ({ ...f, overdueOnly: e.target.checked }));
              setPage(1);
            }}
          />
          Overdue only
        </label>
      </FilterBar>

      <HrmsDataTable
        columns={columns}
        rows={rows.data}
        loading={loading}
        error={error}
        onRetry={load}
        page={page}
        pageSize={PAGE_SIZE}
        total={rows.total}
        onPageChange={setPage}
        sortBy={sort.sortBy}
        sortDir={sort.sortDir}
        onSortChange={(sortBy, sortDir) => setSort({ sortBy, sortDir })}
        rowKey={(row) => row._id}
        onRowClick={(row) => setOpenId(row._id)}
        emptyTitle="No orders match"
        emptyDescription="Try widening the filters, or check the Exit Register for cancelled orders."
      />

      {openId && (
        <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Exit Register
// ---------------------------------------------------------------------------

function ExitRegisterTab() {
  const [rows, setRows] = useState({ data: [], total: 0 });
  const [filters, setFilters] = useState({ exitType: undefined, includeRevived: false });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(
        await o2dApi.exitRegister({
          page,
          pageSize: PAGE_SIZE,
          exitType: filters.exitType || undefined,
          ...(filters.includeRevived ? { includeRevived: true } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof O2dApiError ? err : new O2dApiError(err.message));
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(
    () => [
      {
        header: "PO",
        cell: (row) => (
          <div>
            <p className="font-medium text-slate-900">{row.poNumber}</p>
            <p className="text-xs text-slate-500">{row.customerName}</p>
          </div>
        ),
      },
      {
        header: "What happened",
        cell: (row) => (
          <div>
            <OrderStatusBadge status={row.exitType} />
            {row.revivedAt && <span className="ml-1 text-xs text-slate-500">· revived</span>}
          </div>
        ),
      },
      {
        header: "At stage",
        cell: (row) => (
          <span className="text-sm text-slate-700">
            {row.stageAtExit}
            {row.stageNameAtExit ? `. ${row.stageNameAtExit}` : ""}
          </span>
        ),
      },
      {
        header: "Reason",
        cell: (row) => (
          <span className="text-sm text-slate-700">
            {/* A hold's reason is an enum; a cancellation's is free text. */}
            {HOLD_REASON_LABELS[row.reason] ?? row.reason ?? "—"}
            {row.remarks && <span className="block text-xs text-slate-500">{row.remarks}</span>}
          </span>
        ),
      },
      {
        header: "When",
        cell: (row) => (
          <div>
            <p className="text-sm">{formatDateTime(row.at)}</p>
            {row.byName && <p className="text-xs text-slate-500">{row.byName}</p>}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <FilterBar
        filters={[
          {
            key: "exitType",
            placeholder: "Type",
            options: [
              { value: ORDER_STATUS.ON_HOLD, label: "On hold" },
              { value: ORDER_STATUS.CANCELLED, label: "Cancelled" },
              { value: ORDER_STATUS.VOID, label: "Void (entry error)" },
            ],
          },
        ]}
        values={filters}
        onChange={(key, value) => {
          setFilters((f) => ({ ...f, [key]: value }));
          setPage(1);
        }}
        onReset={() => {
          setFilters({ exitType: undefined, includeRevived: false });
          setPage(1);
        }}
      >
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={filters.includeRevived}
            onChange={(e) => {
              setFilters((f) => ({ ...f, includeRevived: e.target.checked }));
              setPage(1);
            }}
          />
          Include revived
        </label>
      </FilterBar>

      <HrmsDataTable
        columns={columns}
        rows={rows.data}
        loading={loading}
        error={error}
        onRetry={load}
        page={page}
        pageSize={PAGE_SIZE}
        total={rows.total}
        onPageChange={setPage}
        rowKey={(row) => row.registerId ?? `hold-${row.orderId}`}
        onRowClick={(row) => setOpenId(row.orderId)}
        emptyTitle="Nothing has left the workflow"
        emptyDescription="No order is on hold, cancelled or void."
      />

      {openId && (
        <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </>
  );
}

export default O2dPage;
