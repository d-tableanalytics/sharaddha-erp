import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Bell,
  Calendar as CalendarIcon,
  RotateCcw,
  Search,
  FileUp,
  List,
  Layout,
  Calendar,
  X,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
  Folder,
  Flag,
  Tag,
  MoreVertical,
  CheckSquare,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useUserStore } from '../../store/userStore';
import delegationService from '../../services/delegation';
import TaskKanbanView from '../Delegation/TaskKanbanView';
import TaskCalendarView from '../Delegation/TaskCalendarView';
import TaskDetailsDrawer from '../Delegation/TaskDetailsDrawer';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { PageHeader } from '../../components/common/PageHeader';
import { Button } from '../../components/ui/Button';
import { TabNav } from '../../components/hrms/TabNav';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';

// Status Tab definitions
const STATUS_TABS = [
  { key: 'All', label: 'All', dot: 'bg-slate-400' },
  { key: 'Overdue', label: 'Overdue', dot: 'bg-error-500' },
  { key: 'Pending', label: 'Pending', dot: 'border-2 border-slate-400 bg-transparent' },
  { key: 'In Progress', label: 'In Progress', dot: 'bg-warning-500' },
  { key: 'Awaiting Verification', label: 'Verification', dot: 'bg-primary-500' },
  { key: 'Completed', label: 'Completed', dot: 'bg-success-500' },
];

const KPI_CARDS = [
  { key: 'All', countKey: 'Total', label: 'Total', dot: 'bg-slate-400', textColor: 'text-slate-900' },
  { key: 'Overdue', countKey: 'Overdue', label: 'Overdue', dot: 'bg-error-500', textColor: 'text-error-600' },
  { key: 'Pending', countKey: 'Pending', label: 'Pending', dot: 'border-2 border-slate-400 bg-transparent', textColor: 'text-slate-700' },
  { key: 'In Progress', countKey: 'In Progress', label: 'In Progress', dot: 'bg-warning-500', textColor: 'text-warning-500' },
  { key: 'Awaiting Verification', countKey: 'Awaiting Verification', label: 'Verification', dot: 'bg-primary-500', textColor: 'text-primary-600' },
  { key: 'Completed', countKey: 'Completed', label: 'Completed', dot: 'bg-success-500', textColor: 'text-success-600' },
];

// Helper: Extract Initials
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

