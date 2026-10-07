import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CheckSquare,
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
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';

import delegationService from '../../services/delegation';
import TaskListView from './TaskListView';
import TaskKanbanView from './TaskKanbanView';
import TaskCalendarView from './TaskCalendarView';
import TaskCreationDrawer from './TaskCreationDrawer';
import TaskDetailsDrawer from './TaskDetailsDrawer';
import { PageHeader } from '../../components/common/PageHeader';
import { Button } from '../../components/ui/Button';
import { TabNav } from '../../components/hrms/TabNav';
import { usePermissions } from '../../hooks/usePermissions';
import { StatTile } from '../../components/workqueue/StatTile';
import { TASK_STATUS_TILES } from '../../components/workqueue/taskTiles';
import { isTaskOverdue } from './taskOverdue';

const STATUS_TABS = [
  { key: 'All', label: 'All', dot: 'bg-slate-400' },
  { key: 'Overdue', label: 'Overdue', dot: 'bg-error-500' },
  { key: 'Pending', label: 'Pending', dot: 'border-2 border-slate-400 bg-transparent' },
  { key: 'In Progress', label: 'In Progress', dot: 'bg-warning-500' },
  { key: 'Awaiting Verification', label: 'Verification', dot: 'bg-primary-500' },
  { key: 'Completed', label: 'Completed', dot: 'bg-success-500' },
];

