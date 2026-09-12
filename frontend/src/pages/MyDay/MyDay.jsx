import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  RefreshCw,
  ClipboardList,
  Repeat,
  Radio,
  Users,
  Search,
  SlidersHorizontal,
  X,
  AlertTriangle,
  Sun,
  CalendarClock,
  Hourglass,
  CheckCircle2,
  ChevronRight,
  Play,
  Check,
  PartyPopper,
  Sparkles,
  Loader2,
} from "lucide-react";

import { useUserStore } from "../../store/userStore";
import { delegationService } from "../../services/delegation";
import { checklistApi } from "../../services/checklist";
import { CompleteTaskModal } from "./CompleteTaskModal";

// Helper: Normalize due date diff
function getDueDiffDays(dueDate) {
  if (!dueDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - now.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// Helper: Formats plain-English relative due label
function formatDueWords(task) {
  const isDone =
    task.status === "Completed" ||
    task.status === "completed";
  if (isDone) return "Completed";

  const isWaiting =
    task.status === "Awaiting Verification" ||
    task.status === "awaiting_verification";
  if (isWaiting) return "Waiting for approval";

  if (!task.dueDate) return "No date set";

  const diff = getDueDiffDays(task.dueDate);
  if (diff === null) return "No date set";

  if (diff < 0) {
    const days = Math.abs(diff);
    return `${days} ${days === 1 ? "day" : "days"} late`;
  }
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff >= 2 && diff <= 6) {
    const weekday = new Date(task.dueDate).toLocaleDateString(undefined, {
      weekday: "long",
    });
    return `Due ${weekday}`;
  }
  return `Due ${new Date(task.dueDate).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}

// Helper: Parse loop IDs
function parseLoopIds(inLoop) {
  if (!Array.isArray(inLoop)) return [];
  return inLoop.map((item) => {
    if (typeof item === "string") return item;
    return String(item?.userId || item?._id || item?.id || "");
  });
}

export function MyDay() {
  const navigate = useNavigate();
  const { taskId: paramTaskId } = useParams();
  const currentUser = useUserStore((s) => s.user);
  const me = currentUser?._id || currentUser?.id;

  // Header user greeting name
  const firstName = useMemo(() => {
    const raw =
      currentUser?.user ||
      currentUser?.name ||
      currentUser?.firstName ||
      localStorage.getItem("user") ||
      "";
    if (!raw) return "";
    try {
      if (raw.startsWith("{")) {
        const parsed = JSON.parse(raw);
        return parsed?.firstName || parsed?.user?.split(" ")[0] || "";
      }
    } catch {
      // not JSON
    }
    return raw.split(" ")[0];
  }, [currentUser]);

  // Today formatted string
  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, []);

  // Segmented switchers: 'delegation' | 'checklist' | 'loop' | 'group'
  const [activeTab, setActiveTab] = useState("delegation");

  // Raw data from APIs
  const [delegations, setDelegations] = useState([]);
  const [checklistTasks, setChecklistTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterPriority, setFilterPriority] = useState("All");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterDateRange, setFilterDateRange] = useState("All Time");

  // Modal state
  const [completeTask, setCompleteTask] = useState(null);

  // Deep link handling
  useEffect(() => {
    if (paramTaskId) {
      navigate(`/wq/delegation/${paramTaskId}`, { replace: true });
    }
  }, [paramTaskId, navigate]);

  // Load data
  const loadData = useCallback(
    async (isQuiet = false) => {
      if (isQuiet) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [delRes, chkRes] = await Promise.all([
          delegationService.getDelegations({ myWork: "true" }),
          checklistApi.getTasks({ limit: 500, doer: me || undefined }),
        ]);

        // Normalize delegations
        const normalizedDel = (delRes || []).map((t) => ({
          ...t,
          id: t._id || t.id,
          taskTitle: t.taskTitle || t.taskName || "Untitled Task",
          kind: "delegation",
          dueDate: t.dueDate ? new Date(t.dueDate) : null,
          completedAt: t.completedAt ? new Date(t.completedAt) : null,
          category: t.category || "General",
          priority: t.priority || "Medium",
          frequency: t.recurrence && t.recurrence !== "none" ? t.recurrence : "One-off",
          site: t.site || "HO",
          isLoop: false,
        }));

        // Normalize checklists
        const normalizedChk = (chkRes?.tasks || []).map((t) => ({
          ...t,
          id: t._id || t.id,
          taskTitle: t.taskName || t.taskCode || "Checklist Item",
          kind: "checklist",
          dueDate: t.plannedDate ? new Date(t.plannedDate) : null,
          completedAt: t.completedDate ? new Date(t.completedDate) : null,
          category: t.department || "Checklist",
          priority: "Medium",
          frequency: t.frequency
            ? t.frequency.charAt(0).toUpperCase() + t.frequency.slice(1)
            : "Routine",
          site: t.site || "HO",
          isLoop: false,
        }));

        setDelegations(normalizedDel);
        setChecklistTasks(normalizedChk);
      } catch (err) {
        console.error("Failed to load work items:", err);
        toast.error("Could not sync tasks");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [me]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Tab Filtering logic per MY-DAY-UI spec
  const currentTabPool = useMemo(() => {
    if (!me) {
      // Fallback: if user session is resolving, return list
      if (activeTab === "checklist") return checklistTasks;
      return delegations;
    }

    const meStr = String(me);

    switch (activeTab) {
      case "delegation":
        // delegations where doerId === me and no groupId
        return delegations.filter((t) => {
          const doerId = String(t.doerId || t.doer?._id || t.doer || "");
          const hasGroup = !!t.groupId;
          return doerId === meStr && !hasGroup;
        });

      case "checklist":
        // checklist items assigned to me
        return checklistTasks.filter((t) => {
          const doerId = String(t.doer?._id || t.doer || t.doerId || "");
          return doerId === meStr || !doerId;
        });

      case "loop":
        // delegations where doerId !== me and inLoop includes me
        return delegations.filter((t) => {
          const doerId = String(t.doerId || t.doer?._id || t.doer || "");
          const loopIds = parseLoopIds(t.inLoop || t.inLoopIds);
          return doerId !== meStr && loopIds.includes(meStr);
        });

      case "group":
        // delegations where doerId === me and !!groupId
        return delegations.filter((t) => {
          const doerId = String(t.doerId || t.doer?._id || t.doer || "");
          return doerId === meStr && !!t.groupId;
        });

      default:
        return delegations;
    }
  }, [activeTab, delegations, checklistTasks, me]);

  // Unique categories for active pool
  const availableCategories = useMemo(() => {
    const set = new Set();
    currentTabPool.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set).sort();
  }, [currentTabPool]);

  // Filter evaluation logic
  const filteredTasks = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    return currentTabPool.filter((task) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const title = (task.taskTitle || "").toLowerCase();
        const code = (task.taskCode || "").toLowerCase();
        if (!title.includes(q) && !code.includes(q)) return false;
      }

      // Status
      if (filterStatus !== "All") {
        const isDone = task.status === "Completed" || task.status === "completed";
        const isWaiting =
          task.status === "Awaiting Verification" ||
          task.status === "awaiting_verification";
        const isOverdue =
          !isDone && !isWaiting && task.dueDate && new Date(task.dueDate) < startOfToday;

        if (filterStatus === "Overdue") {
          if (!isOverdue) return false;
        } else if (filterStatus === "Completed") {
          if (!isDone) return false;
        } else if (filterStatus === "Awaiting Verification") {
          if (!isWaiting) return false;
        } else {
          if (task.status?.toLowerCase() !== filterStatus.toLowerCase()) return false;
        }
      }

      // Priority (only for delegations)
      if (activeTab !== "checklist" && filterPriority !== "All") {
        if (task.priority?.toLowerCase() !== filterPriority.toLowerCase()) return false;
      }

      // Category
      if (filterCategory !== "All") {
        if (task.category !== filterCategory) return false;
      }

      // Date Range
      if (filterDateRange !== "All Time") {
        const d = task.dueDate ? new Date(task.dueDate) : null;
        if (!d) return false;

        if (filterDateRange === "Today") {
          if (d < startOfToday || d > endOfToday) return false;
        } else if (filterDateRange === "Overdue") {
          if (d >= startOfToday) return false;
        } else if (filterDateRange === "This Week") {
          const day = now.getDay();
          const diff = now.getDate() - day + (day === 0 ? -6 : 1);
          const monday = new Date(now.setDate(diff));
          monday.setHours(0, 0, 0, 0);
          const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
          sunday.setHours(23, 59, 59, 999);
          if (d < monday || d > sunday) return false;
        } else if (filterDateRange === "This Month") {
          const first = new Date(now.getFullYear(), now.getMonth(), 1);
          const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          if (d < first || d > last) return false;
        }
      }

      return true;
    });
  }, [
    currentTabPool,
    searchQuery,
    filterStatus,
    filterPriority,
    filterCategory,
    filterDateRange,
    activeTab,
  ]);

  // Section Bucketing & Date Logic
  const groups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const buckets = {
      late: [],
      today: [],
      upcoming: [],
      waiting: [],
      done: [],
    };

    filteredTasks.forEach((task) => {
      const isDone = task.status === "Completed" || task.status === "completed";
      const isWaiting =
        task.status === "Awaiting Verification" ||
        task.status === "awaiting_verification";

      if (isDone) {
        buckets.done.push(task);
      } else if (isWaiting) {
        buckets.waiting.push(task);
      } else if (task.dueDate) {
        const d = new Date(task.dueDate);
        if (d < startOfToday) {
          buckets.late.push(task);
        } else if (d <= endOfToday) {
          buckets.today.push(task);
        } else {
          buckets.upcoming.push(task);
        }
      } else {
        // Tasks without due date belong in upcoming
        buckets.upcoming.push(task);
      }
    });

    // Sorting: Late / Today / Upcoming ascending by dueDate
    const sortByDateAsc = (a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    };

    buckets.late.sort(sortByDateAsc);
    buckets.today.sort(sortByDateAsc);
    buckets.upcoming.sort(sortByDateAsc);

    // Done: descending by completion timestamp
    buckets.done.sort((a, b) => {
      const ta = new Date(a.completedAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.completedAt || b.updatedAt || 0).getTime();
      return tb - ta;
    });

    return buckets;
  }, [filteredTasks]);

  // Pending count for celebratory banner
  const openCount = groups.late.length + groups.today.length + groups.upcoming.length;

  // Active filters count
  const activeFilters = useMemo(() => {
    const list = [];
    if (searchQuery.trim()) list.push({ key: "search", label: `"${searchQuery}"` });
    if (filterStatus !== "All") list.push({ key: "status", label: filterStatus });
    if (activeTab !== "checklist" && filterPriority !== "All")
      list.push({ key: "priority", label: `${filterPriority} Priority` });
    if (filterCategory !== "All") list.push({ key: "category", label: filterCategory });
    if (filterDateRange !== "All Time") list.push({ key: "dateRange", label: filterDateRange });
    return list;
  }, [searchQuery, filterStatus, filterPriority, filterCategory, filterDateRange, activeTab]);

  const clearFilter = (key) => {
    if (key === "search") setSearchQuery("");
    if (key === "status") setFilterStatus("All");
    if (key === "priority") setFilterPriority("All");
    if (key === "category") setFilterCategory("All");
    if (key === "dateRange") setFilterDateRange("All Time");
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    setFilterStatus("All");
    setFilterPriority("All");
    setFilterCategory("All");
    setFilterDateRange("All Time");
  };

  // Smooth scroll helper
  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Action: Start Task (Delegation)
  const handleStartTask = async (task) => {
    setBusyId(task.id);
    try {
      await delegationService.updateDelegation(task.id, { status: "In Progress" });
      toast.success("Started task");
      await loadData(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to start task");
    } finally {
      setBusyId(null);
    }
  };

  // Action: Done Task (Checklist)
  const handleCompleteChecklist = async (task) => {
    setBusyId(task.id);
    try {
      await checklistApi.completeTask(task.id, {});
      toast.success("Marked done");
      await loadData(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to mark done");
    } finally {
      setBusyId(null);
    }
  };

  // Action: Done Task (Delegation Modal Submit)
  const handleModalSubmit = async (task, data) => {
    await delegationService.updateDelegation(task.id, data);
    toast.success(
      data.status === "Awaiting Verification"
        ? "Submitted for verification"
        : "Task completed"
    );
    await loadData(true);
  };

  // Card click navigation
  const handleCardClick = (task) => {
    if (task.kind === "checklist") return; // No drawer for checklist
    navigate(`/wq/delegation/${task.id}`);
  };

  return (
    <div className="min-h-screen pb-16 bg-slate-50/50 dark:bg-slate-900/40 text-slate-800 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* 1. Header & Sync Controls */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {firstName ? `Hi ${firstName}` : "My Work"}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mt-0.5">
              {todayFormatted}
            </p>
          </div>

          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Refresh work items"
            className="w-12 h-12 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-200 dark:hover:border-emerald-800/60 shadow-xs active:scale-95 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin text-emerald-600" : ""}`} />
          </button>
        </div>

        {/* 2. Task Type Segmented Switcher */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-100/90 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 overflow-x-auto shadow-xs">
          {[
            { id: "delegation", label: "Delegation", icon: ClipboardList },
            { id: "checklist", label: "Checklist", icon: Repeat },
            { id: "loop", label: "Loop", icon: Radio },
            { id: "group", label: "Group", icon: Users },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
                className={`flex items-center gap-2 font-bold px-4 py-2.5 rounded-xl text-[13px] whitespace-nowrap transition-all select-none ${
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-white/60 dark:hover:bg-slate-700/40"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 3. Search & Filter Controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search my work…"
                className="w-full h-11 pl-10 pr-4 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-800 dark:text-slate-100 placeholder-slate-400 shadow-xs transition-all"
              />
            </div>

            {/* Filter Toggle Button */}
            <button
              onClick={() => setShowFilters((prev) => !prev)}
              type="button"
              className={`h-11 px-4 rounded-2xl border text-xs font-bold flex items-center gap-2 shadow-xs transition-all ${
                showFilters || activeFilters.length > 0
                  ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Filters</span>
              {activeFilters.length > 0 && (
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] flex items-center justify-center font-black">
                  {activeFilters.length}
                </span>
              )}
            </button>
          </div>

          {/* Collapsible Filter Row */}
          {showFilters && (
            <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-xs animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Status Dropdown */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Status
                  </label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full h-9 px-2.5 text-xs font-semibold bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Overdue">Overdue</option>
                    <option value="Pending">Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Awaiting Verification">Awaiting Verification</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                {/* Priority Dropdown (Hidden for checklists) */}
                {activeTab !== "checklist" && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                      Priority
                    </label>
                    <select
                      value={filterPriority}
                      onChange={(e) => setFilterPriority(e.target.value)}
                      className="w-full h-9 px-2.5 text-xs font-semibold bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500"
                    >
                      <option value="All">All Priorities</option>
                      <option value="Urgent">Urgent / Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                )}

                {/* Category Dropdown */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Category
                  </label>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="w-full h-9 px-2.5 text-xs font-semibold bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500"
                  >
                    <option value="All">All Categories</option>
                    {availableCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Range Dropdown */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Date Range
                  </label>
                  <select
                    value={filterDateRange}
                    onChange={(e) => setFilterDateRange(e.target.value)}
                    className="w-full h-9 px-2.5 text-xs font-semibold bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500"
                  >
                    <option value="All Time">All Time</option>
                    <option value="Today">Today</option>
                    <option value="This Week">This Week</option>
                    <option value="This Month">This Month</option>
                    <option value="Overdue">Overdue</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Active Filter Chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {activeFilters.map((f) => (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 rounded-full pl-3 pr-1.5 py-1 text-[12px] font-bold"
                >
                  <span>{f.label}</span>
                  <button
                    onClick={() => clearFilter(f.key)}
                    className="w-4 h-4 rounded-full hover:bg-emerald-200/50 dark:hover:bg-emerald-800/50 flex items-center justify-center transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

              <button
                onClick={clearAllFilters}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline ml-2 cursor-pointer"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* 4. Quick-Jump Summary Band (4 KPI Metric Tiles) */}
        <div className="grid grid-cols-4 gap-2.5 sm:gap-3.5">
          {/* LATE */}
          <div
            onClick={() => scrollToSection("sec-late")}
            className="p-3 sm:p-4 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all shadow-xs group"
          >
            <span className="text-xl sm:text-2xl font-black tracking-tight group-hover:scale-105 transition-transform">
              {groups.late.length}
            </span>
            <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider mt-0.5">
              Late
            </span>
          </div>

          {/* TODAY */}
          <div
            onClick={() => scrollToSection("sec-today")}
            className="p-3 sm:p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-900/40 text-amber-600 dark:text-amber-400 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all shadow-xs group"
          >
            <span className="text-xl sm:text-2xl font-black tracking-tight group-hover:scale-105 transition-transform">
              {groups.today.length}
            </span>
            <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider mt-0.5">
              Today
            </span>
          </div>

          {/* UPCOMING */}
          <div
            onClick={() => scrollToSection("sec-upcoming")}
            className="p-3 sm:p-4 rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-900/40 text-blue-600 dark:text-blue-400 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all shadow-xs group"
          >
            <span className="text-xl sm:text-2xl font-black tracking-tight group-hover:scale-105 transition-transform">
              {groups.upcoming.length}
            </span>
            <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider mt-0.5 truncate max-w-[70px] sm:max-w-none">
              Upcoming
            </span>
          </div>

          {/* DONE */}
          <div
            onClick={() => scrollToSection("sec-done")}
            className="p-3 sm:p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all shadow-xs group"
          >
            <span className="text-xl sm:text-2xl font-black tracking-tight group-hover:scale-105 transition-transform">
              {groups.done.length}
            </span>
            <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider mt-0.5">
              Done
            </span>
          </div>
        </div>

        {/* 7. Zero States & Celebration */}
        {loading ? (
          <div className="grid sm:grid-cols-2 gap-3.5 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 p-4 animate-pulse space-y-3"
              >
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-md w-3/4" />
                <div className="h-3 bg-slate-100 dark:bg-slate-700/60 rounded-md w-1/2" />
                <div className="h-10 bg-slate-100 dark:bg-slate-700/40 rounded-xl w-full mt-2" />
              </div>
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-16 px-4 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
            {activeFilters.length > 0 ? (
              <div className="max-w-sm mx-auto space-y-3">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Search className="w-7 h-7" />
                </div>
                <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                  Nothing matches those filters
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Try clearing search or filters to see all assigned responsibilities.
                </p>
                <button
                  onClick={clearAllFilters}
                  className="mt-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-xs font-bold rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="max-w-sm mx-auto space-y-3">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <PartyPopper className="w-7 h-7" />
                </div>
                <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                  Nothing here yet
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  When {activeTab} work is given to you, it shows up here.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {/* All caught up banner */}
            {openCount === 0 && groups.done.length > 0 && (
              <div className="flex items-center gap-4 p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-200 shadow-xs">
                <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-emerald-950 dark:text-emerald-100">
                    All caught up! 🎉
                  </h3>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                    No pending work right now. Great job keeping the queue clear.
                  </p>
                </div>
              </div>
            )}

            {/* 5. Section Lists */}
            {/* 🔴 LATE SECTION */}
            {groups.late.length > 0 && (
              <section id="sec-late" className="space-y-3 scroll-mt-6">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-xl bg-red-500 text-white shadow-xs">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-red-600 dark:text-red-400 uppercase tracking-wide">
                      Late ({groups.late.length})
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Do these first
                    </p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3.5">
                  {groups.late.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      activeTab={activeTab}
                      theme="late"
                      busy={busyId === task.id}
                      onStart={handleStartTask}
                      onChecklistDone={handleCompleteChecklist}
                      onDelegationDone={(t) => setCompleteTask(t)}
                      onClick={handleCardClick}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 🟡 TODAY SECTION */}
            {groups.today.length > 0 && (
              <section id="sec-today" className="space-y-3 scroll-mt-6">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-xl bg-amber-500 text-white shadow-xs">
                    <Sun className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                      Today ({groups.today.length})
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Due today
                    </p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3.5">
                  {groups.today.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      activeTab={activeTab}
                      theme="today"
                      busy={busyId === task.id}
                      onStart={handleStartTask}
                      onChecklistDone={handleCompleteChecklist}
                      onDelegationDone={(t) => setCompleteTask(t)}
                      onClick={handleCardClick}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 🔵 COMING UP SECTION */}
            {groups.upcoming.length > 0 && (
              <section id="sec-upcoming" className="space-y-3 scroll-mt-6">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-xl bg-blue-500 text-white shadow-xs">
                    <CalendarClock className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                      Coming up ({groups.upcoming.length})
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      For later
                    </p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3.5">
                  {groups.upcoming.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      activeTab={activeTab}
                      theme="upcoming"
                      busy={busyId === task.id}
                      onStart={handleStartTask}
                      onChecklistDone={handleCompleteChecklist}
                      onDelegationDone={(t) => setCompleteTask(t)}
                      onClick={handleCardClick}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 🟣 WAITING FOR APPROVAL SECTION */}
            {groups.waiting.length > 0 && (
              <section id="sec-waiting" className="space-y-3 scroll-mt-6">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-xl bg-indigo-500 text-white shadow-xs">
                    <Hourglass className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                      Waiting for approval ({groups.waiting.length})
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Sent, being checked
                    </p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3.5">
                  {groups.waiting.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      activeTab={activeTab}
                      theme="waiting"
                      busy={busyId === task.id}
                      onStart={handleStartTask}
                      onChecklistDone={handleCompleteChecklist}
                      onDelegationDone={(t) => setCompleteTask(t)}
                      onClick={handleCardClick}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 🟢 DONE SECTION */}
            {groups.done.length > 0 && (
              <section id="sec-done" className="space-y-3 scroll-mt-6">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-xl bg-emerald-500 text-white shadow-xs">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                      Done ({groups.done.length})
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Finished
                    </p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3.5">
                  {groups.done.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      activeTab={activeTab}
                      theme="done"
                      busy={busyId === task.id}
                      onStart={handleStartTask}
                      onChecklistDone={handleCompleteChecklist}
                      onDelegationDone={(t) => setCompleteTask(t)}
                      onClick={handleCardClick}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* 8. Complete Task Modal */}
      {completeTask && (
        <CompleteTaskModal
          isOpen={!!completeTask}
          onClose={() => setCompleteTask(null)}
          task={completeTask}
          onSubmit={handleModalSubmit}
        />
      )}
    </div>
  );
}

/**
 * TaskCard Component
 * High contrast, oversized 56px (h-14) action targets for site & field operation.
 */
function TaskCard({
  task,
  activeTab,
  theme,
  busy,
  onStart,
  onChecklistDone,
  onDelegationDone,
  onClick,
}) {
  const isChecklist = task.kind === "checklist";
  const isLoop = activeTab === "loop";
  const isDone = task.status === "Completed" || task.status === "completed";
  const isWaiting =
    task.status === "Awaiting Verification" ||
    task.status === "awaiting_verification";
  const isInProgress = task.status === "In Progress";
  const isPending = !isInProgress && !isDone && !isWaiting;

  // Theme borders & tints
  const themeStyles = {
    late: "border-l-red-500 bg-white dark:bg-[#1e273a] hover:border-red-300",
    today: "border-l-amber-500 bg-white dark:bg-[#1e273a] hover:border-amber-300",
    upcoming: "border-l-blue-400 bg-white dark:bg-[#1e273a] hover:border-blue-300",
    waiting: "border-l-indigo-400 bg-white dark:bg-[#1e273a] hover:border-indigo-300",
    done: "border-l-emerald-500 bg-white dark:bg-[#1e273a] hover:border-emerald-300",
  }[theme] || "border-l-slate-400 bg-white dark:bg-[#1e273a]";

  const dueLabel = formatDueWords(task);
  const taskCode = task.taskCode || (task.id ? `TSK-${task.id.slice(-4).toUpperCase()}` : "");

  return (
    <div
      className={`rounded-2xl border border-slate-200 dark:border-slate-700/70 border-l-4 p-4.5 flex flex-col justify-between gap-3.5 shadow-xs transition-all ${themeStyles}`}
    >
      {/* Card Header & Title */}
      <div className="space-y-1.5">
        <div
          onClick={() => onClick(task)}
          className={`group flex items-start justify-between gap-2 ${
            !isChecklist ? "cursor-pointer" : ""
          }`}
        >
          <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors line-clamp-2 leading-snug">
            {task.taskTitle}
          </h3>
          {!isChecklist && (
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
          )}
        </div>

        {/* Due wording badge & Code */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span
            className={`${
              theme === "late"
                ? "text-red-600 dark:text-red-400 font-bold"
                : theme === "today"
                ? "text-amber-600 dark:text-amber-400 font-bold"
                : theme === "done"
                ? "text-emerald-600 dark:text-emerald-400 font-bold"
                : theme === "waiting"
                ? "text-indigo-600 dark:text-indigo-400 font-bold"
                : "text-blue-600 dark:text-blue-400 font-bold"
            }`}
          >
            {dueLabel}
          </span>
          {taskCode && (
            <>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider font-mono">
                {taskCode}
              </span>
            </>
          )}
        </div>

        {/* Snippet: Frequency & Site / Department */}
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
          {task.frequency || "One-off"} · {task.site || "HO"}
          {task.category && ` · ${task.category}`}
        </div>
      </div>

      {/* Action Button Section: 56px (h-14) Oversized Touch Targets */}
      <div className="pt-1">
        {/* CASE 1: In-Loop (Follower Mode) */}
        {isLoop ? (
          <div className="h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center font-bold text-xs gap-2 select-none border border-slate-200/60 dark:border-slate-700">
            <Radio className="w-3.5 h-3.5 text-slate-400 animate-pulse" />
            <span>You are following this task</span>
          </div>
        ) : isWaiting ? (
          /* CASE 2: Waiting for Verification */
          <div className="h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50 flex items-center justify-center font-bold text-xs gap-2 select-none">
            <Hourglass className="w-3.5 h-3.5" />
            <span>Sent — waiting for approval</span>
          </div>
        ) : isDone ? (
          /* CASE 3: Finished */
          <div className="h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 flex items-center justify-center font-bold text-xs gap-2 select-none">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Well done — this is finished</span>
          </div>
        ) : isChecklist ? (
          /* CASE 4: Checklist Item (One-tap direct completion, no Start step) */
          <button
            onClick={() => onChecklistDone(task)}
            disabled={busy}
            type="button"
            className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-xs active:scale-98 transition-all disabled:opacity-50 select-none cursor-pointer"
          >
            {busy ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Check className="w-5 h-5 stroke-[2.5]" />
            )}
            <span>Done</span>
          </button>
        ) : isInProgress ? (
          /* CASE 5: Delegation in progress -> Full-width Done */
          <button
            onClick={() => onDelegationDone(task)}
            disabled={busy}
            type="button"
            className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-xs active:scale-98 transition-all disabled:opacity-50 select-none cursor-pointer"
          >
            {busy ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Check className="w-5 h-5 stroke-[2.5]" />
            )}
            <span>Done</span>
          </button>
        ) : (
          /* CASE 6: Delegation pending -> [Start] + [Done] side-by-side */
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onStart(task)}
              disabled={busy}
              type="button"
              className="flex-1 h-14 rounded-2xl border-2 border-blue-300 dark:border-blue-700/80 bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 font-extrabold text-sm flex items-center justify-center gap-2 active:scale-98 transition-all disabled:opacity-50 select-none cursor-pointer"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              <span>Start</span>
            </button>

            <button
              onClick={() => onDelegationDone(task)}
              disabled={busy}
              type="button"
              className="flex-1 h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-xs active:scale-98 transition-all disabled:opacity-50 select-none cursor-pointer"
            >
              <Check className="w-5 h-5 stroke-[2.5]" />
              <span>Done</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MyDay;
