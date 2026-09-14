import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trash2,
  ShieldAlert,
  RotateCcw,
  Search,
  Calendar as CalendarIcon,
  X,
  SlidersHorizontal,
  ChevronDown,
  Clock,
  Flag,
  ArrowUpDown,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useUserStore } from '../../store/userStore';
import delegationService from '../../services/delegation';

// Enterprise Status Color Mapping
const STATUS_MAP = {
  OverDue: { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200/60' },
  Overdue: { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200/60' },
  Pending: { dot: 'border-2 border-slate-400 bg-transparent', text: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
  'In Progress': { dot: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200/60' },
  Completed: { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200/60' },
  'Awaiting Verification': { dot: 'bg-[#1E4C92]', text: 'text-[#1E4C92]', bg: 'bg-[#1E4C92]/10', border: 'border-[#1E4C92]/20' },
};

// Enterprise Priority Color Mapping
const PRIORITY_COLORS = {
  Urgent: { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200/60' },
  High: { dot: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200/60' },
  Medium: { dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200/60' },
  Low: { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200/60' },
};

// Date range preset options
const DATE_RANGE_OPTIONS = [
  'All Time',
  'Today',
  'Yesterday',
  'This Week',
  'Next Week',
  'This Month',
  'Next Month',
  'Custom',
];

// Enterprise Avatar Palette
const AVATAR_COLOR_PALETTE = [
  'bg-[#1E4C92]/10 text-[#1E4C92] border-[#1E4C92]/20',
  'bg-indigo-50 text-indigo-700 border-indigo-200/60',
  'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  'bg-sky-50 text-sky-700 border-sky-200/60',
  'bg-amber-50 text-amber-700 border-amber-200/60',
  'bg-purple-50 text-purple-700 border-purple-200/60',
];

function getAvatarColor(nameOrId = '', index = 0) {
  if (!nameOrId) return AVATAR_COLOR_PALETTE[index % AVATAR_COLOR_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < nameOrId.length; i++) {
    hash = nameOrId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_COLOR_PALETTE.length;
  return AVATAR_COLOR_PALETTE[idx];
}

// Helper: Extract Initials
function getInitials(firstName = '', lastName = '') {
  const f = firstName ? firstName.trim().charAt(0) : '';
  const l = lastName ? lastName.trim().charAt(0) : '';
  if (!f && !l) return 'U';
  return (f + l).toUpperCase();
}

// Helper: Format Date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Helper: Overdue calculation
const isOverdue = (task) => {
  if (!task?.dueDate) return false;
  if (task.status === 'Completed' || task.status === 'Awaiting Verification') return false;
  return new Date(task.dueDate).getTime() < Date.now();
};

const getEffectiveStatus = (task) => (isOverdue(task) ? 'OverDue' : task.status || 'Pending');

// Active filter chip component
const FilterChip = ({ label, onRemove }) => (
  <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1E4C92]/5 border border-[#1E4C92]/20 text-[#1E4C92] rounded-full text-[11px] font-bold shadow-xs">
    <span>{label}</span>
    <button
      type="button"
      onClick={onRemove}
      className="hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
      title="Remove filter"
    >
      <X size={12} strokeWidth={3} />
    </button>
  </div>
);

export function DeletedTasks() {
  const navigate = useNavigate();

  // ── Access Control Evaluation ──────────────────────────────────────────
  const userFromStore = useUserStore((s) => s.user);
  const storedUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const currentUser = userFromStore || storedUser?.user || storedUser;
  const userRole = String(currentUser?.role || '').toUpperCase();
  const isAdmin = ['ADMIN', 'SUPERADMIN', 'SUPER ADMIN', 'MANAGEMENT'].includes(userRole);

  // ── State variables ────────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);

  // Filter toolbar states
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('All Time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [assignedByFilter, setAssignedByFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');

  // Sorting states
  const [sortBy, setSortBy] = useState('Deleted At');
  const [sortDesc, setSortDesc] = useState(true);

  // Popover panel state
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const filterPanelRef = useRef(null);

  // ── Close Popover on Outside Click ─────────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target)) {
        setIsFilterPanelOpen(false);
      }
    };
    if (isFilterPanelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFilterPanelOpen]);

  // ── Fetch Deleted Tasks & Metadata ─────────────────────────────────────
  const fetchAllData = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [tasksRes, usersRes, catsRes] = await Promise.all([
        delegationService.getDeletedDelegations(),
        delegationService.getUsers().catch(() => []),
        delegationService.getCategories().catch(() => []),
      ]);
      setTasks(Array.isArray(tasksRes) ? tasksRes : []);
      setUsers(Array.isArray(usersRes) ? usersRes : []);
      setCategories(Array.isArray(catsRes) ? catsRes : []);
    } catch (err) {
      console.error('Failed to fetch deleted tasks:', err);
      toast.error('Could not load deleted tasks');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // ── Dynamic Tags List ──────────────────────────────────────────────────
  const allTags = useMemo(() => {
    const set = new Set();
    tasks.forEach((t) => {
      if (Array.isArray(t.tags)) {
        t.tags.forEach((tag) => {
          if (typeof tag === 'string') set.add(tag);
          else if (tag?.name) set.add(tag.name);
          else if (tag?.text) set.add(tag.text);
        });
      }
    });
    return Array.from(set);
  }, [tasks]);

  // ── Restore Action Handler ─────────────────────────────────────────────
  const handleRestore = async (id) => {
    if (!window.confirm('Restore this task? It will return to the active work queue.')) return;
    try {
      setRestoringId(id);
      await delegationService.restoreDelegation(id);
      toast.success('Task restored successfully!');
      setTasks((prev) => prev.filter((t) => (t.id || t._id) !== id));
    } catch (err) {
      console.error('Failed to restore task:', err);
      toast.error(err?.response?.data?.message || 'Failed to restore task');
    } finally {
      setRestoringId(null);
    }
  };

  // ── Reset All Filters ──────────────────────────────────────────────────
  const handleResetFilters = () => {
    setSearch('');
    setDateRange('All Time');
    setCustomStartDate('');
    setCustomEndDate('');
    setStatusFilter('All');
    setPriorityFilter('All');
    setCategoryFilter('All');
    setAssignedByFilter('All');
    setTagFilter('All');
  };

  // ── Active Popover Filters Count ───────────────────────────────────────
  const activePopoverFilterCount = useMemo(() => {
    let count = 0;
    if (priorityFilter !== 'All') count++;
    if (categoryFilter !== 'All') count++;
    if (assignedByFilter !== 'All') count++;
    if (tagFilter !== 'All') count++;
    return count;
  }, [priorityFilter, categoryFilter, assignedByFilter, tagFilter]);

  // ── Filtered & Sorted Tasks ────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 1. Search filter
      if (search.trim()) {
        const query = search.toLowerCase();
        const titleMatch = task.taskTitle?.toLowerCase().includes(query);
        const descMatch = task.description?.toLowerCase().includes(query);
        const doerMatch = `${task.doerFirstName || ''} ${task.doerLastName || ''}`
          .toLowerCase()
          .includes(query);
        const assignerMatch = (task.assignerName || '').toLowerCase().includes(query);
        if (!titleMatch && !descMatch && !doerMatch && !assignerMatch) return false;
      }

      // 2. Date Range filter (evaluated against task.deletedAt || task.createdAt)
      if (dateRange !== 'All Time') {
        const itemDate = new Date(task.deletedAt || task.createdAt);
        const now = new Date();

        if (dateRange === 'Today') {
          const isToday =
            itemDate.getDate() === now.getDate() &&
            itemDate.getMonth() === now.getMonth() &&
            itemDate.getFullYear() === now.getFullYear();
          if (!isToday) return false;
        } else if (dateRange === 'Yesterday') {
          const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const isYesterday =
            itemDate.getDate() === yesterday.getDate() &&
            itemDate.getMonth() === yesterday.getMonth() &&
            itemDate.getFullYear() === yesterday.getFullYear();
          if (!isYesterday) return false;
        } else if (dateRange === 'This Week') {
          const day = now.getDay();
          const diff = now.getDate() - day + (day === 0 ? -6 : 1);
          const startOfWeek = new Date(new Date().setDate(diff));
          startOfWeek.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
          if (itemDate < startOfWeek || itemDate > endOfWeek) return false;
        } else if (dateRange === 'Next Week') {
          const day = now.getDay();
          const diff = now.getDate() - day + (day === 0 ? -6 : 1) + 7;
          const startOfNextWeek = new Date(new Date().setDate(diff));
          startOfNextWeek.setHours(0, 0, 0, 0);
          const endOfNextWeek = new Date(startOfNextWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
          if (itemDate < startOfNextWeek || itemDate > endOfNextWeek) return false;
        } else if (dateRange === 'This Month') {
          const isThisMonth =
            itemDate.getMonth() === now.getMonth() &&
            itemDate.getFullYear() === now.getFullYear();
          if (!isThisMonth) return false;
        } else if (dateRange === 'Next Month') {
          const nextMonthIndex = (now.getMonth() + 1) % 12;
          const nextMonthYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
          const isNextMonth =
            itemDate.getMonth() === nextMonthIndex &&
            itemDate.getFullYear() === nextMonthYear;
          if (!isNextMonth) return false;
        } else if (dateRange === 'Custom') {
          if (customStartDate) {
            const start = new Date(customStartDate);
            start.setHours(0, 0, 0, 0);
            if (itemDate < start) return false;
          }
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            if (itemDate > end) return false;
          }
        }
      }

      // 3. Status Tab filter
      if (statusFilter !== 'All') {
        const effectiveStatus = getEffectiveStatus(task);
        if (statusFilter === 'OverDue' || statusFilter === 'Overdue') {
          if (effectiveStatus !== 'OverDue' && effectiveStatus !== 'Overdue') return false;
        } else if (effectiveStatus !== statusFilter && task.status !== statusFilter) {
          return false;
        }
      }

      // 4. Priority filter
      if (priorityFilter !== 'All' && task.priority !== priorityFilter) {
        return false;
      }

      // 5. Category filter
      if (categoryFilter !== 'All' && task.category !== categoryFilter) {
        return false;
      }

      // 6. Assigned By filter
      if (assignedByFilter !== 'All') {
        const assigner = task.assignerName || `${task.assignerFirstName || ''} ${task.assignerLastName || ''}`.trim();
        const assignerId = String(task.assignerId || '');
        if (assigner !== assignedByFilter && assignerId !== assignedByFilter) {
          return false;
        }
      }

      // 7. Tag filter
      if (tagFilter !== 'All') {
        const hasTag = (task.tags || []).some((t) => {
          if (typeof t === 'string') return t === tagFilter;
          return t?.name === tagFilter || t?.text === tagFilter;
        });
        if (!hasTag) return false;
      }

      return true;
    });
  }, [
    tasks,
    search,
    dateRange,
    customStartDate,
    customEndDate,
    statusFilter,
    priorityFilter,
    categoryFilter,
    assignedByFilter,
    tagFilter,
  ]);

  // ── Sorted Output ──────────────────────────────────────────────────────
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      let valA, valB;
      if (sortBy === 'Deleted At') {
        valA = new Date(a.deletedAt || a.createdAt || 0).getTime();
        valB = new Date(b.deletedAt || b.createdAt || 0).getTime();
      } else if (sortBy === 'Due Date') {
        valA = new Date(a.dueDate || 0).getTime();
        valB = new Date(b.dueDate || 0).getTime();
      } else if (sortBy === 'Created At') {
        valA = new Date(a.createdAt || 0).getTime();
        valB = new Date(b.createdAt || 0).getTime();
      } else if (sortBy === 'Title') {
        valA = (a.taskTitle || '').toLowerCase();
        valB = (b.taskTitle || '').toLowerCase();
        return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
      } else {
        valA = new Date(a.deletedAt || 0).getTime();
        valB = new Date(b.deletedAt || 0).getTime();
      }

      return sortDesc ? valB - valA : valA - valB;
    });
  }, [filteredTasks, sortBy, sortDesc]);

  // ── Tab Counts ─────────────────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const counts = {
      All: tasks.length,
      OverDue: 0,
      Pending: 0,
      'In Progress': 0,
      Completed: 0,
    };

    tasks.forEach((t) => {
      const eff = getEffectiveStatus(t);
      if (eff === 'OverDue' || eff === 'Overdue') {
        counts.OverDue++;
      } else if (eff === 'In Progress') {
        counts['In Progress']++;
      } else if (eff === 'Completed') {
        counts.Completed++;
      } else if (eff === 'Pending') {
        counts.Pending++;
      }
    });

    return counts;
  }, [tasks]);

  // ── Active Filter Chips Configuration ──────────────────────────────────
  const activeChips = useMemo(() => {
    const list = [];
    if (priorityFilter !== 'All') {
      list.push({
        key: 'priority',
        label: `Priority: ${priorityFilter}`,
        onRemove: () => setPriorityFilter('All'),
      });
    }
    if (categoryFilter !== 'All') {
      list.push({
        key: 'category',
        label: `Category: ${categoryFilter}`,
        onRemove: () => setCategoryFilter('All'),
      });
    }
    if (assignedByFilter !== 'All') {
      const u = users.find((item) => (item._id || item.id) === assignedByFilter);
      const name = u?.user || u?.name || assignedByFilter;
      list.push({
        key: 'assignedBy',
        label: `Assigned By: ${name}`,
        onRemove: () => setAssignedByFilter('All'),
      });
    }
    if (tagFilter !== 'All') {
      list.push({
        key: 'tag',
        label: `Tag: ${tagFilter}`,
        onRemove: () => setTagFilter('All'),
      });
    }
    return list;
  }, [priorityFilter, categoryFilter, assignedByFilter, tagFilter, users]);

  // ── Access Control Guard Render ────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 select-none">
        <div className="text-center p-10 bg-white rounded-3xl shadow-xs border border-slate-200 max-w-md space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto shadow-xs">
            <ShieldAlert size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-xl font-semibold text-slate-800">Admin Access Required</h2>
          <p className="text-sm font-medium text-slate-500 leading-relaxed">
            The deleted tasks archive is restricted to administrative and management roles.
          </p>
          <button
            type="button"
            onClick={() => navigate('/work-queue')}
            className="w-full py-3 px-4 bg-[#1E4C92] hover:bg-[#163a6a] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer active:scale-95"
          >
            Return to My Work
          </button>
        </div>
      </div>
    );
  }

  const isAnyFilterActive =
    search.trim() !== '' ||
    dateRange !== 'All Time' ||
    statusFilter !== 'All' ||
    priorityFilter !== 'All' ||
    categoryFilter !== 'All' ||
    assignedByFilter !== 'All' ||
    tagFilter !== 'All';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* ── 1. HEADER & ACTIONS ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-[#1E4C92] rounded-xl flex items-center justify-center shadow-lg shadow-[#1E4C92]/30 shrink-0">
            <Trash2 className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-800 leading-none">Deleted Tasks</h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#1E4C92] bg-[#1E4C92]/10 border border-[#1E4C92]/20 px-2.5 py-0.5 rounded-full">
                Archive
              </span>
            </div>
            <p className="text-xs font-bold text-slate-400 mt-1">
              Central repository for soft-deleted tasks, forensic recovery & audit history
            </p>
          </div>
        </div>
      </div>

      {/* ── 2. TOOLBAR & MULTI-FACTOR FILTER CONTROLS ───────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Date Range Preset Selector */}
        <div className="relative shrink-0">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
        </div>

        {/* Custom Date Pickers */}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <div className="h-11 border border-slate-200 hover:border-slate-300 rounded-xl px-3 flex items-center gap-2 bg-white min-w-[135px] shadow-xs focus-within:border-[#1E4C92] focus-within:ring-2 focus-within:ring-[#1E4C92]/20 transition-all">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="outline-none text-xs font-bold text-slate-700 bg-transparent w-full cursor-pointer"
              />
            </div>

            <div className="h-11 border border-slate-200 hover:border-slate-300 rounded-xl px-3 flex items-center gap-2 bg-white min-w-[135px] shadow-xs focus-within:border-[#1E4C92] focus-within:ring-2 focus-within:ring-[#1E4C92]/20 transition-all">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="outline-none text-xs font-bold text-slate-700 bg-transparent w-full cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Popover Filter Button & Panel */}
        <div className="relative shrink-0" ref={filterPanelRef}>
          <button
            type="button"
            onClick={() => setIsFilterPanelOpen((prev) => !prev)}
            className={`h-11 px-4 border rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs transition-all cursor-pointer active:scale-95 ${
              isFilterPanelOpen || activePopoverFilterCount > 0
                ? 'bg-[#1E4C92] text-white border-[#1E4C92] shadow-sm'
                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 hover:text-[#1E4C92]'
            }`}
          >
            <SlidersHorizontal size={14} />
            <span>Filters</span>
            {activePopoverFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-white text-[#1E4C92] text-[10px] font-semibold flex items-center justify-center shadow-xs">
                {activePopoverFilterCount}
              </span>
            )}
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${isFilterPanelOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isFilterPanelOpen && (
            <div className="absolute top-[calc(100%+8px)] left-0 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 flex flex-col gap-3.5 min-w-[280px] animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Filter Criteria
                </span>
                {activePopoverFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPriorityFilter('All');
                      setCategoryFilter('All');
                      setAssignedByFilter('All');
                      setTagFilter('All');
                    }}
                    className="text-xs font-bold text-[#1E4C92] hover:underline cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Popover Field: Assigned By */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Assigned By
                </label>
                <div className="relative">
                  <select
                    value={assignedByFilter}
                    onChange={(e) => setAssignedByFilter(e.target.value)}
                    className="w-full h-9 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3 pr-8 text-xs font-bold text-slate-700 outline-none appearance-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all shadow-xs"
                  >
                    <option value="All">Anyone</option>
                    {users.map((u) => {
                      const uid = u._id || u.id;
                      const name = u.user || u.name || u.email;
                      return (
                        <option key={uid} value={name}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                </div>
              </div>

              {/* Popover Field: Priority */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Priority
                </label>
                <div className="relative">
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full h-9 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3 pr-8 text-xs font-bold text-slate-700 outline-none appearance-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all shadow-xs"
                  >
                    <option value="All">All Priorities</option>
                    <option value="Urgent">Urgent</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                </div>
              </div>

              {/* Popover Field: Category */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Category
                </label>
                <div className="relative">
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full h-9 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3 pr-8 text-xs font-bold text-slate-700 outline-none appearance-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all shadow-xs"
                  >
                    <option value="All">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                </div>
              </div>

              {/* Popover Field: Tag */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Tag
                </label>
                <div className="relative">
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="w-full h-9 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3 pr-8 text-xs font-bold text-slate-700 outline-none appearance-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all shadow-xs"
                  >
                    <option value="All">All Tags</option>
                    {allTags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Real-time Search Input */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search
            size={15}
            className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deleted tasks, authors, titles..."
            className="w-full h-11 pl-10 pr-9 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-bold outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 shadow-xs text-slate-700 placeholder:text-slate-400 transition-all"
          />
          {search.trim() !== '' && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Reset All Filters Button */}
        <button
          type="button"
          onClick={handleResetFilters}
          title="Reset all filters"
          className="h-11 w-11 flex items-center justify-center bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Sorting Controls */}
        <div className="relative shrink-0 min-w-[135px]">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
          >
            <option value="Deleted At">Deleted At</option>
            <option value="Due Date">Due Date</option>
            <option value="Created At">Created At</option>
            <option value="Title">Title</option>
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setSortDesc((prev) => !prev)}
          title={sortDesc ? 'Descending (Click for Ascending)' : 'Ascending (Click for Descending)'}
          className="h-11 w-11 flex justify-center items-center bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
        >
          <ArrowUpDown
            size={15}
            className={`transition-transform duration-200 ${sortDesc ? '' : 'rotate-180'}`}
          />
        </button>
      </div>

      {/* ── 3. ACTIVE FILTER CHIPS ──────────────────────────────────────── */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
          ))}
        </div>
      )}

      {/* ── 4. STATUS NAVIGATION TABS ───────────────────────────────────── */}
      <div className="flex items-center gap-6 border-b border-slate-200 overflow-x-auto select-none">
        {[
          { key: 'All', label: 'ALL', count: statusCounts.All, dot: 'w-2.5 h-2.5 rounded-full bg-slate-400' },
          { key: 'OverDue', label: 'OVERDUE', count: statusCounts.OverDue, dot: 'w-2.5 h-2.5 rounded-full bg-red-500' },
          { key: 'Pending', label: 'PENDING', count: statusCounts.Pending, dot: 'w-2.5 h-2.5 rounded-full border-2 border-slate-400 bg-transparent' },
          { key: 'In Progress', label: 'IN PROGRESS', count: statusCounts['In Progress'], dot: 'w-2.5 h-2.5 rounded-full bg-orange-500' },
          { key: 'Completed', label: 'COMPLETED', count: statusCounts.Completed, dot: 'w-2.5 h-2.5 rounded-full bg-emerald-500' },
        ].map((tab) => {
          const isActive = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`relative pb-3 flex items-center gap-2 text-xs font-semibold tracking-wider transition-colors cursor-pointer shrink-0 ${
                isActive ? 'text-[#1E4C92]' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <span className={tab.dot} />
              <span>
                {tab.label} — {tab.count}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1E4C92] rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── 5. CONTENT AREA ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Loading Skeletons */}
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-200 p-4.5 shadow-xs animate-pulse flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-100 rounded w-1/4" />
                <div className="h-5 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
              <div className="w-24 h-9 bg-slate-100 rounded-xl shrink-0" />
            </div>
          ))
        ) : sortedTasks.length === 0 ? (
          /* Empty State */
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 md:p-20 flex flex-col items-center justify-center text-center shadow-xs">
            <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mb-3 shadow-xs">
              <Trash2 size={28} strokeWidth={2} />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Archive Is Empty</h3>
            <p className="text-xs font-medium text-slate-400 mb-4 max-w-sm">
              {isAnyFilterActive
                ? 'No deleted tasks match your active filter criteria.'
                : 'No soft-deleted tasks found in the system archive.'}
            </p>
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="h-10 px-4 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer active:scale-95"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          /* Deleted Task Cards Stream */
          sortedTasks.map((task, idx) => {
            const taskId = task.id || task._id;
            const effStatus = getEffectiveStatus(task);
            const statusConfig = STATUS_MAP[effStatus] || STATUS_MAP.Pending;
            const priorityConfig = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.Medium;
            const overdue = isOverdue(task);

            const doerFullName = `${task.doerFirstName || 'Unassigned'} ${task.doerLastName || ''}`.trim();
            const initials = getInitials(task.doerFirstName, task.doerLastName);
            const avatarColor = getAvatarColor(doerFullName, idx);

            const assignerDisplay =
              task.assignerName ||
              (task.assignerFirstName
                ? `${task.assignerFirstName} ${task.assignerLastName || ''}`.trim()
                : 'Admin');

            const deletedByDisplay = task.deletedByFirstName
              ? `${task.deletedByFirstName} ${task.deletedByLastName || ''}`.trim()
              : 'Admin';

            // Clean description excerpt
            const plainDesc = (task.description || '')
              .replace(/<[^>]*>/g, '')
              .trim();

            return (
              <div
                key={taskId}
                className="bg-white rounded-2xl border border-slate-200 hover:border-[#1E4C92] p-4.5 shadow-xs hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center gap-4 group"
              >
                {/* [1] Doer Initials Avatar */}
                <div
                  className={`w-10 h-10 rounded-full font-semibold text-xs flex items-center justify-center border shadow-xs shrink-0 ${avatarColor}`}
                >
                  {initials}
                </div>

                {/* [2] Task Content Column */}
                <div className="flex-1 min-w-0 space-y-1">
                  {/* 2.1 Header Line */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800 text-xs sm:text-sm group-hover:text-[#1E4C92] transition-colors">
                      {doerFullName}
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                      {task.category || 'Operations'}
                    </span>
                    <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200/60 px-2 py-0.5 rounded-md ml-auto flex items-center gap-1 shrink-0">
                      Deleted {formatDate(task.deletedAt || task.updatedAt)}
                    </span>
                  </div>

                  {/* 2.2 Title Line */}
                  <h3 className="text-sm sm:text-base font-semibold text-slate-800 group-hover:text-[#1E4C92] transition-colors truncate">
                    {task.taskTitle}
                  </h3>
                  {plainDesc && (
                    <p className="text-xs font-medium text-slate-500 line-clamp-1">
                      {plainDesc}
                    </p>
                  )}

                  {/* 2.3 Metadata Pill Line */}
                  <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                    {/* Assigner Indicator */}
                    <span className="font-bold text-slate-500">
                      Assigned By: <strong className="text-slate-700 font-bold">{assignerDisplay}</strong>
                    </span>

                    <span className="text-slate-300">·</span>

                    {/* Due Date & Overdue Badge */}
                    <span className="flex items-center gap-1 font-bold text-slate-500">
                      <Clock size={13} className="text-slate-400" />
                      <span>{formatDate(task.dueDate)}</span>
                      {overdue && (
                        <span className="text-red-600 font-semibold ml-0.5">| Overdue</span>
                      )}
                    </span>

                    <span className="text-slate-300">·</span>

                    {/* Status Badge */}
                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider shadow-xs ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                      <span>{effStatus}</span>
                    </div>

                    <span className="text-slate-300">·</span>

                    {/* Priority Badge */}
                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider shadow-xs ${priorityConfig.bg} ${priorityConfig.text} ${priorityConfig.border}`}
                    >
                      <Flag size={10} className={priorityConfig.text} />
                      <span>{task.priority || 'Medium'}</span>
                    </div>

                    <span className="text-slate-300">·</span>

                    {/* Deletion Author Audit */}
                    <span className="flex items-center gap-1 text-slate-400 font-bold text-[11px]">
                      <Trash2 size={12} className="text-red-400" />
                      <span>Deleted by {deletedByDisplay}</span>
                    </span>
                  </div>
                </div>

                {/* [3] Action Column */}
                <div className="shrink-0 sm:self-center pt-2 sm:pt-0 sm:pl-2">
                  <button
                    type="button"
                    onClick={() => handleRestore(taskId)}
                    disabled={restoringId === taskId}
                    className="h-10 px-4 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 hover:border-emerald-300 text-emerald-700 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
                    title="Restore task to active workflow"
                  >
                    {restoringId === taskId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                    ) : (
                      <RotateCcw size={14} strokeWidth={2.5} />
                    )}
                    <span>Restore</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default DeletedTasks;