export function DelegationPage() {
  const { taskId: paramTaskId } = useParams();
  const navigate = useNavigate();

  /**
   * WHAT THIS SCREEN OFFERS.
   *
   * Nothing on this page asked a permission before: Assign Task, Change Status
   * on a selection, Delete on a selection and the one-click verify in the row
   * menu all rendered for anybody who could reach the route - and the route was
   * gated on FMS's `view_o2d`, so "anybody" was wide.
   *
   * `manage` is the bulk cell deliberately. Changing the status of forty tasks
   * at once, or binning them, is not the same grant as editing the one task you
   * have open - it is the same authority the Trash Bin needs, which is why the
   * server puts both behind `manage_work_queue`.
   */
  const { can } = usePermissions();
  const canCreate = can('work_queue', 'tasks', 'create');
  const canVerify = can('work_queue', 'completion', 'edit');
  const canBulkEdit = can('work_queue', 'administration', 'approve');
  const canBulkDelete = can('work_queue', 'administration', 'delete');

  // ── Data states ──────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── UI states ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban' | 'calendar'
  const [activeTab, setActiveTab] = useState('All');
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [isFilterFlyoutOpen, setIsFilterFlyoutOpen] = useState(false);
  const filterPanelRef = useRef(null);

  // ── Overlays states ──────────────────────────────────────────────────────
  const [isCreationDrawerOpen, setIsCreationDrawerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  // ── Filter states ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('All Time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [assignedToFilter, setAssignedToFilter] = useState('All');
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
          dateRange: dateRange !== 'All Time' ? dateRange : undefined,
          customStartDate: dateRange === 'Custom' ? customStartDate : undefined,
          customEndDate: dateRange === 'Custom' ? customEndDate : undefined,
        }),
        delegationService.getUsers(),
        delegationService.getCategories(),
      ]);

      setTasks(tasksRes || []);
      setUsers(usersRes || []);
      setCategories(catRes || []);

    } catch (err) {
      toast.error('Failed to load delegated tasks');
    } finally {
      setLoading(false);
    }
  }, [dateRange, customStartDate, customEndDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /*
   * A deep link (My Day, a notification) opens its task by id.
   *
   * Once per id, not on every reload — re-selecting it inside `fetchData` made
   * a drawer the user had closed spring back open after any bulk action. And
   * fetched on its own: this list is the tasks the viewer ASSIGNED, so a doer
   * following a link to their own task never found it in there.
   */
  const openedLinkRef = useRef(null);
  useEffect(() => {
    if (!paramTaskId || openedLinkRef.current === paramTaskId) return;
    openedLinkRef.current = paramTaskId;
    delegationService.getDelegationById(paramTaskId)
      .then((task) => { if (task) setSelectedTask(task); })
      .catch((err) => toast.error(err?.response?.data?.message || 'That task could not be opened.'));
  }, [paramTaskId]);

  const handleCloseDetails = () => {
    setSelectedTask(null);
    if (paramTaskId) navigate('/wq/delegation', { replace: true });
  };

  // ── Unique Tags for Filter ───────────────────────────────────────────────
  const uniqueTags = useMemo(() => {
    const set = new Set();
    tasks.forEach((t) => {
      t.tags?.forEach((tg) => {
        const name = tg.name || tg;
        if (name) set.add(name);
      });
    });
    return Array.from(set);
  }, [tasks]);

  // ── Filtered Tasks Calculation ───────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const titleMatch = t.taskTitle?.toLowerCase().includes(q);
        const descMatch = t.description?.toLowerCase().includes(q);
        const doerMatch = `${t.doerFirstName} ${t.doerLastName}`.toLowerCase().includes(q);
        if (!titleMatch && !descMatch && !doerMatch) return false;
      }

      // Priority
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) {
        return false;
      }

      // Category
      if (categoryFilter !== 'All' && t.category !== categoryFilter) {
        return false;
      }

      // Assigned To
      if (assignedToFilter !== 'All' && t.doerId !== assignedToFilter) {
        return false;
      }

      // Tag
      if (tagFilter !== 'All') {
        const hasTag = t.tags?.some((tg) => (tg.name || tg) === tagFilter);
        if (!hasTag) return false;
      }

      // Verification
      if (verificationFilter === 'Verification Required' && !t.verificationRequired) {
        return false;
      }
      if (verificationFilter === 'None' && t.verificationRequired) {
        return false;
      }

      // Status Tab
      const isOverdue = isTaskOverdue(t);

      if (activeTab === 'Overdue') {
        return isOverdue;
      }
      if (activeTab !== 'All' && t.status !== activeTab) {
        return false;
      }

      return true;
    });
  }, [
    tasks,
    search,
    priorityFilter,
    categoryFilter,
    assignedToFilter,
    tagFilter,
    verificationFilter,
    activeTab,
  ]);

  // ── Pre-computed Status Counts ───────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const counts = {
      All: 0,
      Overdue: 0,
      Pending: 0,
      'In Progress': 0,
      'Awaiting Verification': 0,
      Completed: 0,
    };

    tasks.forEach((t) => {
      // Check secondary filters
      if (search.trim()) {
        const q = search.toLowerCase();
        const titleMatch = t.taskTitle?.toLowerCase().includes(q);
        const descMatch = t.description?.toLowerCase().includes(q);
        const doerMatch = `${t.doerFirstName} ${t.doerLastName}`.toLowerCase().includes(q);
        if (!titleMatch && !descMatch && !doerMatch) return;
      }
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) return;
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return;
      if (assignedToFilter !== 'All' && t.doerId !== assignedToFilter) return;
      if (tagFilter !== 'All') {
        const hasTag = t.tags?.some((tg) => (tg.name || tg) === tagFilter);
        if (!hasTag) return;
      }

      counts.All += 1;

      const isOverdue = isTaskOverdue(t);

      if (isOverdue) counts.Overdue += 1;
      if (t.status === 'Pending') counts.Pending += 1;
      if (t.status === 'In Progress') counts['In Progress'] += 1;
      if (t.status === 'Awaiting Verification') counts['Awaiting Verification'] += 1;
      if (t.status === 'Completed') counts.Completed += 1;
    });

    return counts;
  }, [tasks, search, priorityFilter, categoryFilter, assignedToFilter, tagFilter]);

  // ── Active Filter Count for Badge ────────────────────────────────────────
  const activeSecondaryFilterCount = useMemo(() => {
    let count = 0;
    if (priorityFilter !== 'All') count++;
    if (categoryFilter !== 'All') count++;
    if (assignedToFilter !== 'All') count++;
    if (tagFilter !== 'All') count++;
    if (verificationFilter !== 'All') count++;
    return count;
  }, [priorityFilter, categoryFilter, assignedToFilter, tagFilter, verificationFilter]);

  // ── Clear All Filters ────────────────────────────────────────────────────
  const handleClearAllFilters = () => {
    setSearch('');
    setDateRange('All Time');
    setCustomStartDate('');
    setCustomEndDate('');
    setPriorityFilter('All');
    setCategoryFilter('All');
    setAssignedToFilter('All');
    setTagFilter('All');
    setVerificationFilter('All');
    setActiveTab('All');
    setSelectedIds([]);
  };

  // ── Select Handlers ──────────────────────────────────────────────────────
  const handleToggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (filteredTasks.every((t) => selectedIds.includes(t._id))) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredTasks.map((t) => t._id));
    }
  };

  // ── Bulk Actions Handlers ────────────────────────────────────────────────
  const handleBulkStatusUpdate = async (newStatus) => {
    if (selectedIds.length === 0) return;
    setIsBulkUpdating(true);
    const count = selectedIds.length;
    const toastId = toast.loading(`Updating ${count} task(s) to "${newStatus}"...`);
    try {
      const res = await delegationService.bulkUpdateStatus(selectedIds, newStatus);
      /*
       * The SERVER's count, not the selection's.
       *
       * Tasks mirrored from an O2D stage are skipped by the bulk endpoints on
       * purpose — their status is the stage's to decide — and the response says
       * how many. Reporting the number selected instead would tell somebody
       * five tasks moved when four did, which is the one thing a bulk action
       * must never do.
       */
      toast.success(
        res?.message ?? `Successfully updated ${count} task(s) to "${newStatus}"`,
        { id: toastId },
      );
      setSelectedIds([]);
      setBulkStatusOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update selected tasks', { id: toastId });
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setIsBulkDeleting(true);
    const count = selectedIds.length;
    const toastId = toast.loading(`Moving ${count} task(s) to Trash...`);
    try {
      const res = await delegationService.bulkDelete(selectedIds);
      // The server's count — see the note in `handleBulkStatusUpdate`.
      toast.success(
        res?.message ?? `Successfully moved ${count} task(s) to Trash Bin`,
        { id: toastId },
      );
      setSelectedIds([]);
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete selected tasks', { id: toastId });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // ── Quick Verify & Complete ──────────────────────────────────────────────
  const handleQuickVerify = async (taskId) => {
    try {
      await delegationService.verifyAndComplete(taskId, { notes: 'One-click quick verification' });
      toast.success('Task verified and completed!');
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to verify task');
    }
  };

  // ── Task Details Handlers ────────────────────────────────────────────────
  const handleOpenDetails = (task) => {
    setSelectedTask(task);
  };

  const handleUpdateStatus = async (taskId, updates) => {
    try {
      const updated = await delegationService.updateDelegation(taskId, updates);
      toast.success('Status updated');
      setSelectedTask(updated);
      fetchData();
    } catch (err) {
      // The server says WHY — needs verification, needs evidence, not yours.
      toast.error(err?.response?.data?.message || 'Failed to update status');
    }
  };

  const handleVerifyAndCompleteInDrawer = async (taskId, data) => {
    try {
      const updated = await delegationService.verifyAndComplete(taskId, data);
      toast.success('Task verified and completed!');
      setSelectedTask(updated);
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to verify task');
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

  const handleOverrideAssignee = async (taskId, data) => {
    try {
      const updated = await delegationService.overrideAssignee(taskId, data);
      toast.success(data.resume ? 'Automatic buddy rotation resumed' : 'Task assigned');
      setSelectedTask(updated);
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to change the assignee');
      throw err;
    }
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
      setSelectedTask(null);
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete task');
      throw err;
    }
  };

  // ── Export to Excel / CSV ────────────────────────────────────────────────
  const handleExport = () => {
    if (filteredTasks.length === 0) {
      toast.error('No tasks to export');
      return;
    }

    const headers = [
      'Task Title',
      'Assignee',
      'Hierarchy',
      'Status',
      'Priority',
      'Category',
      'Due Date',
      'Recurrence',
      'Verification Required',
      'Completed Date',
    ];

    const rows = filteredTasks.map((t) => [
      `"${(t.taskTitle || '').replace(/"/g, '""')}"`,
      `"${t.doerFirstName} ${t.doerLastName}"`,
      `"${(t.assigneeHierarchy || '').replace(/"/g, '""')}"`,
      t.status,
      t.priority,
      t.category,
      t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : '',
      t.recurrence || 'none',
      t.verificationRequired ? 'Yes' : 'No',
      t.completedAt ? new Date(t.completedAt).toISOString().split('T')[0] : '',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `Delegated_Tasks_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Export downloaded successfully!');
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* ── 1. HEADER & PRIMARY ACTIONS ──────────────────────────────────── */}
      {/*
        The shared PageHeader, as O2D and every HRMS page use it. It carries the
        title, the description line and the right-aligned actions, and draws the
        bottom rule every other page in the portal ends its header with.

        The 40px icon tile is dropped: no other page in the portal puts an icon
        beside its title, and the sidebar already marks which page this is.
      */}
      <PageHeader
        title="Delegation"
        subtitle="Delegate, track, and verify assigned tasks across your team"
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setIsCreationDrawerOpen(true)}>
              <CheckSquare className="w-4 h-4 mr-2" />
              Assign Task
            </Button>
          ) : null
        }
      />

      {/* ── 2. QUICK STATS RIBBON (6 KPI Metric Cards) ────────────────────── */}
      {/*
        The HR Dashboard's Quick Access tile, carrying a count: same shell, same
        40px toned chip, same label type, same `gap-3` grid. The six statuses
        come from the list Loop Tasks reads too, so the two ribbons match.
      */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {TASK_STATUS_TILES.map((card) => (
          <StatTile
            key={card.key}
            icon={card.icon}
            tone={card.tone}
            label={card.label}
            value={statusCounts[card.key] ?? 0}
            active={activeTab === card.key}
            title={`Show ${card.label.toLowerCase()} tasks`}
            onClick={() => setActiveTab(card.key)}
          />
        ))}
      </div>

      {/* ── 3. TOOLBAR & MULTI-FACTOR FILTER CONTROLS ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Date Range Selector */}
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

        {/* Custom Start & End Dates */}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <div className="border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2 bg-white min-w-[135px] shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-semibold text-slate-700 outline-none w-full bg-transparent cursor-pointer"
              />
            </div>
            <span className="text-slate-400 text-xs font-semibold">to</span>
            <div className="border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2 bg-white min-w-[135px] shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-xs font-semibold text-slate-700 outline-none w-full bg-transparent cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Filter Popover Toggle */}
        <div className="relative" ref={filterPanelRef}>
          <button
            type="button"
            onClick={() => setIsFilterFlyoutOpen((prev) => !prev)}
            className={`h-11 px-4 rounded-lg font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-enterprise ${isFilterFlyoutOpen || activeSecondaryFilterCount > 0
                ? 'bg-primary-50 border border-primary-200 text-primary-700'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-primary-700'
              }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeSecondaryFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-[10px] flex items-center justify-center font-semibold ml-0.5">
                {activeSecondaryFilterCount}
              </span>
            )}
          </button>

          {/* Filter Popover Content */}
          {isFilterFlyoutOpen && (
            <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl p-5 shadow-enterprise-lg z-40 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                  Filters
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPriorityFilter('All');
                    setCategoryFilter('All');
                    setAssignedToFilter('All');
                    setTagFilter('All');
                    setVerificationFilter('All');
                  }}
                  className="text-[11px] font-semibold text-primary-700 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Assigned To */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
                    Assigned To
                  </label>
                  <select
                    value={assignedToFilter}
                    onChange={(e) => setAssignedToFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Members</option>
                    {users.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.user || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
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
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
                    Tag
                  </label>
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Tags</option>
                    {uniqueTags.map((tg, i) => (
                      <option key={i} value={tg}>
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
            placeholder="Search delegated tasks..."
            className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {/* Reset Filters Button */}
        <button
          type="button"
          onClick={handleClearAllFilters}
          title="Reset All Filters"
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-colors shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Export Button */}
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
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'list'
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
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'kanban'
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
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'calendar'
                ? 'bg-primary-600 text-white shadow-enterprise'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Calendar</span>
          </button>
        </div>
      </div>

      {/* ── 4. STATUS TAB NAVIGATION BAR ─────────────────────────────────── */}
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

      {/* ── 5. ACTIVE FILTER CHIPS BAR ───────────────────────────────────── */}
      {activeSecondaryFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {priorityFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-semibold shadow-enterprise">
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
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-semibold shadow-enterprise">
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

          {assignedToFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-semibold shadow-enterprise">
              <span>
                Assigned To: {users.find((u) => u._id === assignedToFilter)?.user || users.find((u) => u._id === assignedToFilter)?.name || 'Member'}
              </span>
              <button
                type="button"
                onClick={() => setAssignedToFilter('All')}
                className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-primary-700" />
              </button>
            </span>
          )}

          {tagFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-semibold shadow-enterprise">
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
            <span className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-semibold shadow-enterprise">
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
            onClick={() => {
              setPriorityFilter('All');
              setCategoryFilter('All');
              setAssignedToFilter('All');
              setTagFilter('All');
              setVerificationFilter('All');
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-error-600 underline cursor-pointer ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── BULK ACTION BAR ─────────────────────────────────────────────── */}
      {/*
        The bar itself is gated, not just its buttons: a selection bar offering
        nothing but "Clear" is a worse answer than no bar.
      */}
      {selectedIds.length > 0 && (canBulkEdit || canBulkDelete) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-primary-600 text-white rounded-xl shadow-enterprise-lg animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
            <span className="text-xs font-semibold">{selectedIds.length} tasks selected</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Bulk status dropdown */}
            {canBulkEdit && (
            <div className="relative">
              <button
                type="button"
                disabled={isBulkUpdating}
                onClick={() => setBulkStatusOpen(!bulkStatusOpen)}
                className="px-3.5 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span>Change Status</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {bulkStatusOpen && (
                <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-48 bg-white rounded-lg shadow-enterprise-lg border border-slate-200 py-1.5 z-50 text-slate-900 animate-in fade-in zoom-in-95 duration-150">
                  {['Pending', 'In Progress', 'Awaiting Verification', 'Completed'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleBulkStatusUpdate(st)}
                      className="w-full px-3.5 py-2 text-left text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between"
                    >
                      <span>{st}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Bulk Delete */}
            {canBulkDelete && (
            <button
              type="button"
              disabled={isBulkDeleting}
              onClick={handleBulkDelete}
              className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-error-500 hover:bg-error-600 text-white shadow-enterprise px-3 py-1.5 text-xs gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete ({selectedIds.length})</span>
            </button>
            )}

            {/* Clear Selection */}
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── 4. CONTENT AREA (Switchable View Mode) ────────────────────────── */}
      {viewMode === 'list' && (
        <TaskListView
          tasks={filteredTasks}
          loading={loading}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onOpenDetails={handleOpenDetails}
          // Withheld rather than gated inside the row: TaskListView renders the
          // verify control only when it is given a handler, so not passing one
          // is how a viewer's rows come back without it.
          onQuickVerify={canVerify ? handleQuickVerify : undefined}
          onClearFilters={handleClearAllFilters}
        />
      )}

      {viewMode === 'kanban' && (
        <TaskKanbanView tasks={filteredTasks} onTaskClick={handleOpenDetails} />
      )}

      {viewMode === 'calendar' && (
        <TaskCalendarView tasks={filteredTasks} onTaskClick={handleOpenDetails} />
      )}

      {/* ── 5. OVERLAYS & DRAWERS ────────────────────────────────────────── */}
      <TaskCreationDrawer
        isOpen={isCreationDrawerOpen}
        onClose={() => setIsCreationDrawerOpen(false)}
        users={users}
        categories={categories}
        onSubmit={async (data) => {
          await delegationService.createDelegation(data);
          toast.success('Task delegated successfully!');
          fetchData();
        }}
      />

      <TaskDetailsDrawer
        isOpen={Boolean(selectedTask)}
        onClose={handleCloseDetails}
        task={selectedTask}
        onUpdateStatus={handleUpdateStatus}
        onVerifyAndComplete={handleVerifyAndCompleteInDrawer}
        onAddSubtask={handleAddSubtask}
        onToggleSubtask={handleToggleSubtask}
        onAddRemark={handleAddRemark}
        onReviseDueDate={handleReviseDueDate}
        onOverrideAssignee={handleOverrideAssignee}
        onAddReminder={handleAddReminder}
        onAddFollowUp={handleAddFollowUp}
        onDeleteTask={handleDeleteTask}
      />
    </div>
  );
}

export default DelegationPage;
