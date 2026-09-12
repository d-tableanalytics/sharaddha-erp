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
  RefreshCw,
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
} from 'lucide-react';
import { Button } from '../../components/ui/Button';

// ── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];
const FREQUENCIES = ['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const STATUSES = ['pending', 'overdue', 'completed', 'non-functional'];

const isManager = (user) =>
  isSuperAdmin(user) || checkIsAdmin(user) || ADMIN_ROLES.includes(user?.role);

// ── KPI Tile Config ──────────────────────────────────────────────────────────

const KPI_TILES = [
  { key: 'total',        label: 'Total',         icon: ClipboardList, accent: 'bg-slate-500' },
  { key: 'pendingToday', label: 'Pending today',  icon: Clock,         accent: 'bg-blue-500' },
  { key: 'overdue',      label: 'Overdue',        icon: AlertTriangle, accent: 'bg-red-500' },
  { key: 'completed',    label: 'Completed',      icon: CheckCircle2,  accent: 'bg-emerald-500' },
  { key: 'complianceRate', label: 'Compliance',   icon: TrendingUp,    accent: 'bg-indigo-500' },
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
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* ── 1. Header Bar ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center">
            <ClipboardList size={22} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900">Checklist</h1>
            <p className="text-sm text-slate-500">
              Recurring compliance tasks — generated ahead, tracked to completion.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Site switcher */}
          {locations.length > 1 && (
            <div className="flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200">
              {locations.map((site) => (
                <button
                  key={site}
                  onClick={() => setSelectedSite(site === selectedSite ? '' : site)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    selectedSite === site
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {site}
                </button>
              ))}
            </div>
          )}

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-all duration-200"
            title="Refresh"
          >
            <RefreshCw size={16} className={`text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* New checklist CTA */}
          <Button
            onClick={() => setCreateDrawer(true)}
            className="!bg-emerald-600 hover:!bg-emerald-700 !text-white !rounded-xl"
          >
            <Plus size={16} className="mr-1" />
            {admin ? 'New checklist' : 'Add checklist task'}
          </Button>
        </div>
      </div>

      {/* ── 2. KPI Stat Tiles ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {KPI_TILES.map((tile) => {
          const Icon = tile.icon;
          const value = tile.key === 'complianceRate'
            ? `${summary[tile.key] || 0}%`
            : (summary[tile.key] ?? 0);
          const isActive = activeKpi === tile.key;

          return (
            <button
              key={tile.key}
              onClick={() => tile.key !== 'complianceRate' && handleKpiClick(tile.key)}
              className={`group relative p-4 rounded-2xl border text-left transition-all duration-200 hover:shadow-md overflow-hidden ${
                isActive
                  ? 'border-emerald-400 bg-emerald-50/60 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              {/* Decorative blob */}
              <div
                className={`absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-[0.07] ${tile.accent}`}
              />

              <div className="flex items-center gap-2 mb-2">
                <div className={`w-7 h-7 rounded-lg ${tile.accent} flex items-center justify-center`}>
                  <Icon size={14} className="text-white" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {tile.label}
                </span>
              </div>

              <p className="text-3xl font-extrabold tabular-nums text-slate-900">{value}</p>

              {tile.key === 'pendingToday' && summary.carriedOver > 0 && (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {summary.carriedOver} carried over from earlier
                </p>
              )}

              <p className={`text-[11px] font-semibold mt-1.5 ${isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`}>
                {isActive ? 'Showing' : 'View →'}
              </p>
            </button>
          );
        })}
      </div>

      {/* ── 3. Filter Bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-slate-50 border border-slate-200">
        {/* View switcher (admin only) */}
        {admin && (
          <div className="flex items-center bg-white rounded-xl p-0.5 border border-slate-200 mr-2">
            {[
              { key: 'tasks',       label: 'Tasks',       icon: ClipboardList },
              { key: 'routines',    label: 'Routines',    icon: ListTree },
              { key: 'departments', label: 'Departments', icon: Building2 },
            ].map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setView(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    view === tab.key
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <TabIcon size={13} /> {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
          />
        </div>

        {/* Frequency */}
        <select
          value={frequencyFilter}
          onChange={(e) => setFrequencyFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
        >
          <option value="">All frequencies</option>
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
          ))}
        </select>

        {/* Status */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === 'non-functional' ? 'Non-Functional' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        {/* Department filter (admin only) */}
        {admin && departments.length > 0 && (
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}

        {/* Site filter */}
        {locations.length > 0 && (
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
          >
            <option value="">All sites</option>
            {locations.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {/* Doer filter (admin only) */}
        {admin && users.length > 0 && (
          <select
            value={doerFilter}
            onChange={(e) => setDoerFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
          >
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u._id} value={u._id}>{u.user || u.email}</option>
            ))}
          </select>
        )}

        {/* Date filters */}
        <input
          type="date"
          value={specificDate}
          onChange={(e) => setSpecificDate(e.target.value)}
          title="Specific date"
          className={`px-3 py-2.5 rounded-xl border bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all ${
            specificDate ? 'border-emerald-400 ring-2 ring-emerald-500/40' : 'border-slate-200'
          }`}
        />
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          disabled={!!specificDate}
          title="From"
          className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all disabled:opacity-50"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          disabled={!!specificDate}
          title="To"
          className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all disabled:opacity-50"
        />

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors whitespace-nowrap"
          >
            Clear ({activeFilterCount})
          </button>
        )}
      </div>

      {/* ── 4. Bulk Action Bar ───────────────────────────────────────── */}
      {admin && selectedIds.length > 0 && (
        <div className="flex items-center justify-between px-5 py-3 bg-emerald-600 text-white rounded-2xl shadow-lg animate-in slide-in-from-top-2 duration-200">
          <span className="text-sm font-semibold">{selectedIds.length} tasks selected</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setRemarkModal(selectedIds)}
              className="!bg-white/20 hover:!bg-white/30 !text-white !border-0"
            >
              <MessageSquare size={14} className="mr-1" /> Add remark
            </Button>
            <Button
              size="sm"
              onClick={() => setSelectedIds([])}
              className="!bg-white/20 hover:!bg-white/30 !text-white !border-0"
            >
              Clear
            </Button>
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
        <p className="text-center text-[12px] text-slate-400">
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
