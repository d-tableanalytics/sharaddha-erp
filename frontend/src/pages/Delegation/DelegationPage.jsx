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

const KPI_CARDS = [
  { key: 'All', label: 'Total', dot: 'bg-slate-400', textColor: 'text-slate-800' },
  { key: 'Overdue', label: 'Overdue', dot: 'bg-red-500', textColor: 'text-red-600' },
  { key: 'Pending', label: 'Pending', dot: 'border-2 border-slate-400 bg-transparent', textColor: 'text-slate-700' },
  { key: 'In Progress', label: 'In Progress', dot: 'bg-orange-500', textColor: 'text-orange-500' },
  { key: 'Awaiting Verification', label: 'Verification', dot: 'bg-blue-500', textColor: 'text-blue-600' },
  { key: 'Completed', label: 'Completed', dot: 'bg-emerald-500', textColor: 'text-emerald-600' },
];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* ── 1. HEADER & PRIMARY ACTIONS ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-[#1E4C92] rounded-xl flex items-center justify-center shadow-lg shadow-[#1E4C92]/30 shrink-0">
            <CheckSquare className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 leading-none">Delegation</h1>
            <p className="text-xs font-bold text-slate-400 mt-1">
              Delegate, track, and verify assigned tasks across your team
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            title="Refresh delegated tasks"
            className="h-10 px-3.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#1E4C92]' : 'text-slate-500'}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCreationDrawerOpen(true)}
            className="flex items-center justify-center gap-2 px-5 h-10 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl font-bold text-xs transition-all active:scale-95 shadow-sm cursor-pointer shrink-0"
          >
            <CheckSquare className="w-4 h-4" strokeWidth={2.5} />
            <span>Assign Task</span>
          </button>
        </div>
      </div>

      {/* ── 2. QUICK STATS RIBBON (6 KPI Metric Cards) ────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {KPI_CARDS.map((card) => {
          const isActive = activeTab === card.key;
          const count = statusCounts[card.key] ?? 0;
          return (
            <div
              key={card.key}
              onClick={() => setActiveTab(card.key)}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between group ${
                isActive
                  ? 'border-[#1E4C92] ring-2 ring-[#1E4C92]/20 bg-white'
                  : 'border-slate-200 bg-white hover:border-[#1E4C92]'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 group-hover:text-[#1E4C92] transition-colors truncate">
                  {card.label}
                </span>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${card.dot}`} />
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className={`text-2xl font-black ${card.textColor}`}>
                  {count}
                </span>
                <span className="text-[10px] font-bold text-slate-400 group-hover:text-[#1E4C92] group-hover:underline">
                  Filter →
                </span>
              </div>
            </div>
          );
        })}
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

        {/* Custom Start & End Dates */}
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
            className={`h-11 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-xs ${
              isFilterFlyoutOpen || activeSecondaryFilterCount > 0
                ? 'bg-[#1E4C92]/10 border border-[#1E4C92]/30 text-[#1E4C92]'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-[#1E4C92]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeSecondaryFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#1E4C92] text-white text-[10px] flex items-center justify-center font-black ml-0.5">
                {activeSecondaryFilterCount}
              </span>
            )}
          </button>

          {/* Filter Popover Content */}
          {isFilterFlyoutOpen && (
            <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-2xl p-5 shadow-2xl z-40 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
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
                  className="text-[11px] font-bold text-[#1E4C92] hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Assigned To */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                    Assigned To
                  </label>
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

                {/* Priority */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                    Priority
                  </label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
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
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                    Tag
                  </label>
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 font-bold text-slate-700 outline-none focus:border-[#1E4C92] focus:ring-1 focus:ring-[#1E4C92]"
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
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                    Verification
                  </label>
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
            placeholder="Search delegated tasks..."
            className="w-full h-11 pl-10 pr-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 shadow-xs transition-all"
          />
        </div>

        {/* Reset Filters Button */}
        <button
          type="button"
          onClick={handleClearAllFilters}
          title="Reset All Filters"
          className="h-11 w-11 flex items-center justify-center bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Export Button */}
        <button
          type="button"
          onClick={handleExport}
          title="Export CSV"
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
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'list'
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
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'kanban'
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
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'calendar'
                ? 'bg-[#1E4C92] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Calendar</span>
          </button>
        </div>
      </div>

      {/* ── 4. STATUS TAB NAVIGATION BAR ─────────────────────────────────── */}
      <div className="border-b border-slate-200 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-6 min-w-max px-1">
          {STATUS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = statusCounts[tab.key] || 0;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative pb-3 flex items-center gap-2 text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                  isActive
                    ? 'text-slate-900 font-black'
                    : 'text-slate-500 font-bold hover:text-slate-800'
                }`}
              >
                {tab.key !== 'All' && (
                  <span className={`w-2 h-2 rounded-full ${tab.dot}`} />
                )}
                <span>{tab.label}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black transition-colors ${
                    isActive ? 'bg-[#1E4C92] text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>

                {/* Active Underline Pill */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1E4C92] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 5. ACTIVE FILTER CHIPS BAR ───────────────────────────────────── */}
      {activeSecondaryFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
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

          {assignedToFilter !== 'All' && (
            <span className="inline-flex items-center gap-1.5 bg-white text-[#1E4C92] border border-[#1E4C92]/40 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-xs">
              <span>
                Assigned To: {users.find((u) => u._id === assignedToFilter)?.user || users.find((u) => u._id === assignedToFilter)?.name || 'Member'}
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
            onClick={() => {
              setPriorityFilter('All');
              setCategoryFilter('All');
              setAssignedToFilter('All');
              setTagFilter('All');
              setVerificationFilter('All');
            }}
            className="text-[11px] font-bold text-slate-500 hover:text-red-600 underline cursor-pointer ml-1"
          >
            Clear all
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
