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
import { isAdmin as checkIsAdmin, isSuperAdmin } from '../../utils/permissions';
import { checklistApi } from '../../services/checklist';
import toast from 'react-hot-toast';

import { TasksTable } from './TasksTable';
import { RoutinesTable } from './RoutinesTable';
import { DepartmentScoreboard } from './DepartmentScoreboard';
import { KpiDrilldownDrawer } from './KpiDrilldownDrawer';
import {
  CompleteChecklistModal,
  NonFunctionalModal,
  ReassignChecklistModal,
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

// ── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];
const FREQUENCIES = ['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const STATUSES = ['pending', 'overdue', 'completed', 'non-functional'];

const isManager = (user) =>
  isSuperAdmin(user) || checkIsAdmin(user) || ADMIN_ROLES.includes(user?.role);

// ── KPI Tile Config ──────────────────────────────────────────────────────────

const KPI_TILES = [
  { key: 'total',          label: 'Total',          icon: ClipboardList, accent: 'bg-slate-400', textColor: 'text-slate-900' },
  { key: 'pendingToday',   label: 'Pending Today',  icon: Clock,         accent: 'bg-primary-500',  textColor: 'text-primary-600' },
  { key: 'overdue',        label: 'Overdue',        icon: AlertTriangle, accent: 'bg-error-500',   textColor: 'text-error-600' },
  { key: 'completed',      label: 'Completed',      icon: CheckCircle2,  accent: 'bg-success-500', textColor: 'text-success-600' },
  { key: 'complianceRate', label: 'Compliance',     icon: TrendingUp,    accent: 'bg-primary-500', textColor: 'text-primary-600' },
];

// ═════════════════════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════════════════════

export function ChecklistPage() {
  const user = useUserStore((s) => s.user);
  const admin = isManager(user);

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
  const [remarkModal, setRemarkModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [createDrawer, setCreateDrawer] = useState(false);
  const [drilldownKpi, setDrilldownKpi] = useState(null);
  const [activeKpi, setActiveKpi] = useState(null);

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
      const params = { site: selectedSite || undefined };
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

      setTasks(tasksData?.tasks || []);
      setSummary(summaryData || {});
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
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
    try {
      await checklistApi.stopRoutine(routine._id);
      toast.success('Routine stopped');
      loadRoutines();
    } catch (err) {
      toast.error('Failed to stop routine');
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
          <Button size="sm" onClick={() => setCreateDrawer(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {admin ? 'New Checklist' : 'Add Task'}
          </Button>
          </>
        }
      />

      {/* ── 2. KPI Stat Tiles ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {KPI_TILES.map((tile) => {
          const value = tile.key === 'complianceRate'
            ? `${summary[tile.key] || 0}%`
            : (summary[tile.key] ?? 0);
          const isActive = activeKpi === tile.key;

          return (
            <div
              key={tile.key}
              onClick={() => tile.key !== 'complianceRate' && handleKpiClick(tile.key)}
              className={`p-3.5 rounded-xl border bg-white transition-all cursor-pointer shadow-enterprise hover:shadow-md flex flex-col justify-between group ${
                isActive ? 'border-primary-600 ring-2 ring-primary-500/10' : 'border-slate-200 hover:border-primary-600'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-primary-700 transition-colors truncate">
                  {tile.label}
                </span>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${tile.accent}`} />
              </div>

              <div className="flex items-baseline justify-between mt-1">
                <span className={`text-2xl font-semibold ${tile.textColor}`}>{value}</span>
                {tile.key !== 'complianceRate' && (
                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary-700 group-hover:underline">
                    {isActive ? 'Showing' : 'View →'}
                  </span>
                )}
              </div>

              {tile.key === 'pendingToday' && summary.carriedOver > 0 && (
                <p className="text-[10px] font-bold text-slate-400 mt-1">
                  {summary.carriedOver} carried over
                </p>
              )}
            </div>
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
      {admin && selectedIds.length > 0 && (
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
      {view === 'tasks' && (
        <TasksTable
          tasks={tasks}
          loading={loading}
          isAdmin={admin}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onComplete={(task) => setCompleteModal(task)}
          onRemark={(task) => setRemarkModal([task._id])}
          onReassign={(task) => setReassignModal(task)}
          onNonFunctional={(task) => setNonFuncModal(task)}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
          onCreateNew={() => setCreateDrawer(true)}
        />
      )}

      {view === 'routines' && admin && (
        <RoutinesTable
          routines={routines}
          loading={loading}
          onEdit={(routine) => setEditModal(routine)}
          onStop={handleStopRoutine}
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
        <p className="text-center text-xs font-semibold text-slate-400">
          Showing {tasks.length} tasks{selectedSite ? ` for ${selectedSite}` : ''}
        </p>
      )}

      {/* ── 7. Modals & Drawers ──────────────────────────────────────── */}
      {completeModal && (
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
