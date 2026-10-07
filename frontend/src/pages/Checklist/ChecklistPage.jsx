/**
 * Checklist Page — the primary interface for managing recurring compliance tasks.
 *
 * Adapts based on role: Admin/Manager users see management controls (view
 * switcher, bulk actions, routines/departments tabs), while regular doers see
 * a streamlined personal tasks-only view.
 *
 * Layout: Header → KPI Tiles → Filter Bar → Bulk Bar → Content → Footer
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useUserStore } from '../../store/userStore';
import {
  isAdmin as checkIsAdmin, isSuperAdmin, hasPermission, PERMISSIONS,
} from '../../utils/permissions';
import { checklistApi } from '../../services/checklist';
import { useChecklistBadgeStore } from '../../store/checklistBadgeStore';
import toast from 'react-hot-toast';

import { TasksTable, isO2dMirror } from './TasksTable';
import { StageTaskModal } from '../O2d/StageTaskModal';
import { RoutinesTable } from './RoutinesTable';
import { DepartmentScoreboard } from './DepartmentScoreboard';
import { KpiDrilldownDrawer } from './KpiDrilldownDrawer';
import {
  CompleteChecklistModal,
  NonFunctionalModal,
  ReassignChecklistModal,
  BuddyDetailsModal,
  RemarkModal,
  EditChecklistModal,
  CreateChecklistDrawer,
} from './ChecklistModals';

import {
  ClipboardList,
  Plus,
  Clock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Search,
  ListTree,
  Building2,
  MessageSquare,
  X,
  ChevronDown,
  RotateCcw,
} from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader';
import { Button } from '../../components/ui/Button';
import { StatTile } from '../../components/workqueue/StatTile';
import { usePermissions } from '../../hooks/usePermissions';

// ── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];
const FREQUENCIES = ['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const STATUSES = ['pending', 'overdue', 'completed', 'non-functional'];

const isManager = (user) =>
  isSuperAdmin(user) || checkIsAdmin(user) || ADMIN_ROLES.includes(user?.role);

// ── KPI Tile Config ──────────────────────────────────────────────────────────

const KPI_TILES = [
  { key: 'total',          label: 'Total',         icon: ClipboardList, tone: 'neutral' },
  { key: 'pendingToday',   label: 'Pending Today', icon: Clock,         tone: 'warning' },
  { key: 'overdue',        label: 'Overdue',       icon: AlertTriangle, tone: 'danger'  },
  { key: 'completed',      label: 'Completed',     icon: CheckCircle2,  tone: 'success' },
  { key: 'complianceRate', label: 'Compliance',    icon: TrendingUp,    tone: 'primary' },
];

// ═════════════════════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════════════════════

export function ChecklistPage() {
  const user = useUserStore((s) => s.user);

  /**
   * `admin` AND THE CELLS ANSWER DIFFERENT QUESTIONS. BOTH ARE NEEDED.
   *
   * `admin` is `isManager(user)` - a ROLE test - and what it actually decides
   * here is SCOPE: whose occurrences this screen lists, whether the Routines and
   * Departments tabs exist, whether the department and doer filters appear. The
   * server makes the same distinction independently in its own isManager
   * checks, so the two agree about what data comes back.
   *
   * What `admin` was ALSO doing, and should not have been, is deciding who may
   * act. Every button below - new checklist, complete, reassign, remark, stop a
   * routine - was either ungated or gated on that role test, which meant a
   * manager granted the checklist read-only could still stop a routine, and a
   * non-manager granted full checklist rights could not add a remark.
   *
   * So actions ask the matrix now, and `admin` keeps the scope question it was
   * always really answering.
   */
  const admin = isManager(user);

  const { can } = usePermissions();
  const canCreate = can('work_queue', 'checklist', 'create');
  const canEdit = can('work_queue', 'checklist', 'edit');
  const canStopRoutine = can('work_queue', 'checklist', 'delete');
  const canComplete = can('work_queue', 'checklist', 'approve');
  const canReassign = can('work_queue', 'assignment', 'edit');
  // O2D stages are worked under O2D's own permission, not the checklist's: the
  // server marks each O2D row `canComplete` from the O2D stage rules.
  const worksO2d = hasPermission(user, PERMISSIONS.VIEW_O2D) && hasPermission(user, PERMISSIONS.WORK_O2D_STAGE);
  const canCompleteRow = (task) => (isO2dMirror(task) ? task.canComplete === true : canComplete);

  // ── Data state ───────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({});
  const [routines, setRoutines] = useState([]);
  const [deptData, setDeptData] = useState(null);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [departments, setDepartments] = useState([]);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [view, setView] = useState('tasks');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  // The server pages the list (25 a page); the pager walks it.
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [doerFilter, setDoerFilter] = useState('');
  const [specificDate, setSpecificDate] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // ── Modals ───────────────────────────────────────────────────────────────
  const [completeModal, setCompleteModal] = useState(null);
  const [nonFuncModal, setNonFuncModal] = useState(null);
  const [reassignModal, setReassignModal] = useState(null);
  const [buddyModal, setBuddyModal] = useState(null);
  const [remarkModal, setRemarkModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [createDrawer, setCreateDrawer] = useState(false);
  const [drilldownKpi, setDrilldownKpi] = useState(null);
  const [activeKpi, setActiveKpi] = useState(null);

  // ── "New" tasks ──────────────────────────────────────────────────────────
  /** Rows that were new when this visit began — they keep their tag until the page is left. */
  const [sessionNewIds, setSessionNewIds] = useState(() => new Set());
  const clearChecklistBadge = useChecklistBadgeStore((s) => s.clear);

  // ── Active filter count ──────────────────────────────────────────────────
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (frequencyFilter) count++;
    if (statusFilter) count++;
    if (departmentFilter) count++;
    if (siteFilter) count++;
    if (doerFilter) count++;
    if (specificDate) count++;
    if (fromDate) count++;
    if (toDate) count++;
    return count;
  }, [search, frequencyFilter, statusFilter, departmentFilter, siteFilter, doerFilter, specificDate, fromDate, toDate]);

  const hasFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setSearch('');
    setFrequencyFilter('');
    setStatusFilter('');
    setDepartmentFilter('');
    setSiteFilter('');
    setDoerFilter('');
    setSpecificDate('');
    setFromDate('');
    setToDate('');
  };

  // ── Data loading ─────────────────────────────────────────────────────────
  const loadTasks = useCallback(async () => {
    try {
      const params = { site: selectedSite || undefined, page };
      if (search) params.search = search;
      if (frequencyFilter) params.frequency = frequencyFilter;
      if (statusFilter) params.status = statusFilter;
      if (departmentFilter) params.department = departmentFilter;
      if (siteFilter) params.site = siteFilter;
      if (doerFilter) params.doer = doerFilter;
      if (specificDate) params.specificDate = specificDate;
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;

      const [tasksData, summaryData] = await Promise.all([
        checklistApi.getTasks(params),
        checklistApi.getSummary({ site: selectedSite || undefined }),
      ]);

      const rows = tasksData?.tasks || [];
      setTasks(rows);
      setPageInfo({ total: tasksData?.total ?? rows.length, pages: Math.max(1, tasksData?.pages ?? 1) });
      setSummary(summaryData || {});

      /*
       * Opening the Checklist is what makes its tasks no longer new. The rows
       * already came back tagged (the server compared them with the previous
       * visit), and the tags are remembered for this visit so a reload after
       * completing one does not strip the rest.
       */
      const fresh = rows.filter((t) => t.isNew).map((t) => String(t._id));
      if (fresh.length > 0) setSessionNewIds((prev) => new Set([...prev, ...fresh]));
      await checklistApi.markSeen();
      clearChecklistBadge();
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  }, [page, selectedSite, search, frequencyFilter, statusFilter, departmentFilter, siteFilter, doerFilter, specificDate, fromDate, toDate, clearChecklistBadge]);

  // A changed filter starts again from page one — page 4 of the old result
  // may not exist in the new one.
  useEffect(() => {
    setPage(1);
  }, [selectedSite, search, frequencyFilter, statusFilter, departmentFilter, siteFilter, doerFilter, specificDate, fromDate, toDate]);

  const loadRoutines = useCallback(async () => {
    if (!admin) return;
    try {
      const data = await checklistApi.getRoutines({ site: selectedSite || undefined, search });
      setRoutines(data || []);
    } catch (err) {
      console.error('Failed to load routines:', err);
    }
  }, [admin, selectedSite, search]);

  const loadDepartments = useCallback(async () => {
    if (!admin) return;
    try {
      const data = await checklistApi.getDepartments({ site: selectedSite || undefined });
      setDeptData(data || null);
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  }, [admin, selectedSite]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadTasks(),
        view === 'routines' ? loadRoutines() : Promise.resolve(),
        view === 'departments' ? loadDepartments() : Promise.resolve(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadTasks, loadRoutines, loadDepartments, view]);

  // Initial load
  useEffect(() => {
    const init = async () => {
      try {
        const [locs, depts] = await Promise.all([
          checklistApi.getLocations(),
          checklistApi.getDepartmentsList(),
        ]);
        setLocations(locs || []);
        setDepartments(depts || []);

        if (admin) {
          const u = await checklistApi.getUsers();
          setUsers(u || []);
        }
      } catch (err) {
        console.error('Init error:', err);
      }
    };
    init();
  }, [admin]);

  useEffect(() => { load(); }, [load]);

  // Reload on filter changes (debounced search)
  useEffect(() => {
    const timer = setTimeout(() => { loadTasks(); }, 300);
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when view changes
  useEffect(() => {
    if (view === 'routines') loadRoutines();
    if (view === 'departments') loadDepartments();
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleSuccess = () => {
    load();
    setSelectedIds([]);
  };

  // ── Selection ────────────────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (ids) => {
    const allSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : ids);
  };

  // ── KPI drilldown handler ──────────────────────────────────────────────
  const handleKpiClick = (kpiKey) => {
    if (activeKpi === kpiKey) {
      setActiveKpi(null);
      setDrilldownKpi(null);
    } else {
      setActiveKpi(kpiKey);
      setDrilldownKpi(kpiKey);
    }
  };

  const handleShowInList = (kpiKey) => {
    if (kpiKey === 'overdue') setStatusFilter('overdue');
    else if (kpiKey === 'pending' || kpiKey === 'pendingToday') setStatusFilter('pending');
    else if (kpiKey === 'completed') setStatusFilter('completed');
    else clearFilters();
    setView('tasks');
  };

  // ── Handle department "View tasks" ────────────────────────────────────
  const handleViewDepartmentTasks = (dept) => {
    setDepartmentFilter(dept);
    setView('tasks');
  };

  // ── Routine actions ────────────────────────────────────────────────────
  const handleStopRoutine = async (routine) => {
    // Stopping removes every future occurrence nobody has worked yet.
    if (!window.confirm(`Stop "${routine.taskName}"? Its future tasks will be removed. Today's task and past records stay.`)) return;
    try {
      const res = await checklistApi.stopRoutine(routine._id);
      const removed = res?.futureRemoved ?? 0;
      toast.success(removed > 0 ? `Routine stopped — ${removed} future task(s) removed` : 'Routine stopped');
      loadRoutines();
      loadTasks();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to stop routine');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col gap-6 pb-10">

      {/* ── 1. Header Bar ────────────────────────────────────────────── */}
      {/*
        The shared PageHeader, as O2D and every HRMS page use it. It carries the
        title, the description line and the right-aligned actions, and draws the
        bottom rule every other page in the portal ends its header with.

        The 40px icon tile is dropped: no other page in the portal puts an icon
        beside its title, and the sidebar already marks which page this is.
      */}
      <PageHeader
        title="Checklist"
        subtitle="Recurring compliance tasks — generated ahead, tracked to completion"
        actions={
          <>
          {/* Site switcher */}
          {locations.length > 1 && (
            <div className="bg-slate-100 rounded-lg p-1 border border-slate-200 flex items-center gap-1 shadow-enterprise">
              {locations.map((site) => (
                <button
                  key={site}
                  type="button"
                  onClick={() => setSelectedSite(site === selectedSite ? '' : site)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedSite === site
                      ? 'bg-primary-600 text-white shadow-enterprise'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
                >
                  {site}
                </button>
              ))}
            </div>
          )}


          {/* New checklist CTA */}
          {canCreate && (
            <Button size="sm" onClick={() => setCreateDrawer(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {admin ? 'New Checklist' : 'Add Task'}
            </Button>
          )}
          </>
        }
      />

      {/* ── 2. KPI Stat Tiles ────────────────────────────────────────── */}
      {/*
        The HR Dashboard's Quick Access tile, carrying a count: same shell, same
        40px toned chip, same label type, same `gap-3` grid. `StatTile` is that
        component, shared with the other four Work Queue screens.

        Compliance is a READ-OUT, not a filter — there is no list of "rate" rows
        to drill into — so it gets no onClick and StatTile renders it inert.
      */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {KPI_TILES.map((tile) => {
          const drillable = tile.key !== 'complianceRate';
          const value = tile.key === 'complianceRate'
            ? `${summary[tile.key] || 0}%`
            : (summary[tile.key] ?? 0);

          return (
            <StatTile
              key={tile.key}
              icon={tile.icon}
              tone={tile.tone}
              label={tile.label}
              value={value}
              active={activeKpi === tile.key}
              note={
                tile.key === 'pendingToday' && summary.carriedOver > 0
                  ? `${summary.carriedOver} carried over`
                  : undefined
              }
              title={drillable ? `Show ${tile.label.toLowerCase()}` : undefined}
              onClick={drillable ? () => handleKpiClick(tile.key) : undefined}
            />
          );
        })}
      </div>

      {/* ── 3. Filter Bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* View switcher (admin only) */}
        {admin && (
          <div className="bg-slate-100 rounded-lg p-1 border border-slate-200 flex items-center gap-1 shadow-enterprise shrink-0">
            {[
              { key: 'tasks',       label: 'Tasks',       icon: ClipboardList },
              { key: 'routines',    label: 'Routines',    icon: ListTree },
              { key: 'departments', label: 'Departments', icon: Building2 },
            ].map((tab) => {
              const TabIcon = tab.icon;
              const isCurrent = view === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setView(tab.key)}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-primary-600 text-white shadow-enterprise'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search checklist tasks..."
            className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {/* Frequency */}
        <div className="relative shrink-0">
          <select
            value={frequencyFilter}
            onChange={(e) => setFrequencyFilter(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Frequencies</option>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>{f === 'once' ? 'One-time' : f.charAt(0).toUpperCase() + f.slice(1)}</option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Status */}
        <div className="relative shrink-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'non-functional' ? 'Non-Functional' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Department filter (admin only) */}
        {admin && departments.length > 0 && (
          <div className="relative shrink-0">
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}

        {/* Site filter */}
        {locations.length > 0 && (
          <div className="relative shrink-0">
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            >
              <option value="">All Sites</option>
              {locations.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}

        {/* Doer filter (admin only) */}
        {admin && users.length > 0 && (
          <div className="relative shrink-0">
            <select
              value={doerFilter}
              onChange={(e) => setDoerFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            >
              <option value="">All Doers</option>
              {users.map((u) => (
                <option key={u._id} value={u._id}>{u.user || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}

        {/* Date filters */}
        <input
          type="date"
          value={specificDate}
          onChange={(e) => setSpecificDate(e.target.value)}
          title="Specific date"
          className={`px-3 py-2 text-sm bg-white border rounded-lg shadow-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all cursor-pointer ${
            specificDate ? 'border-primary-600 ring-2 ring-primary-500/20' : 'border-slate-200 hover:border-slate-300'
          }`}
        />

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={!!specificDate}
            title="From"
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 cursor-pointer disabled:opacity-50"
          />
          <span className="text-xs font-bold text-slate-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            disabled={!!specificDate}
            title="To"
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 cursor-pointer disabled:opacity-50"
          />
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            title="Clear all filters"
            className="inline-flex items-center justify-center gap-2 font-medium rounded-lg px-3 py-1.5 text-xs bg-transparent border border-slate-300 hover:bg-slate-50 text-slate-700 transition-all active:scale-[0.98] shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear ({activeFilterCount})</span>
          </button>
        )}
      </div>

      {/* ── 4. Bulk Action Bar ───────────────────────────────────────── */}
      {admin && canEdit && selectedIds.length > 0 && (
        <div className="flex items-center justify-between px-5 py-3 bg-primary-600 text-white rounded-xl shadow-enterprise-lg animate-in slide-in-from-top-2 duration-200">
          <span className="text-xs font-bold">{selectedIds.length} tasks selected</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRemarkModal(selectedIds)}
              className="px-3.5 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Add Remark</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-3.5 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── 5. Content Area ──────────────────────────────────────────── */}
      {/*
        The four handlers below are WITHHELD rather than gated inside the row:
        TasksTable renders each control only when it is handed a handler, so a
        viewer's rows come back without the control rather than with one that
        403s on click.
      */}
      {view === 'tasks' && (
        <TasksTable
          tasks={tasks}
          loading={loading}
          isAdmin={admin}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onComplete={canComplete || worksO2d ? (task) => setCompleteModal(task) : undefined}
          canCompleteRow={canCompleteRow}
          newIds={sessionNewIds}
          onRemark={canEdit ? (task) => setRemarkModal([task._id]) : undefined}
          onReassign={canReassign ? (task) => setReassignModal(task) : undefined}
          onNonFunctional={canComplete ? (task) => setNonFuncModal(task) : undefined}
          onShowBuddy={(task) => setBuddyModal(task)}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
          onCreateNew={canCreate ? () => setCreateDrawer(true) : undefined}
        />
      )}

      {view === 'routines' && admin && (
        <RoutinesTable
          routines={routines}
          loading={loading}
          onEdit={canEdit ? (routine) => setEditModal(routine) : undefined}
          onStop={canStopRoutine ? handleStopRoutine : undefined}
        />
      )}

      {view === 'departments' && admin && (
        <DepartmentScoreboard
          data={deptData}
          loading={loading}
          onViewTasks={handleViewDepartmentTasks}
        />
      )}

      {/* ── 6. Footer Count ──────────────────────────────────────────── */}
      {view === 'tasks' && tasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-semibold text-slate-500">
          <span>
            {pageInfo.total} task{pageInfo.total === 1 ? '' : 's'}{selectedSite ? ` for ${selectedSite}` : ''}
            {pageInfo.pages > 1 ? ` · page ${page} of ${pageInfo.pages}` : ''}
          </span>
          {pageInfo.pages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageInfo.pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── 7. Modals & Drawers ──────────────────────────────────────── */}
      {/*
        A MIRRORED O2D task gets the ORDER's completion form, not this one.

        Stage 8 will not close without an invoice number, stage 9 without an AWB
        and a box count. The ordinary Checklist form has nowhere to type those,
        so completing a mirror through it could only ever end in the server
        refusing for a field the screen never asked for. `CompleteStageModal`
        renders whatever that stage's specification declares — the same form
        Order Tracker shows, built from the same spec the server validates
        against — and completes through the O2D route, whose own hook then marks
        this occurrence done. One form, one completion, two places to reach it.
      */}
      {completeModal && isO2dMirror(completeModal) && (
        <StageTaskModal
          orderId={completeModal.sourceOrderId}
          stageNumber={completeModal.sourceStageNumber}
          onClose={() => setCompleteModal(null)}
          onCompleted={() => {
            toast.success('Stage completed. The next stage is now active.');
            handleSuccess();
          }}
        />
      )}

      {completeModal && !isO2dMirror(completeModal) && (
        <CompleteChecklistModal
          isOpen={!!completeModal}
          onClose={() => setCompleteModal(null)}
          task={completeModal}
          onSuccess={handleSuccess}
        />
      )}

      {nonFuncModal && (
        <NonFunctionalModal
          isOpen={!!nonFuncModal}
          onClose={() => setNonFuncModal(null)}
          task={nonFuncModal}
          onSuccess={handleSuccess}
        />
      )}

      {reassignModal && (
        <ReassignChecklistModal
          isOpen={!!reassignModal}
          onClose={() => setReassignModal(null)}
          task={reassignModal}
          users={users}
          onSuccess={handleSuccess}
        />
      )}

      {buddyModal && (
        <BuddyDetailsModal
          isOpen={!!buddyModal}
          onClose={() => setBuddyModal(null)}
          task={buddyModal}
        />
      )}

      {remarkModal && (
        <RemarkModal
          isOpen={!!remarkModal}
          onClose={() => setRemarkModal(null)}
          taskIds={Array.isArray(remarkModal) ? remarkModal : [remarkModal]}
          onSuccess={handleSuccess}
        />
      )}

      {editModal && (
        <EditChecklistModal
          isOpen={!!editModal}
          onClose={() => setEditModal(null)}
          routine={editModal}
          users={users}
          onSuccess={() => { loadRoutines(); setEditModal(null); }}
        />
      )}

      <CreateChecklistDrawer
        isOpen={createDrawer}
        onClose={() => setCreateDrawer(false)}
        users={users}
        isAdmin={admin}
        currentUser={user}
        onSuccess={handleSuccess}
      />

      <KpiDrilldownDrawer
        isOpen={!!drilldownKpi}
        onClose={() => { setDrilldownKpi(null); setActiveKpi(null); }}
        kpi={drilldownKpi}
        site={selectedSite}
        onShowInList={handleShowInList}
      />
    </div>
  );
}

export default ChecklistPage;
