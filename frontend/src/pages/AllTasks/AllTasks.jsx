import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutGrid, CheckSquare, RotateCcw, Search, FileUp, List, Layout, Calendar as CalendarIcon, X, SlidersHorizontal, ChevronDown, Clock, User, Folder, Flag, Tag, MoreVertical, Mic, Paperclip, } from 'lucide-react';
import toast from 'react-hot-toast';

import { useUserStore } from '../../store/userStore';
import delegationService from '../../services/delegation';
import TaskKanbanView from '../Delegation/TaskKanbanView';
import TaskCalendarView from '../Delegation/TaskCalendarView';
import TaskCreationDrawer from '../Delegation/TaskCreationDrawer';
import TaskDetailsDrawer from '../Delegation/TaskDetailsDrawer';
import TaskDrilldownDrawer from './TaskDrilldownDrawer';
import AdvancedExportModal from './AdvancedExportModal';

// Status navigation tab definitions
const STATUS_TABS = [
  { key: 'All', label: 'All', dot: 'bg-slate-400' },
  { key: 'Overdue', label: 'Overdue', dot: 'bg-red-500' },
  { key: 'Pending', label: 'Pending', dot: 'border-2 border-slate-400 bg-transparent' },
  { key: 'In Progress', label: 'In Progress', dot: 'bg-orange-500' },
  { key: 'Awaiting Verification', label: 'Verification', dot: 'bg-blue-500' },
  { key: 'Completed', label: 'Completed', dot: 'bg-emerald-500' },
];

// Helper: Extract initials
function getInitials(first = '', last = '') {
  const f = first ? first.trim().charAt(0) : '';
  const l = last ? last.trim().charAt(0) : '';
  return (f + l).toUpperCase() || 'U';
}

