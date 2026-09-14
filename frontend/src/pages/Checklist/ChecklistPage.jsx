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

// ── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];
const FREQUENCIES = ['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const STATUSES = ['pending', 'overdue', 'completed', 'non-functional'];

const isManager = (user) =>
  isSuperAdmin(user) || checkIsAdmin(user) || ADMIN_ROLES.includes(user?.role);

// ── KPI Tile Config ──────────────────────────────────────────────────────────

const KPI_TILES = [
  { key: 'total',          label: 'Total',          icon: ClipboardList, accent: 'bg-slate-400', textColor: 'text-slate-800' },
  { key: 'pendingToday',   label: 'Pending Today',  icon: Clock,         accent: 'bg-blue-500',  textColor: 'text-blue-600' },
  { key: 'overdue',        label: 'Overdue',        icon: AlertTriangle, accent: 'bg-red-500',   textColor: 'text-red-600' },
  { key: 'completed',      label: 'Completed',      icon: CheckCircle2,  accent: 'bg-emerald-500', textColor: 'text-emerald-600' },
  { key: 'complianceRate', label: 'Compliance',     icon: TrendingUp,    accent: 'bg-indigo-500', textColor: 'text-indigo-600' },
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
    <div className="space-y-6 max-w-7xl mx-auto pb-16">

      {/* ── 1. Header Bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-[#1E4C92] rounded-xl flex items-center justify-center shadow-lg shadow-[#1E4C92]/30 shrink-0">
            <ClipboardList className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 leading-none">Checklist</h1>
            <p className="text-xs font-bold text-slate-400 mt-1">
              Recurring compliance tasks — generated ahead, tracked to completion
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Site switcher */}
          {locations.length > 1 && (
            <div className="h-10 bg-slate-100 rounded-xl p-1 border border-slate-200 flex items-center gap-1 shadow-xs">
              {locations.map((site) => (
                <button
                  key={site}
                  type="button"
                  onClick={() => setSelectedSite(site === selectedSite ? '' : site)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedSite === site
                      ? 'bg-[#1E4C92] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
                >
                  {site}
                </button>
              ))}
            </div>
          )}


          {/* New checklist CTA */}
          <button
            type="button"
            onClick={() => setCreateDrawer(true)}
            className="flex items-center justify-center gap-2 px-5 h-10 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl font-bold text-xs transition-all active:scale-95 shadow-sm cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            <span>{admin ? 'New Checklist' : 'Add Task'}</span>
          </button>
        </div>
      </div>

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
              className={`p-3.5 rounded-xl border bg-white transition-all cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between group ${
                isActive ? 'border-[#1E4C92] ring-2 ring-[#1E4C92]/10' : 'border-slate-200 hover:border-[#1E4C92]'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-[#1E4C92] transition-colors truncate">
                  {tile.label}
                </span>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${tile.accent}`} />
              </div>

              <div className="flex items-baseline justify-between mt-1">
                <span className={`text-2xl font-semibold ${tile.textColor}`}>{value}</span>
                {tile.key !== 'complianceRate' && (
                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-[#1E4C92] group-hover:underline">
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
          <div className="h-11 bg-slate-100 rounded-xl p-1 border border-slate-200 flex items-center gap-1 shadow-xs shrink-0">
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
                      ? 'bg-[#1E4C92] text-white shadow-xs'
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
            className="w-full h-11 pl-10 pr-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 shadow-xs transition-all"
          />
        </div>

        {/* Frequency */}
        <div className="relative shrink-0">
          <select
            value={frequencyFilter}
            onChange={(e) => setFrequencyFilter(e.target.value)}
            className="h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
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
            className="h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
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
              className="h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
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
              className="h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
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
              className="h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
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
          className={`h-11 px-3 bg-white border rounded-xl text-xs font-bold text-slate-700 shadow-xs outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all cursor-pointer ${
            specificDate ? 'border-[#1E4C92] ring-2 ring-[#1E4C92]/20' : 'border-slate-200 hover:border-slate-300'
          }`}
        />

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={!!specificDate}
            title="From"
            className="h-11 px-3 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-bold text-slate-700 shadow-xs outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all disabled:opacity-50 cursor-pointer"
          />
          <span className="text-xs font-bold text-slate-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            disabled={!!specificDate}
            title="To"
            className="h-11 px-3 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-bold text-slate-700 shadow-xs outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all disabled:opacity-50 cursor-pointer"
          />
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            title="Clear all filters"
            className="h-11 px-3.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-xs active:scale-95 transition-all cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear ({activeFilterCount})</span>
          </button>
        )}
      </div>

      {/* ── 4. Bulk Action Bar ───────────────────────────────────────── */}
      {admin && selectedIds.length > 0 && (
        <div className="flex items-center justify-between px-5 py-3 bg-[#1E4C92] text-white rounded-2xl shadow-lg animate-in slide-in-from-top-2 duration-200">
          <span className="text-xs font-bold">{selectedIds.length} tasks selected</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRemarkModal(selectedIds)}
              className="px-3.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Add Remark</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-3.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs transition-colors cursor-pointer"
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