// Helper: Check if task is overdue
function isTaskOverdue(task) {
  if (!task?.dueDate) return false;
  if (task.status === 'Completed' || task.status === 'Awaiting Verification') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

// Helper: Extract all in-loop user IDs safely
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

export function InLoopTasks() {
  const { taskId: paramTaskId } = useParams();
  const navigate = useNavigate();
  const currentUser = useUserStore((s) => s.user);

  const currentUserId = currentUser?._id || currentUser?.id;
  const userRole = String(currentUser?.role || '').toUpperCase();
  const isAdmin =
    userRole === 'ADMIN' ||
    userRole === 'SUPERADMIN' ||
    userRole === 'SUPER ADMIN' ||
    userRole === 'MANAGEMENT';

  // ── Data states ──────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Admin Employee Switcher state ────────────────────────────────────────
  const [loopOwnerId, setLoopOwnerId] = useState('');
  const viewingId = (isAdmin && loopOwnerId) ? loopOwnerId : currentUserId;

  // ── UI states ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban' | 'calendar'
  const [activeTab, setActiveTab] = useState('All');
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [isFilterFlyoutOpen, setIsFilterFlyoutOpen] = useState(false);
  const filterPanelRef = useRef(null);

  // ── Overlays states ──────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState(null);
  const [showDrawer, setShowDrawer] = useState(false);

  // ── Filter states ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('All Time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [assignedByFilter, setAssignedByFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [verificationFilter, setVerificationFilter] = useState('All');

  // Dismiss filter panel on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(event.target)) {
        setIsFilterFlyoutOpen(false);
      }
    }
    if (isFilterFlyoutOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFilterFlyoutOpen]);

  // ── Fetch Initial Data ───────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, usersRes, catRes] = await Promise.all([
        delegationService.getDelegations({
          scope: 'inLoop',
          inLoopUserId: viewingId || undefined,
          viewAll: isAdmin ? 'true' : undefined,
        }),
        delegationService.getUsers(),
        delegationService.getCategories(),
      ]);

      setTasks(tasksRes || []);
      setUsers(usersRes || []);
      setCategories(catRes || []);

      // Deep linking: if paramTaskId is present, open drawer
      if (paramTaskId && tasksRes) {
        const match = tasksRes.find((t) => t._id === paramTaskId);
        if (match) {
          setSelectedTask(match);
          setShowDrawer(true);
        } else {
          // If not in pre-filtered list, attempt direct fetch
          delegationService.getDelegationById(paramTaskId)
            .then((res) => {
              if (res) {
                setSelectedTask(res);
                setShowDrawer(true);
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      toast.error('Failed to load loop tasks');
    } finally {
      setLoading(false);
    }
  }, [viewingId, isAdmin, paramTaskId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── In-Loop Base Tasks ───────────────────────────────────────────────────
  // Curates only tasks where the active viewingId is present in task.inLoopIds
  const inLoopTasks = useMemo(() => {
    if (!viewingId) return tasks;
    return tasks.filter((t) => {
      const loopIds = getInLoopUserIds(t);
      return loopIds.includes(String(viewingId));
    });
  }, [tasks, viewingId]);

  // ── Dynamic Unique Tags ──────────────────────────────────────────────────
  const allTags = useMemo(() => {
    const set = new Set();
    inLoopTasks.forEach((t) => {
      t.tags?.forEach((tg) => {
        const name = tg.name || tg;
        if (name) set.add(name);
      });
    });
    return Array.from(set);
  }, [inLoopTasks]);

  // ── Dynamic Assigners List for Filter ────────────────────────────────────
  const availableAssigners = useMemo(() => {
    const map = new Map();
    inLoopTasks.forEach((t) => {
      if (t.assignerId) {
        const name =
          t.assignerName ||
          `${t.assignerFirstName || ''} ${t.assignerLastName || ''}`.trim() ||
          'Assigner';
        map.set(String(t.assignerId), name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [inLoopTasks]);

  // ── Base Filtered Tasks (Secondary Filters without Status Tab) ───────────
  const baseFilteredTasks = useMemo(() => {
    return inLoopTasks.filter((t) => {
      // 1. Live substring search
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

      // 3. Assigned By
      if (assignedByFilter !== 'All' && String(t.assignerId) !== assignedByFilter) {
        return false;
      }

      // 4. Priority
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) {
        return false;
      }

      // 5. Category
      if (categoryFilter !== 'All' && t.category !== categoryFilter) {
        return false;
      }

      // 6. Tag
      if (tagFilter !== 'All') {
        const hasTag = t.tags?.some((tg) => (tg.name || tg) === tagFilter);
        if (!hasTag) return false;
      }

      // 7. Verification
      if (verificationFilter === 'Verification Required' && !t.verificationRequired) {
        return false;
      }
      if (verificationFilter === 'None' && t.verificationRequired) {
        return false;
      }

      return true;
    });
  }, [
    inLoopTasks,
    search,
    dateRange,
    customStartDate,
    customEndDate,
    assignedByFilter,
    priorityFilter,
    categoryFilter,
    tagFilter,
    verificationFilter,
  ]);

  // ── Final Filtered Tasks (including Status Tab) ──────────────────────────
  const filteredTasks = useMemo(() => {
    return baseFilteredTasks.filter((t) => {
      const overdue = isTaskOverdue(t);
      if (activeTab === 'Overdue') {
        return overdue;
      }
      if (activeTab !== 'All' && t.status !== activeTab) {
        return false;
      }
      return true;
    });
  }, [baseFilteredTasks, activeTab]);

  // ── Precomputed Status Counts ────────────────────────────────────────────
  const statusCounts = useMemo(() => {
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

  // Quick stats ribbon counts (based on all inLoopTasks for active viewingId)
  const ribbonCounts = useMemo(() => {
    const counts = {
      Total: inLoopTasks.length,
      Overdue: 0,
      Pending: 0,
      'In Progress': 0,
      'Awaiting Verification': 0,
      Completed: 0,
    };

    inLoopTasks.forEach((t) => {
      if (isTaskOverdue(t)) counts.Overdue += 1;
      if (t.status === 'Pending') counts.Pending += 1;
      if (t.status === 'In Progress') counts['In Progress'] += 1;
      if (t.status === 'Awaiting Verification') counts['Awaiting Verification'] += 1;
      if (t.status === 'Completed') counts.Completed += 1;
    });

    return counts;
  }, [inLoopTasks]);

  // ── Active Filter Count for Badge ────────────────────────────────────────
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (assignedByFilter !== 'All') count++;
    if (priorityFilter !== 'All') count++;
    if (categoryFilter !== 'All') count++;
    if (tagFilter !== 'All') count++;
    if (verificationFilter !== 'All') count++;
    return count;
  }, [assignedByFilter, priorityFilter, categoryFilter, tagFilter, verificationFilter]);

  // ── Reset / Clear Filters ────────────────────────────────────────────────
  const handleClearAllFilters = () => {
    setSearch('');
    setDateRange('All Time');
    setCustomStartDate('');
    setCustomEndDate('');
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
    if (filteredTasks.every((t) => selectedIds.includes(t._id))) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredTasks.map((t) => t._id));
    }
  };

  // ── Drawer Handlers ──────────────────────────────────────────────────────
  const handleOpenDetails = (task) => {
    setSelectedTask(task);
    setShowDrawer(true);
  };

  const handleCloseDrawer = () => {
    setShowDrawer(false);
    setSelectedTask(null);
    if (paramTaskId) {
      navigate('/wq/looptasks', { replace: true });
    }
  };

  const handleUpdateStatus = async (taskId, updates) => {
    try {
      const updated = await delegationService.updateDelegation(taskId, updates);
      toast.success('Status updated');
      setSelectedTask(updated);
      fetchData();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleVerifyAndCompleteInDrawer = async (taskId, data) => {
    try {
      const updated = await delegationService.verifyAndComplete(taskId, data);
      toast.success('Task verified and completed!');
      setSelectedTask(updated);
      fetchData();
    } catch {
      toast.error('Failed to verify task');
    }
  };

  const handleAddSubtask = async (taskId, data) => {
    const updated = await delegationService.addSubtask(taskId, data);
    setSelectedTask(updated);
    fetchData();
  };

  const handleToggleSubtask = async (taskId, subtaskId, completed) => {
    const updated = await delegationService.toggleSubtask(taskId, subtaskId, completed);
    setSelectedTask(updated);
    fetchData();
  };

  const handleAddRemark = async (taskId, data) => {
    const updated = await delegationService.addRemark(taskId, data);
    setSelectedTask(updated);
    fetchData();
  };

  const handleReviseDueDate = async (taskId, data) => {
    const updated = await delegationService.reviseDueDate(taskId, data);
    toast.success('Due date revised successfully');
    setSelectedTask(updated);
    fetchData();
  };

  const handleAddReminder = async (taskId, data) => {
    const updated = await delegationService.addReminder(taskId, data);
    toast.success('Reminder added');
    setSelectedTask(updated);
    fetchData();
  };

  const handleAddFollowUp = async (taskId, data) => {
    const updated = await delegationService.addFollowUp(taskId, data);
    toast.success('Follow-up logged');
    setSelectedTask(updated);
    fetchData();
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await delegationService.deleteDelegation(taskId);
      toast.success('Task moved to Trash Bin');
      handleCloseDrawer();
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete task');
      throw err;
    }
  };

  // ── Excel / CSV Export ───────────────────────────────────────────────────
  const handleExport = () => {
    if (filteredTasks.length === 0) {
      toast.error('No tasks to export');
      return;
    }

    const headers = [
      'Task Title',
      'Assigned By',
      'Assignee',
      'Hierarchy',
      'Status',
      'Priority',
      'Category',
      'Due Date',
      'Recurrence',
      'Verification Required',
      'Created Date',
    ];

    const rows = filteredTasks.map((t) => [
      `"${(t.taskTitle || '').replace(/"/g, '""')}"`,
      `"${(t.assignerName || `${t.assignerFirstName || ''} ${t.assignerLastName || ''}`).trim()}"`,
      `"${(t.doerFirstName || '')} ${(t.doerLastName || '')}".trim()`,
      `"${(t.assigneeHierarchy || '').replace(/"/g, '""')}"`,
      t.status,
      t.priority,
      t.category,
      t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : '',
      t.recurrence || 'none',
      t.verificationRequired ? 'Yes' : 'No',
      t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : '',
    ]);

    // UTF-8 BOM prefix for seamless Excel parsing
    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `In_Loop_Tasks_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Export downloaded successfully');
  };

  // Dynamic Subtitle Text
  const dynamicSubtitle = useMemo(() => {
    if (isAdmin && viewingId !== currentUserId) {
      const viewingUser = users.find((u) => (u._id || u.id) === viewingId);
      const name = viewingUser?.user || viewingUser?.name || viewingUser?.firstName || 'this employee';
      const firstName = name.split(' ')[0];
      return `Loop tasks of ${firstName || 'this employee'}`;
    }
    return 'Tasks you are copied on for followup';
  }, [isAdmin, viewingId, currentUserId, users]);

  // Priority color config
  const priorityColors = {
    Urgent: 'text-error-500',
    High: 'text-warning-500',
    Medium: 'text-primary-500',
    Low: 'text-slate-400',
  };

  const priorityDots = {
    Urgent: 'bg-error-500',
    High: 'bg-warning-500',
    Medium: 'bg-primary-500',
    Low: 'bg-slate-400',
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* ── 1. HEADER & ADMIN EMPLOYEE SWITCHER ───────────────────────── */}
      {/*
        The shared PageHeader, as O2D and every HRMS page use it. It carries the
        title, the description line and the right-aligned actions, and draws the
        bottom rule every other page in the portal ends its header with.

        The 40px icon tile is dropped: no other page in the portal puts an icon
        beside its title, and the sidebar already marks which page this is.
      */}
      <PageHeader
        title="Loop Tasks"
        subtitle={dynamicSubtitle}
        actions={
          <>
          {/* Refresh Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchData}
            disabled={loading}
            title="Refresh loop tasks"
          >
            <RotateCcw className={`w-3.5 h-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {/* Role-Gated Admin Switcher */}
          {isAdmin && (
            <div className="relative shrink-0">
              <select
                id="admin-employee-switcher"
                value={loopOwnerId || currentUserId}
                onChange={(e) => {
                  const val = e.target.value;
                  setLoopOwnerId(val === currentUserId ? '' : val);
                  setSelectedIds([]);
                }}
                className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              >
                <option value={currentUserId}>My loop tasks</option>
                {users.map((u) => {
                  const uId = u._id || u.id;
                  if (uId === currentUserId) return null;
                  const uName =
                    u.user ||
                    u.name ||
                    `${u.firstName || ''} ${u.lastName || ''}`.trim() ||
                    u.email;
                  return (
                    <option key={uId} value={uId}>
                      Employee: {uName}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
          </>
        }
      />

      {/* ── 2. QUICK STATS RIBBON (6 KPI Metric Cards) ────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {KPI_CARDS.map((card) => {
          const isActive = activeTab === card.key;
          const count = ribbonCounts[card.countKey] ?? 0;
          return (
            <div
              key={card.key}
              onClick={() => setActiveTab(card.key)}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer shadow-enterprise hover:shadow-md flex flex-col justify-between group ${
                isActive
                  ? 'border-primary-600 ring-2 ring-primary-500/20 bg-white'
                  : 'border-slate-200 bg-white hover:border-primary-600'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-primary-700 transition-colors truncate">
                  {card.label}
                </span>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${card.dot}`} />
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className={`text-2xl font-semibold ${card.textColor}`}>
                  {count}
                </span>
                <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary-700 group-hover:underline">
                  Filter →
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 3. TOOLBAR & MULTI-FACTOR FILTERING SYSTEM ─────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Date Range Preset Selector */}
        <div className="relative shrink-0">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
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

        {/* Custom Start & End Date Inputs */}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <div className="border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2 bg-white min-w-[135px] shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none w-full bg-transparent cursor-pointer"
              />
            </div>
            <span className="text-slate-400 text-xs font-bold">to</span>
            <div className="border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2 bg-white min-w-[135px] shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
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
            className={`h-11 px-4 rounded-lg font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-enterprise ${
              isFilterFlyoutOpen || activeFilterCount > 0
                ? 'bg-primary-50 border border-primary-200 text-primary-700'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-primary-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-[10px] flex items-center justify-center font-semibold ml-0.5">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Floating Filter Popover Panel */}
          {isFilterFlyoutOpen && (
            <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl p-5 shadow-enterprise-lg z-40 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                  Filters
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAssignedByFilter('All');
                    setPriorityFilter('All');
                    setCategoryFilter('All');
                    setTagFilter('All');
                    setVerificationFilter('All');
                  }}
                  className="text-[11px] font-bold text-primary-700 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Assigned By */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
                    Assigned By
                  </label>
                  <select
                    value={assignedByFilter}
                    onChange={(e) => setAssignedByFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">Anyone</option>
                    {availableAssigners.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
                    Priority
                  </label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Priorities</option>
                    <option value="Urgent">Urgent</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
                    Category
                  </label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Categories</option>
                    {categories.map((c) => (
                      <option key={c._id || c.name || c} value={c.name || c}>
                        {c.name || c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tag */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
                    Tag
                  </label>
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Tags</option>
                    {allTags.map((tg) => (
                      <option key={tg} value={tg}>
                        {tg}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Verification */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
                    Verification
                  </label>
                  <select
                    value={verificationFilter}
                    onChange={(e) => setVerificationFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Tasks</option>
                    <option value="Verification Required">Verification Required</option>
                    <option value="None">No Verification</option>
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
            placeholder="Search in loop tasks..."
            className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Reset / Clear Button */}
        <button
          type="button"
          title="Reset Filters"
          onClick={handleClearAllFilters}
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-colors shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Export to Excel */}
        <button
          type="button"
          onClick={handleExport}
          title="Export CSV"
          className="inline-flex items-center justify-center gap-2 font-medium rounded-lg px-3 py-1.5 text-xs bg-transparent border border-slate-300 hover:bg-slate-50 text-slate-700 transition-all active:scale-[0.98] shrink-0"
        >
          <FileUp className="w-4 h-4" />
          <span>Export</span>
        </button>

        {/* View Mode Switcher */}
        <div className="bg-slate-100 rounded-lg p-1 border border-slate-200 ml-auto flex items-center gap-1 shadow-enterprise shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title="List View"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'list'
                ? 'bg-primary-600 text-white shadow-enterprise'
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
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'kanban'
                ? 'bg-primary-600 text-white shadow-enterprise'
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
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'calendar'
                ? 'bg-primary-600 text-white shadow-enterprise'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Calendar</span>
          </button>
        </div>
      </div>

      {/* ── 4. STATUS NAVIGATION TAB STRIP ─────────────────────────────── */}
      {/*
        The portal's tab strip, components/hrms/TabNav.jsx, which every
        multi-view HRMS module uses.

        The strip this replaces was a second implementation of the same control
        that agreed with it on nothing: `text-xs uppercase tracking-wider` against
        TabNav's `text-sm font-semibold`, an absolutely-positioned bar for the
        active marker instead of a `border-b-2`, `gap-6` between tabs against
        `gap-1`, and a solid `bg-primary-600` count pill where TabNav tints the
        active one `bg-primary-100 text-primary-700`.

        The status dot has no equivalent in TabNav, so it rides along inside the
        label - which TabNav renders as-is, JSX included.
      */}
      <TabNav
        tabs={STATUS_TABS.map((tab) => ({
          key: tab.key,
          label: (
            <span className="inline-flex items-center gap-2">
              {tab.key !== 'All' && <span className={`w-2 h-2 rounded-full ${tab.dot}`} />}
              {tab.label}
            </span>
          ),
          badge: statusCounts[tab.key] || 0,
        }))}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {/* ── 5. ACTIVE FILTER CHIPS ─────────────────────────────────────── */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {assignedByFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-enterprise">
              <span>
                Assigned By: {availableAssigners.find((a) => a.id === assignedByFilter)?.name || assignedByFilter}
              </span>
              <button
                type="button"
                onClick={() => setAssignedByFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-primary-700" />
              </button>
            </span>
          )}

          {priorityFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-enterprise">
              <span>Priority: {priorityFilter}</span>
              <button
                type="button"
                onClick={() => setPriorityFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-primary-700" />
              </button>
            </span>
          )}

          {categoryFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-enterprise">
              <span>Category: {categoryFilter}</span>
              <button
                type="button"
                onClick={() => setCategoryFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-primary-700" />
              </button>
            </span>
          )}

          {tagFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-enterprise">
              <span>Tag: {tagFilter}</span>
              <button
                type="button"
                onClick={() => setTagFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-primary-700" />
              </button>
            </span>
          )}

          {verificationFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-enterprise">
              <span>Verification: {verificationFilter}</span>
              <button
                type="button"
                onClick={() => setVerificationFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-primary-700" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={handleClearAllFilters}
            className="text-[11px] font-bold text-slate-500 hover:text-error-600 underline cursor-pointer ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── 6. CONTENT AREA ────────────────────────────────────────────── */}
      {loading ? (
        /* Loading State */
        <div className="flex flex-col items-center justify-center py-24">
          <LoadingSpinner size={32} className="mb-4" />
          <p className="text-sm font-bold text-slate-600">Loading Loop Tasks...</p>
        </div>
      ) : inLoopTasks.length === 0 ? (
        /* No In-Loop Tasks at all */
        <EmptyState
          title="No Tasks In-Loop"
          description="Tasks you are copied on will appear here."
          icon={<CheckSquare className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
        />
      ) : filteredTasks.length === 0 ? (
        /* Filter Mismatch State */
        <div>
          <EmptyState
            title="No Tasks Match Filters"
            description="Try changing your filters or date range."
            icon={<CheckSquare className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
          />
          <div className="flex justify-center mt-4">
            <button type="button" onClick={handleClearAllFilters} className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 cursor-pointer">
              Clear Filters
            </button>
          </div>
        </div>
      ) : viewMode === 'kanban' ? (
        /* 6B. Kanban Board View */
        <TaskKanbanView tasks={filteredTasks} onTaskClick={handleOpenDetails} />
      ) : viewMode === 'calendar' ? (
        /* 6C. Calendar Schedule View */
        <TaskCalendarView tasks={filteredTasks} onTaskClick={handleOpenDetails} />
      ) : (
        /* 6A. List View (Default) */
        <div className="space-y-3">
          {/* Select All Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 shadow-enterprise">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={
                  filteredTasks.length > 0 &&
                  filteredTasks.every((t) => selectedIds.includes(t._id))
                }
                onChange={handleSelectAll}
                className="w-4 h-4 rounded border-slate-300 accent-primary-600 cursor-pointer"
              />
              <span>Select All ({filteredTasks.length})</span>
            </div>
            {selectedIds.length > 0 && (
              <span className="text-xs font-bold text-primary-700 bg-primary-50 px-2.5 py-0.5 rounded-full">
                {selectedIds.length} Selected
              </span>
            )}
          </div>

          {/* Task Row Items */}
          {filteredTasks.map((task) => {
            const isExpanded = expandedRowId === task._id;
            const isSelected = selectedIds.includes(task._id);
            const overdue = isTaskOverdue(task);

            // Assigner name derivation
            const assignerFirst =
              task.assignerFirstName ||
              (task.assignerName || '').split(' ')[0] ||
              'Team';
            const assignerLast =
              task.assignerLastName ||
              (task.assignerName || '').split(' ').slice(1).join(' ') ||
              '';
            const assignerFullName = `${assignerFirst} ${assignerLast}`.trim();

            // Status Badge styles
            let statusVariant = 'neutral';
            if (task.status === 'Completed') {
              statusVariant = 'success';
            } else if (task.status === 'Awaiting Verification') {
              statusVariant = 'primary';
            } else if (task.status === 'In Progress') {
              statusVariant = 'warning';
            } else if (overdue) {
              statusVariant = 'danger';
            } else if (task.status === 'Need Revision') {
              statusVariant = 'warning';
            }

            return (
              <div
                key={task._id}
                className={`group bg-white rounded-lg border transition-all duration-200 ${
                  task.status === 'Awaiting Verification'
                    ? 'border-primary-300 ring-2 ring-primary-500/20 bg-primary-50/10 shadow-enterprise hover:shadow-md'
                    : 'border-slate-200 hover:border-slate-300 shadow-enterprise hover:shadow-md'
                }`}
              >
                {/* Collapsed Row Header */}
                <div
                  onClick={() =>
                    setExpandedRowId((prev) => (prev === task._id ? null : task._id))
                  }
                  className="px-4 py-3.5 flex flex-wrap items-center gap-3 md:gap-4 cursor-pointer select-none"
                >
                  {/* Selection Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => handleToggleSelect(task._id)}
                    className="w-4 h-4 rounded border-slate-300 accent-primary-600 cursor-pointer"
                  />

                  {/* Assigner Avatar */}
                  <div
                    title={`Assigned by ${assignerFullName}`}
                    className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 font-semibold text-xs flex items-center justify-center border border-primary-200 shrink-0 shadow-enterprise"
                  >
                    {getInitials(assignerFirst, assignerLast)}
                  </div>

                  {/* Assigner & Hierarchy */}
                  <div className="hidden sm:flex flex-col min-w-[130px] max-w-[170px] shrink-0">
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      From: {assignerFullName}
                    </span>
                    <span className="text-[11px] font-bold text-primary-700 truncate">
                      ↳ {task.assigneeHierarchy || 'Team Member'}
                    </span>
                  </div>

                  {/* Task Title */}
                  <div className="flex-1 min-w-[180px]">
                    <h4 className="text-sm font-semibold text-slate-900 line-clamp-1 group-hover:text-primary-700 transition-colors">
                      {task.taskTitle}
                    </h4>
                    <div className="sm:hidden text-[10px] font-bold text-slate-400">
                      From: {assignerFullName}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <Badge variant={statusVariant} className="shrink-0">
                    {task.status}
                  </Badge>

                  {/* Due Date Badge */}
                  <span
                    className={`hidden md:inline-flex items-center gap-1 text-[10px] font-bold shrink-0 ${
                      overdue ? 'text-error-600 font-bold' : 'text-slate-400'
                    }`}
                  >
                    {task.dueDate
                      ? new Date(task.dueDate).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })
                      : 'No due date'}
                  </span>

                  {/* Priority Indicator */}
                  <div className="hidden lg:flex items-center gap-1.5 shrink-0 text-xs font-semibold">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        priorityDots[task.priority] || 'bg-slate-400'
                      }`}
                    />
                    <span className={priorityColors[task.priority] || 'text-slate-600'}>
                      {task.priority || 'Medium'}
                    </span>
                  </div>

                  {/* Relative Timestamp */}
                  <span className="hidden xl:inline-block text-[11px] font-bold text-slate-400 shrink-0 min-w-[50px] text-right">
                    {formatTimeAgo(task.createdAt)}
                  </span>

                  {/* Options / Drawer Trigger (⋮) */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title="Task Details"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDetails(task);
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    <div className="p-1 text-slate-400">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Accordion Details */}
                {isExpanded && (
                  <div className="px-6 pb-5 pt-2 border-t border-slate-100 bg-slate-50/50 rounded-b-xl animate-in slide-in-from-top-2 duration-300">
                    {/* Metadata Pill Row */}
                    <div className="flex flex-wrap items-center gap-4 py-3 text-xs font-bold text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Clock
                          className={`w-3.5 h-3.5 ${
                            overdue ? 'text-error-500' : 'text-slate-400'
                          }`}
                        />
                        <span className={overdue ? 'text-error-600' : 'text-slate-600'}>
                          Due:{' '}
                          {task.dueDate
                            ? new Date(task.dueDate).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })
                            : 'No date set'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>Assigned by: {assignerFullName}</span>
                      </div>

                      {task.category && (
                        <div className="flex items-center gap-1.5">
                          <Folder className="w-3.5 h-3.5 text-slate-400" />
                          <span>{task.category}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5">
                        <Flag
                          className={`w-3.5 h-3.5 ${
                            priorityColors[task.priority] || 'text-slate-400'
                          }`}
                        />
                        <span>{task.priority}</span>
                      </div>
                    </div>

                    {/* Sanitized Description Snippet */}
                    {task.description && (
                      <div className="border-l-2 border-primary-200 pl-3 py-1 mb-3">
                        <div
                          className="text-xs font-medium text-slate-600 line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: task.description }}
                        />
                      </div>
                    )}

                    {/* Dynamic Tag Chips */}
                    {task.tags && task.tags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 pb-3">
                        {task.tags.map((tg, idx) => {
                          const tagName = tg.name || tg;
                          const tagColorHex = tg.color || '#2563eb';
                          return (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border"
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
                        className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 cursor-pointer"
                      >
                        <Bell className="w-3.5 h-3.5" />
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

      {/* ── 7. OVERLAYS & SLIDE-OVER DRAWER INTEGRATION ─────────────────── */}
      <TaskDetailsDrawer
        isOpen={showDrawer}
        onClose={handleCloseDrawer}
        task={selectedTask}
        onUpdateStatus={handleUpdateStatus}
        onVerifyAndComplete={handleVerifyAndCompleteInDrawer}
        onAddSubtask={handleAddSubtask}
        onToggleSubtask={handleToggleSubtask}
        onAddRemark={handleAddRemark}
        onReviseDueDate={handleReviseDueDate}
        onAddReminder={handleAddReminder}
        onAddFollowUp={handleAddFollowUp}
        onDeleteTask={handleDeleteTask}
      />
    </div>
  );
}

export default InLoopTasks;