// Helper: Relative Timestamp
function formatTimeAgo(dateString) {
  if (!dateString) return '';
  const now = new Date();
  const date = new Date(dateString);
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

// Helper: Format due date badge (e.g. "18 Sep")
function formatDueBadge(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

// Helper: Check if task is overdue
function isTaskOverdue(task) {
  if (!task?.dueDate) return false;
  if (task.status === 'Completed' || task.status === 'Awaiting Verification') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

// Helper: Check if task is blocked
function isTaskBlocked(task) {
  return Boolean(
    task?.blockedByDetails?.summary ||
    task?.blockedByDetails?.reason ||
    task?.isBlocked ||
    task?.status === 'Blocked'
  );
}

// Helper: Extract in-loop user IDs
function getInLoopUserIds(task) {
  const ids = new Set();
  if (Array.isArray(task.inLoopIds)) {
    task.inLoopIds.forEach((id) => {
      if (id) ids.add(String(id?._id || id?.id || id));
    });
  }
  if (Array.isArray(task.inLoop)) {
    task.inLoop.forEach((item) => {
      if (typeof item === 'string') ids.add(item);
      else if (item?.userId) ids.add(String(item.userId._id || item.userId));
      else if (item?._id) ids.add(String(item._id));
      else if (item?.id) ids.add(String(item.id));
    });
  }
  return Array.from(ids);
}

// Helper: Evaluates preset date ranges against task dates
function isWithinDateRange(task, dateRange, customStartDate, customEndDate) {
  if (!dateRange || dateRange === 'All Time') return true;
  const targetDate = task.dueDate ? new Date(task.dueDate) : (task.createdAt ? new Date(task.createdAt) : null);
  if (!targetDate || isNaN(targetDate.getTime())) return true;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (dateRange === 'Today') {
    return targetDate >= startOfToday && targetDate <= endOfToday;
  }
  if (dateRange === 'Yesterday') {
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const endOfYesterday = new Date(endOfToday.getTime() - 24 * 60 * 60 * 1000);
    return targetDate >= startOfYesterday && targetDate <= endOfYesterday;
  }
  if (dateRange === 'This Week') {
    const day = startOfToday.getDay();
    const diff = startOfToday.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return targetDate >= startOfWeek && targetDate <= endOfWeek;
  }
  if (dateRange === 'Last Week') {
    const day = startOfToday.getDay();
    const diff = startOfToday.getDate() - day + (day === 0 ? -6 : 1) - 7;
    const startOfLastWeek = new Date(startOfToday);
    startOfLastWeek.setDate(diff);
    startOfLastWeek.setHours(0, 0, 0, 0);
    const endOfLastWeek = new Date(startOfLastWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return targetDate >= startOfLastWeek && targetDate <= endOfLastWeek;
  }
  if (dateRange === 'This Month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return targetDate >= startOfMonth && targetDate <= endOfMonth;
  }
  if (dateRange === 'Last Month') {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return targetDate >= startOfLastMonth && targetDate <= endOfLastMonth;
  }
  if (dateRange === 'This Year') {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return targetDate >= startOfYear && targetDate <= endOfYear;
  }
  if (dateRange === 'Custom') {
    if (!customStartDate && !customEndDate) return true;
    const start = customStartDate ? new Date(customStartDate) : new Date(0);
    const end = customEndDate ? new Date(`${customEndDate}T23:59:59.999`) : new Date(8640000000000000);
    return targetDate >= start && targetDate <= end;
  }
  return true;
}

export function AllTasks() {
  const { taskId: paramTaskId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentUser = useUserStore((s) => s.user);

  const currentUserId = currentUser?._id || currentUser?.id;
  const userRole = String(currentUser?.role || '').toUpperCase();
  const isAdmin =
    userRole === 'ADMIN' ||
    userRole === 'SUPERADMIN' ||
    userRole === 'SUPER ADMIN' ||
    userRole === 'MANAGEMENT';

  // ── Data states ──────────────────────────────────────────────────────────
  const [rawTasks, setRawTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── UI states ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban' | 'calendar'
  const [activeTab, setActiveTab] = useState(() => searchParams.get('status') || 'All');
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [isFilterFlyoutOpen, setIsFilterFlyoutOpen] = useState(false);
  const filterPanelRef = useRef(null);

  // Dashboard drilldown highlight banner and halo animation
  const [isHighlighted, setIsHighlighted] = useState(() => searchParams.get('highlight') === 'true');

  useEffect(() => {
    if (isHighlighted) {
      const timer = setTimeout(() => {
        setIsHighlighted(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted]);

  // ── Modals & Drawers states ──────────────────────────────────────────────
  const [showTaskDrawer, setShowTaskDrawer] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(paramTaskId || null);
  const [showDetails, setShowDetails] = useState(Boolean(paramTaskId));
  const [selectedTaskObj, setSelectedTaskObj] = useState(null);
  const [kpiDrill, setKpiDrill] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);

  // ── Filter states ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('All Time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [assignedToFilter, setAssignedToFilter] = useState(() => searchParams.get('doerId') || 'All');
  const [assignedByFilter, setAssignedByFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('category') || 'All');
  const [tagFilter, setTagFilter] = useState(() => searchParams.get('tag') || 'All');
  const [verificationFilter, setVerificationFilter] = useState('All');

  // Dismiss filter popover on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target)) {
        setIsFilterFlyoutOpen(false);
      }
    }
    if (isFilterFlyoutOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFilterFlyoutOpen]);

  // ── Fetch Initial Data ───────────────────────────────────────────────────
  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, userRes, catRes] = await Promise.all([
        delegationService.getDelegations({
          scope: 'allTasks',
          viewAll: isAdmin ? 'true' : undefined,
        }),
        delegationService.getUsers(),
        delegationService.getCategories(),
      ]);

      setRawTasks(taskRes || []);
      setUsers(userRes || []);
      setCategories(catRes || []);

      // If paramTaskId is in URL, open details drawer
      if (paramTaskId) {
        setSelectedTaskId(paramTaskId);
        setShowDetails(true);
        const match = (taskRes || []).find((t) => t._id === paramTaskId);
        if (match) {
          setSelectedTaskObj(match);
        } else {
          delegationService.getDelegationById(paramTaskId)
            .then((res) => {
              if (res) setSelectedTaskObj(res);
            })
            .catch(() => { });
        }
      }
    } catch {
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, paramTaskId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Deep linking sync with route parameter
  useEffect(() => {
    if (paramTaskId) {
      setSelectedTaskId(paramTaskId);
      setShowDetails(true);
      const match = rawTasks.find((t) => t._id === paramTaskId);
      if (match) setSelectedTaskObj(match);
    }
  }, [paramTaskId, rawTasks]);

  // ── Role-Based Scoped Master Task Set ────────────────────────────────────
  const scopedTasks = useMemo(() => {
    if (isAdmin) return rawTasks;
    if (!currentUserId) return rawTasks;

    return rawTasks.filter((t) => {
      const isAssigner = String(t.assignerId) === String(currentUserId);
      const isDoer = String(t.doerId) === String(currentUserId);
      const loopIds = getInLoopUserIds(t);
      const isInLoop = loopIds.includes(String(currentUserId));
      return isAssigner || isDoer || isInLoop;
    });
  }, [rawTasks, isAdmin, currentUserId]);

  // ── Dynamic Tags Discovery ───────────────────────────────────────────────
  const allTags = useMemo(() => {
    const set = new Set();
    scopedTasks.forEach((t) => {
      t.tags?.forEach((tg) => {
        const name = tg.name || tg;
        if (name) set.add(name);
      });
    });
    return Array.from(set);
  }, [scopedTasks]);

  // ── Base Filtered Tasks (Secondary Filters without Status Tab) ───────────
  const baseFilteredTasks = useMemo(() => {
    return scopedTasks.filter((t) => {
      // 1. Substring search
      if (search.trim()) {
        const q = search.toLowerCase();
        const titleMatch = t.taskTitle?.toLowerCase().includes(q);
        const descMatch = t.description?.toLowerCase().includes(q);
        const assignerMatch = (
          t.assignerName ||
          `${t.assignerFirstName || ''} ${t.assignerLastName || ''}`
        ).toLowerCase().includes(q);
        const doerMatch = (
          `${t.doerFirstName || ''} ${t.doerLastName || ''}`
        ).toLowerCase().includes(q);
        if (!titleMatch && !descMatch && !assignerMatch && !doerMatch) return false;
      }

      // 2. Date Range
      if (!isWithinDateRange(t, dateRange, customStartDate, customEndDate)) {
        return false;
      }

      // 3. Assigned To
      if (assignedToFilter !== 'All' && String(t.doerId) !== assignedToFilter) {
        return false;
      }

      // 4. Assigned By
      if (assignedByFilter !== 'All' && String(t.assignerId) !== assignedByFilter) {
        return false;
      }

      // 5. Priority
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) {
        return false;
      }

      // 6. Category
      if (categoryFilter !== 'All' && t.category !== categoryFilter) {
        return false;
      }

      // 7. Tag
      if (tagFilter !== 'All') {
        const hasTag = t.tags?.some((tg) => (tg.name || tg) === tagFilter);
        if (!hasTag) return false;
      }

      // 8. Verification
      if (verificationFilter === 'Verification Required' && !t.verificationRequired) {
        return false;
      }
      if (verificationFilter === 'None' && t.verificationRequired) {
        return false;
      }

      return true;
    });
  }, [
    scopedTasks,
    search,
    dateRange,
    customStartDate,
    customEndDate,
    assignedToFilter,
    assignedByFilter,
    priorityFilter,
    categoryFilter,
    tagFilter,
    verificationFilter,
  ]);

  // ── Final Filtered Tasks for Active Status Tab ───────────────────────────
  const filteredTasks = useMemo(() => {
    return baseFilteredTasks.filter((t) => {
      if (activeTab === 'All') return true;
      if (activeTab === 'Overdue') return isTaskOverdue(t);
      return t.status === activeTab;
    });
  }, [baseFilteredTasks, activeTab]);

  // ── Status Tab Counters ──────────────────────────────────────────────────
  const statusTabCounts = useMemo(() => {
    const counts = {
      All: baseFilteredTasks.length,
      Overdue: 0,
      Pending: 0,
      'In Progress': 0,
      'Awaiting Verification': 0,
      Completed: 0,
    };

    baseFilteredTasks.forEach((t) => {
      if (isTaskOverdue(t)) counts.Overdue += 1;
      if (t.status === 'Pending') counts.Pending += 1;
      if (t.status === 'In Progress') counts['In Progress'] += 1;
      if (t.status === 'Awaiting Verification') counts['Awaiting Verification'] += 1;
      if (t.status === 'Completed') counts.Completed += 1;
    });

    return counts;
  }, [baseFilteredTasks]);

  // ── 11 Quick Stats KPI Calculation ───────────────────────────────────────
  const kpiStats = useMemo(() => {
    const totalList = scopedTasks;
    const overdueList = baseFilteredTasks.filter(isTaskOverdue);
    const pendingList = baseFilteredTasks.filter((t) => t.status === 'Pending');
    const acceptedList = baseFilteredTasks.filter((t) => t.status === 'Accepted');
    const dependentList = baseFilteredTasks.filter((t) => t.status === 'Dependent on Others');
    const blockedList = baseFilteredTasks.filter(isTaskBlocked);
    const inProgressList = baseFilteredTasks.filter((t) => t.status === 'In Progress');
    const verifyingList = baseFilteredTasks.filter((t) => t.status === 'Awaiting Verification');
    const completedList = baseFilteredTasks.filter((t) => t.status === 'Completed');
    const inTimeList = scopedTasks.filter(
      (t) =>
        t.status === 'Completed' &&
        (!t.dueDate || new Date(t.dueDate) >= new Date(t.completedAt || t.updatedAt))
    );
    const delayedList = scopedTasks.filter(
      (t) => t.status !== 'Completed' && t.dueDate && new Date(t.dueDate) < new Date()
    );

    return [
      {
        id: 'total',
        label: 'Total',
        count: totalList.length,
        list: totalList,
        desc: 'Every task across all users.',
        dot: 'bg-slate-400',
        textColor: 'text-slate-800',
      },
      {
        id: 'overdue',
        label: 'Overdue',
        count: overdueList.length,
        list: overdueList,
        desc: 'Past their due date and not yet completed.',
        dot: 'bg-red-500',
        textColor: 'text-red-600',
      },
      {
        id: 'pending',
        label: 'Pending',
        count: pendingList.length,
        list: pendingList,
        desc: 'Assigned but not yet accepted.',
        dot: 'border-2 border-slate-400 bg-transparent',
        textColor: 'text-slate-600',
      },
      {
        id: 'accepted',
        label: 'Accepted',
        count: acceptedList.length,
        list: acceptedList,
        desc: 'Accepted by the doer, work not started.',
        dot: 'bg-cyan-500',
        textColor: 'text-cyan-600',
      },
      {
        id: 'dependent',
        label: 'Dependent on Others',
        count: dependentList.length,
        list: dependentList,
        desc: 'Waiting on another person or team.',
        dot: 'bg-amber-500',
        textColor: 'text-amber-600',
      },
      {
        id: 'blocked',
        label: 'Blocked',
        count: blockedList.length,
        list: blockedList,
        desc: 'Flagged blocked by a person, vendor or dependency.',
        dot: 'bg-orange-600',
        textColor: 'text-orange-600',
      },
      {
        id: 'in_progress',
        label: 'In Progress',
        count: inProgressList.length,
        list: inProgressList,
        desc: 'Actively being worked on.',
        dot: 'bg-orange-500',
        textColor: 'text-orange-600',
      },
      {
        id: 'verification',
        label: 'Verification',
        count: verifyingList.length,
        list: verifyingList,
        desc: 'Submitted and awaiting the assigner’s approval.',
        dot: 'bg-blue-500',
        textColor: 'text-blue-600',
      },
      {
        id: 'completed',
        label: 'Completed',
        count: completedList.length,
        list: completedList,
        desc: 'Finished and approved.',
        dot: 'bg-emerald-500',
        textColor: 'text-emerald-600',
      },
      {
        id: 'in_time',
        label: 'In Time',
        count: inTimeList.length,
        list: inTimeList,
        desc: 'Completed on or before the due date.',
        dot: 'bg-teal-500',
        textColor: 'text-teal-600',
      },
      {
        id: 'delayed',
        label: 'Delayed',
        count: delayedList.length,
        list: delayedList,
        desc: 'Still open and past the due date.',
        dot: 'bg-rose-500',
        textColor: 'text-rose-600',
      },
    ];
  }, [scopedTasks, baseFilteredTasks]);

  // ── Active Filter Count for Toolbar Badge ────────────────────────────────
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (assignedToFilter !== 'All') count++;
    if (assignedByFilter !== 'All') count++;
    if (priorityFilter !== 'All') count++;
    if (categoryFilter !== 'All') count++;
    if (tagFilter !== 'All') count++;
    if (verificationFilter !== 'All') count++;
    return count;
  }, [assignedToFilter, assignedByFilter, priorityFilter, categoryFilter, tagFilter, verificationFilter]);

  // ── Filter Clear Handlers ────────────────────────────────────────────────
  const handleClearFilters = () => {
    setSearch('');
    setDateRange('All Time');
    setCustomStartDate('');
    setCustomEndDate('');
    setAssignedToFilter('All');
    setAssignedByFilter('All');
    setPriorityFilter('All');
    setCategoryFilter('All');
    setTagFilter('All');
    setVerificationFilter('All');
    setActiveTab('All');
    setSelectedIds([]);
  };

  // ── Selection Handlers ───────────────────────────────────────────────────
  const handleToggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds.includes(t._id))) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredTasks.map((t) => t._id));
    }
  };

  // ── Drawer Handlers ──────────────────────────────────────────────────────
  const handleOpenDetails = (task) => {
    setSelectedTaskId(task._id);
    setSelectedTaskObj(task);
    setShowDetails(true);
  };

  const handleCloseDetails = () => {
    setShowDetails(false);
    setSelectedTaskId(null);
    setSelectedTaskObj(null);
    if (paramTaskId) {
      navigate('/wq/alltasks', { replace: true });
    }
  };

  const handleUpdateStatus = async (taskId, updates) => {
    try {
      const updated = await delegationService.updateDelegation(taskId, updates);
      toast.success('Status updated');
      setSelectedTaskObj(updated);
      fetchAllData();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleVerifyAndCompleteInDrawer = async (taskId, data) => {
    try {
      const updated = await delegationService.verifyAndComplete(taskId, data);
      toast.success('Task verified and completed!');
      setSelectedTaskObj(updated);
      fetchAllData();
    } catch {
      toast.error('Failed to verify task');
    }
  };

  const handleAddSubtask = async (taskId, data) => {
    const updated = await delegationService.addSubtask(taskId, data);
    setSelectedTaskObj(updated);
    fetchAllData();
  };

  const handleToggleSubtask = async (taskId, subtaskId, completed) => {
    const updated = await delegationService.toggleSubtask(taskId, subtaskId, completed);
    setSelectedTaskObj(updated);
    fetchAllData();
  };

  const handleAddRemark = async (taskId, data) => {
    const updated = await delegationService.addRemark(taskId, data);
    setSelectedTaskObj(updated);
    fetchAllData();
  };

  const handleReviseDueDate = async (taskId, data) => {
    const updated = await delegationService.reviseDueDate(taskId, data);
    toast.success('Due date revised successfully');
    setSelectedTaskObj(updated);
    fetchAllData();
  };

  const handleAddReminder = async (taskId, data) => {
    const updated = await delegationService.addReminder(taskId, data);
    toast.success('Reminder added');
    setSelectedTaskObj(updated);
    fetchAllData();
  };

  const handleAddFollowUp = async (taskId, data) => {
    const updated = await delegationService.addFollowUp(taskId, data);
    toast.success('Follow-up logged');
    setSelectedTaskObj(updated);
    fetchAllData();
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* ── 1. HEADER & PRIMARY ACTIONS ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-[#1E4C92] rounded-xl flex items-center justify-center shadow-lg shadow-[#1E4C92]/30 shrink-0">
            <LayoutGrid className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 leading-none">All Tasks</h1>
            <p className="text-xs font-bold text-slate-400 mt-1">Every task across all users</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchAllData}
            disabled={loading}
            title="Refresh all tasks"
            className="h-10 px-3.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#1E4C92]' : 'text-slate-500'}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTaskDrawer(true)}
            className="flex items-center justify-center gap-2 px-5 h-10 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl font-bold text-xs transition-all active:scale-95 shadow-sm cursor-pointer shrink-0"
          >
            <CheckSquare className="w-4 h-4" strokeWidth={2.5} />
            <span>Assign Task</span>
          </button>
        </div>
      </div>

      {/* ── 2. QUICK STATS GRID (11 KPI Metric Cards) ────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {kpiStats.map((s) => (
          <div
            key={s.id}
            onClick={() => setKpiDrill({ label: s.label, description: s.desc, list: s.list })}
            className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-[#1E4C92] transition-all cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between group"
            title={s.desc}
          >
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-[#1E4C92] transition-colors truncate">
                {s.label}
              </span>
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className={`text-2xl font-semibold ${s.textColor}`}>{s.count}</span>
              <span className="text-[10px] font-bold text-slate-400 group-hover:text-[#1E4C92] group-hover:underline">
                View →
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 3. TOOLBAR & MULTI-FACTOR FILTER CONTROLS ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Date Range Selector */}
        <div className="relative shrink-0">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="h-11 bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-3.5 pr-8 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 transition-all"
          >
            <option value="All Time">All Time</option>
            <option value="Today">Today</option>
            <option value="Yesterday">Yesterday</option>
            <option value="This Week">This Week</option>
            <option value="Last Week">Last Week</option>
            <option value="This Month">This Month</option>
            <option value="Last Month">Last Month</option>
            <option value="This Year">This Year</option>
            <option value="Custom">Custom</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Custom Start / End Dates */}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <div className="h-11 border border-slate-200 hover:border-slate-300 rounded-xl px-3 flex items-center gap-2 bg-white min-w-[135px] shadow-xs focus-within:border-[#1E4C92] focus-within:ring-2 focus-within:ring-[#1E4C92]/20 transition-all">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none w-full bg-transparent cursor-pointer"
              />
            </div>
            <span className="text-slate-400 text-xs font-bold">to</span>
            <div className="h-11 border border-slate-200 hover:border-slate-300 rounded-xl px-3 flex items-center gap-2 bg-white min-w-[135px] shadow-xs focus-within:border-[#1E4C92] focus-within:ring-2 focus-within:ring-[#1E4C92]/20 transition-all">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none w-full bg-transparent cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Filter Popover Toggle */}
        <div className="relative" ref={filterPanelRef}>
          <button
            type="button"
            onClick={() => setIsFilterFlyoutOpen((prev) => !prev)}
            className={`h-11 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-xs ${isFilterFlyoutOpen || activeFilterCount > 0
                ? 'bg-[#1E4C92]/10 border border-[#1E4C92]/30 text-[#1E4C92]'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-[#1E4C92]'
              }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#1E4C92] text-white text-[10px] flex items-center justify-center font-semibold ml-0.5">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Filter Flyout Popover Panel */}
          {isFilterFlyoutOpen && (
            <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-2xl p-5 shadow-2xl z-40 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                  Filters
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAssignedToFilter('All');
                    setAssignedByFilter('All');
                    setPriorityFilter('All');
                    setCategoryFilter('All');
                    setTagFilter('All');
                    setVerificationFilter('All');
                  }}
                  className="text-[11px] font-bold text-[#1E4C92] hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Assigned To */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">Assigned To</label>
                  <select
                    value={assignedToFilter}
                    onChange={(e) => setAssignedToFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
                  >
                    <option value="All">All Members</option>
                    {users.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.user || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assigned By */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">Assigned By</label>
                  <select
                    value={assignedByFilter}
                    onChange={(e) => setAssignedByFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
                  >
                    <option value="All">Anyone</option>
                    {users.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.user || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">Priority</label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
                  >
                    <option value="All">All Priority</option>
                    <option value="Urgent">Urgent</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">Category</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
                  >
                    <option value="All">All Categories</option>
                    {categories.map((c, i) => {
                      const name = c.name || c;
                      return (
                        <option key={i} value={name}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Tag */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">Tag</label>
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
                  >
                    <option value="All">All Tags</option>
                    {allTags.map((tg, i) => (
                      <option key={i} value={tg}>
                        {tg}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Verification */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">Verification</label>
                  <select
                    value={verificationFilter}
                    onChange={(e) => setVerificationFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
                  >
                    <option value="All">All Tasks</option>
                    <option value="Verification Required">Verification Required</option>
                    <option value="None">None</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all tasks..."
            className="w-full h-11 pl-10 pr-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 shadow-xs transition-all"
          />
        </div>

        {/* Reset Filters Button */}
        <button
          type="button"
          onClick={handleClearFilters}
          title="Reset all filters"
          className="h-11 w-11 flex items-center justify-center bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Export to Excel Button */}
        <button
          type="button"
          onClick={() => setShowExportModal(true)}
          className="h-11 px-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-[#1E4C92] rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
        >
          <FileUp className="w-4 h-4" />
          <span>Export</span>
        </button>

        {/* View Mode Switcher */}
        <div className="h-11 bg-slate-100 rounded-xl p-1 border border-slate-200 flex items-center gap-1 shadow-xs ml-auto shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title="List View"
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer ${viewMode === 'list'
                ? 'bg-[#1E4C92] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
          >
            <List className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">List</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            title="Kanban Board View"
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer ${viewMode === 'kanban'
                ? 'bg-[#1E4C92] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
          >
            <Layout className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            title="Calendar Schedule View"
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer ${viewMode === 'calendar'
                ? 'bg-[#1E4C92] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Calendar</span>
          </button>
        </div>
      </div>

      {/* ── 4. STATUS NAVIGATION TABS ────────────────────────────────────── */}
      <div className="border-b border-slate-200 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-6 min-w-max px-1">
          {STATUS_TABS.map((tab) => {
            const count = statusTabCounts[tab.key] ?? 0;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative pb-3 flex items-center gap-2 text-xs uppercase tracking-wider transition-colors cursor-pointer ${isActive ? 'text-slate-900 font-semibold' : 'text-slate-500 font-bold hover:text-slate-800'
                  }`}
              >
                {tab.key !== 'All' && <span className={`w-2 h-2 rounded-full ${tab.dot}`} />}
                <span>{tab.label}</span>
                <span className="text-slate-400 font-semibold">— {count}</span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#1E4C92] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 5. ACTIVE FILTER CHIPS BAR ───────────────────────────────────── */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 animate-in fade-in duration-200">
          <span className="text-xs font-bold text-slate-400 mr-1">Active Filters:</span>
          {assignedToFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-[#1E4C92] border border-[#1E4C92]/40 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-xs">
              <span>
                To:{' '}
                {users.find((u) => String(u._id) === assignedToFilter)?.user ||
                  users.find((u) => String(u._id) === assignedToFilter)?.name ||
                  assignedToFilter}
              </span>
              <button
                type="button"
                onClick={() => setAssignedToFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-blue-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-[#1E4C92]" />
              </button>
            </span>
          )}
          {assignedByFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-[#1E4C92] border border-[#1E4C92]/40 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-xs">
              <span>
                By:{' '}
                {users.find((u) => String(u._id) === assignedByFilter)?.user ||
                  users.find((u) => String(u._id) === assignedByFilter)?.name ||
                  assignedByFilter}
              </span>
              <button
                type="button"
                onClick={() => setAssignedByFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-blue-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-[#1E4C92]" />
              </button>
            </span>
          )}
          {priorityFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-[#1E4C92] border border-[#1E4C92]/40 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-xs">
              <span>Priority: {priorityFilter}</span>
              <button
                type="button"
                onClick={() => setPriorityFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-blue-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-[#1E4C92]" />
              </button>
            </span>
          )}
          {categoryFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-[#1E4C92] border border-[#1E4C92]/40 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-xs">
              <span>Category: {categoryFilter}</span>
              <button
                type="button"
                onClick={() => setCategoryFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-blue-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-[#1E4C92]" />
              </button>
            </span>
          )}
          {tagFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-[#1E4C92] border border-[#1E4C92]/40 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-xs">
              <span>Tag: {tagFilter}</span>
              <button
                type="button"
                onClick={() => setTagFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-blue-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-[#1E4C92]" />
              </button>
            </span>
          )}
          {verificationFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-[#1E4C92] border border-[#1E4C92]/40 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-xs">
              <span>Verification: {verificationFilter}</span>
              <button
                type="button"
                onClick={() => setVerificationFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-blue-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-[#1E4C92]" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={handleClearFilters}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 underline ml-2 cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── 6. CONTENT CONTAINER (One of 3 Selected View Modes) ───────────── */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-10 h-10 border-3 border-[#1E4C92] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs font-bold text-slate-500">Loading tasks...</p>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#1E4C92] border border-blue-200/60 flex items-center justify-center mb-3">
              <CheckSquare className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-slate-800 mb-1">No Tasks Found</h3>
            <p className="text-xs font-medium text-slate-500 max-w-md mb-4">
              Try changing your filters, search term, or date range.
            </p>
            <button
              type="button"
              onClick={handleClearFilters}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Clear Filters
            </button>
          </div>
        ) : viewMode === 'kanban' ? (
          <TaskKanbanView tasks={filteredTasks} onTaskClick={handleOpenDetails} />
        ) : viewMode === 'calendar' ? (
          <TaskCalendarView tasks={filteredTasks} onTaskClick={handleOpenDetails} />
        ) : (
          /* ── 6A. List View (Default) ─────────────────────────────────── */
          <div className="space-y-3">
            {/* Header selection control */}
            <div className="flex items-center justify-between px-2 py-1 text-xs font-bold text-slate-500">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={
                    filteredTasks.length > 0 &&
                    filteredTasks.every((t) => selectedIds.includes(t._id))
                  }
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer"
                />
                <span>Select All ({selectedIds.length}/{filteredTasks.length})</span>
              </label>
            </div>

            {filteredTasks.map((task) => {
              const isSelected = selectedIds.includes(task._id);
              const isExpanded = expandedRowId === task._id;
              const overdue = isTaskOverdue(task);
              const isAssignerVerificationCue =
                task.status === 'Awaiting Verification' &&
                String(task.assignerId) === String(currentUserId);

              const assignerName =
                task.assignerName ||
                `${task.assignerFirstName || ''} ${task.assignerLastName || ''}`.trim() ||
                'Admin';
              const doerName =
                `${task.doerFirstName || ''} ${task.doerLastName || ''}`.trim() || 'Unassigned';

              const priorityColor =
                task.priority === 'Urgent'
                  ? 'text-red-600'
                  : task.priority === 'High'
                    ? 'text-orange-600'
                    : task.priority === 'Medium'
                      ? 'text-blue-600'
                      : 'text-slate-400';

              const statusBadgeStyles =
                task.status === 'Completed'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                  : task.status === 'Awaiting Verification'
                    ? 'bg-blue-50 text-blue-600 border-blue-200'
                    : task.status === 'In Progress'
                      ? 'bg-orange-50 text-orange-600 border-orange-200'
                      : overdue
                        ? 'bg-red-50 text-red-600 border-red-200'
                        : task.status === 'Hold'
                          ? 'bg-amber-50 text-amber-600 border-amber-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200';

              const dueBadge = formatDueBadge(task.dueDate);

              return (
                <div
                  key={task._id}
                  className={`bg-white rounded-2xl border transition-all duration-200 overflow-hidden shadow-xs hover:shadow-md ${isAssignerVerificationCue
                      ? 'ring-2 ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)] bg-blue-50/10 border-blue-400'
                      : isHighlighted
                        ? 'ring-2 ring-[#1E4C92] shadow-[0_0_20px_rgba(30,76,146,0.3)] border-[#1E4C92]'
                        : isExpanded
                          ? 'border-[#1E4C92]/40 ring-2 ring-[#1E4C92]/10'
                          : 'border-slate-200 hover:border-slate-300'
                    }`}
                >
                  {/* Dashboard highlight banner */}
                  {isHighlighted && (
                    <div className="bg-[#1E4C92]/10 border-b border-[#1E4C92]/20 px-4 py-1.5 flex items-center gap-2 text-xs font-semibold text-[#1E4C92]">
                      <span className="w-2 h-2 bg-[#1E4C92] rounded-full animate-ping" />
                      <span>From Dashboard Filter</span>
                    </div>
                  )}

                  {/* Primary Row Header */}
                  <div
                    onClick={() => setExpandedRowId((prev) => (prev === task._id ? null : task._id))}
                    className="p-4 flex items-center gap-3 sm:gap-4 cursor-pointer select-none"
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => handleToggleSelect(task._id)}
                      className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer shrink-0"
                    />

                    {/* Doer Avatar with Initials */}
                    <div
                      className="w-9 h-9 rounded-full bg-[#1E4C92]/10 text-[#1E4C92] font-semibold flex items-center justify-center text-xs shrink-0 border border-[#1E4C92]/30"
                      title={`Assigned to ${doerName}`}
                    >
                      {getInitials(task.doerFirstName, task.doerLastName)}
                    </div>

                    {/* Main Title & Breadcrumbs */}
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-800 hover:text-[#1E4C92] transition-colors truncate">
                          {task.taskTitle || 'Untitled Task'}
                        </h2>
                        {/* Voice Note icon */}
                        {(task.voiceNoteUrl || task.audioNote) && (
                          <Mic className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2.5} title="Voice Note" />
                        )}
                        {/* Paperclip icon */}
                        {(task.referenceDocs || (task.attachments && task.attachments.length > 0)) && (
                          <Paperclip className="w-3.5 h-3.5 text-orange-500 shrink-0" strokeWidth={2.5} title="Attachment" />
                        )}
                      </div>

                      {/* Breadcrumb Hierarchy */}
                      <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mt-0.5 truncate">
                        <span>By {assignerName}</span>
                        <span>→</span>
                        <span>To {doerName}</span>
                        {task.assigneeHierarchy && (
                          <>
                            <span>→</span>
                            <span className="text-slate-500">{task.assigneeHierarchy}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status Badge */}
                    <span
                      className={`hidden sm:inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold border uppercase tracking-wider shrink-0 ${statusBadgeStyles}`}
                    >
                      {task.status}
                    </span>

                    {/* Frequency Badge */}
                    {task.frequency || (task.recurrence && task.recurrence !== 'none') ? (
                      <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-600 border border-purple-200 shadow-xs shrink-0">
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>{String(task.frequency || task.recurrence).toUpperCase()}</span>
                      </span>
                    ) : (
                      <span className="hidden lg:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-400 border border-slate-200 shrink-0">
                        <RotateCcw className="w-2.5 h-2.5 opacity-60" />
                        <span>One Time</span>
                      </span>
                    )}

                    {/* Due Date Badge */}
                    {dueBadge && (
                      <span
                        className={`hidden md:inline-flex items-center gap-1 text-xs font-semibold shrink-0 ${overdue ? 'text-red-500 font-bold' : 'text-slate-400'
                          }`}
                      >
                        <CalendarIcon className="w-3 h-3" />
                        <span>{dueBadge}</span>
                      </span>
                    )}

                    {/* Priority Indicator */}
                    <span className={`hidden sm:inline-flex items-center gap-1 text-xs font-semibold shrink-0 ${priorityColor}`}>
                      <span>●</span>
                      <span>{task.priority || 'Medium'}</span>
                    </span>

                    {/* Relative Timestamp */}
                    <span className="hidden xl:inline-block text-[11px] font-semibold text-slate-400 shrink-0">
                      {formatTimeAgo(task.createdAt)}
                    </span>

                    {/* Expand/Collapse Chevron Indicator */}
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180 text-[#1E4C92]' : ''
                        }`}
                    />

                    {/* Row Options Trigger (⋮) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDetails(task);
                      }}
                      className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                      title="More Options"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Expanded Accordion Details */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-slate-100 bg-slate-50/50 animate-in slide-in-from-top-2 duration-200">
                      {/* Metadata Row */}
                      <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-500 mb-3 pt-1">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            Due:{' '}
                            {task.dueDate
                              ? new Date(task.dueDate).toLocaleString('en-US', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                              : 'No date set'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-purple-500" />
                          <span>By: {assignerName}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-[#1E4C92]" />
                          <span>To: {doerName}</span>
                        </div>

                        {task.category && (
                          <div className="flex items-center gap-1.5">
                            <Folder className="w-3.5 h-3.5 text-amber-500" />
                            <span>{task.category}</span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5">
                          <Flag className={`w-3.5 h-3.5 ${priorityColor}`} />
                          <span>{task.priority || 'Medium'}</span>
                        </div>
                      </div>

                      {/* Sanitized Description Preview */}
                      {task.description && (
                        <div className="border-l-2 border-[#1E4C92] pl-3 py-1 mb-3">
                          <div
                            className="text-xs font-medium text-slate-600 line-clamp-3"
                            dangerouslySetInnerHTML={{ __html: task.description }}
                          />
                        </div>
                      )}

                      {/* Dynamic Tag Chips */}
                      {task.tags && task.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          {task.tags.map((tg, idx) => {
                            const tagName = tg.name || tg;
                            const tagColorHex = tg.color || '#1E4C92';
                            return (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold border"
                                style={{
                                  backgroundColor: `${tagColorHex}15`,
                                  borderColor: `${tagColorHex}40`,
                                  color: tagColorHex,
                                }}
                              >
                                <Tag className="w-2.5 h-2.5" />
                                {tagName}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Quick CTA: View Details */}
                      <div className="pt-2 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => handleOpenDetails(task)}
                          className="px-4 py-2 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-xs"
                        >
                          <CheckSquare className="w-3.5 h-3.5" />
                          <span>View Details</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 7. MODALS, SLIDE-OVERS & DRAWERS ─────────────────────────────── */}
      {/* 1. Task Creation Drawer */}
      <TaskCreationDrawer
        isOpen={showTaskDrawer}
        onClose={() => setShowTaskDrawer(false)}
        users={users}
        categories={categories}
        onSubmit={async (data) => {
          await delegationService.createDelegation(data);
          toast.success('Task delegated successfully!');
          fetchAllData();
        }}
      />

      {/* 2. Task Details Drawer */}
      <TaskDetailsDrawer
        isOpen={showDetails}
        onClose={handleCloseDetails}
        task={selectedTaskObj}
        onUpdateStatus={handleUpdateStatus}
        onVerifyAndComplete={handleVerifyAndCompleteInDrawer}
        onAddSubtask={handleAddSubtask}
        onToggleSubtask={handleToggleSubtask}
        onAddRemark={handleAddRemark}
        onReviseDueDate={handleReviseDueDate}
        onAddReminder={handleAddReminder}
        onAddFollowUp={handleAddFollowUp}
      />

      {/* 3. Task Drilldown Drawer */}
      <TaskDrilldownDrawer
        drill={kpiDrill}
        onClose={() => setKpiDrill(null)}
        onSelectTask={(task) => {
          setKpiDrill(null);
          handleOpenDetails(task);
        }}
      />

      {/* 4. Advanced Export Modal */}
      <AdvancedExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        tasks={scopedTasks}
        users={users}
      />
    </div>
  );
}

export default AllTasks;
