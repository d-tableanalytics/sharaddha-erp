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
} from 'lucide-react';
import toast from 'react-hot-toast';

import delegationService from '../../services/delegation';
import TaskListView from './TaskListView';
import TaskKanbanView from './TaskKanbanView';
import TaskCalendarView from './TaskCalendarView';
import TaskCreationDrawer from './TaskCreationDrawer';
import TaskDetailsDrawer from './TaskDetailsDrawer';

const STATUS_TABS = [
  { key: 'All', label: 'All', dot: 'bg-slate-400' },
  { key: 'Overdue', label: 'Overdue', dot: 'bg-red-500' },
  { key: 'Pending', label: 'Pending', dot: 'border-2 border-slate-400 bg-transparent' },
  { key: 'In Progress', label: 'In Progress', dot: 'bg-orange-500' },
  { key: 'Awaiting Verification', label: 'Verification', dot: 'bg-blue-500' },
  { key: 'Completed', label: 'Completed', dot: 'bg-emerald-500' },
];

export function DelegationPage() {
  const { taskId: paramTaskId } = useParams();
  const navigate = useNavigate();

  // ── Data states ──────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── UI states ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban' | 'calendar'
  const [activeTab, setActiveTab] = useState('All');
  const [selectedIds, setSelectedIds] = useState([]);
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

      // If deep-linked task ID is present, select it
      if (paramTaskId && tasksRes) {
        const match = tasksRes.find((t) => t._id === paramTaskId);
        if (match) setSelectedTask(match);
      }
    } catch (err) {
      toast.error('Failed to load delegated tasks');
    } finally {
      setLoading(false);
    }
  }, [dateRange, customStartDate, customEndDate, paramTaskId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      const isOverdue =
        t.dueDate &&
        t.status !== 'Completed' &&
        t.status !== 'Awaiting Verification' &&
        new Date(t.dueDate).getTime() < Date.now();

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

      const isOverdue =
        t.dueDate &&
        t.status !== 'Completed' &&
        t.status !== 'Awaiting Verification' &&
        new Date(t.dueDate).getTime() < Date.now();

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

  // ── Quick Verify & Complete ──────────────────────────────────────────────
  const handleQuickVerify = async (taskId) => {
    try {
      await delegationService.verifyAndComplete(taskId, { notes: 'One-click quick verification' });
      toast.success('Task verified and completed!');
      fetchData();
    } catch (err) {
      toast.error('Failed to verify task');
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
      toast.error('Failed to update status');
    }
  };

  const handleVerifyAndCompleteInDrawer = async (taskId, data) => {
    try {
      const updated = await delegationService.verifyAndComplete(taskId, data);
      toast.success('Task verified and completed!');
      setSelectedTask(updated);
      fetchData();
    } catch (err) {
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
    <div className="min-h-screen bg-slate-50/60 p-4 md:p-8">
      {/* ── 1. TOOLBAR ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* + Assign Task Button */}
        <button
          onClick={() => setIsCreationDrawerOpen(true)}
          className="h-11 px-5 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl font-bold text-xs tracking-wide shadow-sm flex items-center gap-2 transition-all active:scale-95 shrink-0"
        >
          <CheckSquare className="w-4 h-4" />
          <span>+ Assign Task</span>
        </button>

        {/* Date Range Dropdown */}
        <div className="relative shrink-0">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="h-11 bg-white border border-[#1E4C92] rounded-xl pl-3.5 pr-9 text-xs font-bold text-slate-700 shadow-xs appearance-none outline-none cursor-pointer focus:ring-2 focus:ring-[#1E4C92]/20"
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
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Custom Start & End Dates (shown when dateRange === 'Custom') */}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <div className="h-11 bg-white border border-[#1E4C92] rounded-xl px-2.5 flex items-center gap-1.5 shadow-xs">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none bg-transparent"
              />
            </div>
            <span className="text-xs font-bold text-slate-400">to</span>
            <div className="h-11 bg-white border border-[#1E4C92] rounded-xl px-2.5 flex items-center gap-1.5 shadow-xs">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none bg-transparent"
              />
            </div>
          </div>
        )}

        {/* Filter Button & Flyout Panel */}
        <div className="relative" ref={filterPanelRef}>
          <button
            onClick={() => setIsFilterFlyoutOpen((prev) => !prev)}
            className={`h-11 px-4 rounded-xl font-bold text-xs tracking-wide shadow-sm flex items-center gap-2 transition-all shrink-0 ${
              isFilterFlyoutOpen
                ? 'bg-slate-800 text-white'
                : 'bg-[#1E4C92] hover:bg-[#163a6a] text-white'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Filter</span>
            {activeSecondaryFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-white text-[#1E4C92] text-[10px] font-black flex items-center justify-center shadow-xs">
                {activeSecondaryFilterCount}
              </span>
            )}
          </button>

          {/* Floating Filter Popover */}
          {isFilterFlyoutOpen && (
            <div className="absolute top-[calc(100%+8px)] left-0 z-50 min-w-[280px] shadow-enterprise bg-white rounded-2xl border border-slate-200 p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-xs font-black uppercase text-slate-700 tracking-wider">
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
                  className="text-[11px] font-bold text-[#1E4C92] hover:underline"
                >
                  Clear All
                </button>
              </div>

              {/* Assigned To */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                  Assigned To
                </label>
                <select
                  value={assignedToFilter}
                  onChange={(e) => setAssignedToFilter(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                >
                  <option value="All">All Members</option>
                  {users.map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.user || u.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                  Priority
                </label>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg outline-none"
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
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                  Category
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                >
                  <option value="All">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tag */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                  Tag
                </label>
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                >
                  <option value="All">All Tags</option>
                  {uniqueTags.map((tg) => (
                    <option key={tg} value={tg}>
                      {tg}
                    </option>
                  ))}
                </select>
              </div>

              {/* Verification */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                  Verification
                </label>
                <select
                  value={verificationFilter}
                  onChange={(e) => setVerificationFilter(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                >
                  <option value="All">All Tasks</option>
                  <option value="Verification Required">Verification Required</option>
                  <option value="None">None</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full h-11 pl-10 pr-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1E4C92]/20 focus:border-[#1E4C92] transition-all"
          />
        </div>

        {/* Clear Filters Reset Button */}
        <button
          onClick={handleClearAllFilters}
          title="Reset All Filters"
          className="h-11 w-11 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl flex items-center justify-center shadow-sm transition-all active:scale-95 shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Export Button */}
        <button
          onClick={handleExport}
          className="h-11 px-4 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl font-bold text-xs tracking-wide shadow-sm flex items-center gap-2 transition-all active:scale-95 shrink-0 ml-auto"
        >
          <FileUp className="w-4 h-4" />
          <span>Export</span>
        </button>

        {/* View Mode Switcher */}
        <div className="h-11 bg-white rounded-xl p-1 border border-slate-200 flex items-center gap-1 shadow-xs shrink-0">
          <button
            onClick={() => setViewMode('list')}
            title="List View"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'list'
                ? 'bg-[#1E4C92] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">List</span>
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            title="Kanban Board View"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'kanban'
                ? 'bg-[#1E4C92] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layout className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            title="Calendar Schedule View"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'calendar'
                ? 'bg-[#1E4C92] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Calendar</span>
          </button>
        </div>
      </div>

      {/* ── 2. STATUS TAB NAVIGATION BAR ─────────────────────────────────── */}
      <div className="border-b border-slate-200 mb-5 overflow-x-auto">
        <div className="flex items-center gap-6 min-w-max">
          {STATUS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = statusCounts[tab.key] || 0;

            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative pb-3 flex items-center gap-2 text-xs uppercase tracking-wider transition-colors ${
                  isActive
                    ? 'text-slate-900 font-black'
                    : 'text-slate-500 font-bold hover:text-slate-800'
                }`}
              >
                {tab.key !== 'All' && (
                  <span className={`w-2 h-2 rounded-full ${tab.dot}`} />
                )}
                <span>{tab.label}</span>
                <span className="text-slate-400 font-semibold">— {count}</span>

                {/* Active Underline Pill */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#1E4C92] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 3. ACTIVE FILTER CHIPS BAR ───────────────────────────────────── */}
      {activeSecondaryFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {priorityFilter !== 'All' && (
            <span className="bg-white border border-[#1E4C92]/40 text-[#1E4C92] rounded-full text-[11px] font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
              <span>Priority: {priorityFilter}</span>
              <button onClick={() => setPriorityFilter('All')} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {categoryFilter !== 'All' && (
            <span className="bg-white border border-[#1E4C92]/40 text-[#1E4C92] rounded-full text-[11px] font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
              <span>Category: {categoryFilter}</span>
              <button onClick={() => setCategoryFilter('All')} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {assignedToFilter !== 'All' && (
            <span className="bg-white border border-[#1E4C92]/40 text-[#1E4C92] rounded-full text-[11px] font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
              <span>
                Assigned To: {users.find((u) => u._id === assignedToFilter)?.user || 'Member'}
              </span>
              <button onClick={() => setAssignedToFilter('All')} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {tagFilter !== 'All' && (
            <span className="bg-white border border-[#1E4C92]/40 text-[#1E4C92] rounded-full text-[11px] font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
              <span>Tag: {tagFilter}</span>
              <button onClick={() => setTagFilter('All')} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {verificationFilter !== 'All' && (
            <span className="bg-white border border-[#1E4C92]/40 text-[#1E4C92] rounded-full text-[11px] font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
              <span>Verification: {verificationFilter}</span>
              <button onClick={() => setVerificationFilter('All')} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          <button
            onClick={() => {
              setPriorityFilter('All');
              setCategoryFilter('All');
              setAssignedToFilter('All');
              setTagFilter('All');
              setVerificationFilter('All');
            }}
            className="text-[11px] font-bold text-slate-500 hover:text-red-600 underline ml-1"
          >
            Clear chips
          </button>
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
          onQuickVerify={handleQuickVerify}
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
        onClose={() => setSelectedTask(null)}
        task={selectedTask}
        onUpdateStatus={handleUpdateStatus}
        onVerifyAndComplete={handleVerifyAndCompleteInDrawer}
        onAddSubtask={handleAddSubtask}
        onToggleSubtask={handleToggleSubtask}
        onAddRemark={handleAddRemark}
        onReviseDueDate={handleReviseDueDate}
        onAddReminder={handleAddReminder}
        onAddFollowUp={handleAddFollowUp}
      />
    </div>
  );
}

export default DelegationPage;
