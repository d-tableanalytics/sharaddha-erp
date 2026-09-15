import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
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
  ChevronDown,
} from "lucide-react";

import { useUserStore } from "../../store/userStore";
import { delegationService } from "../../services/delegation";
import { checklistApi } from "../../services/checklist";
import { CompleteTaskModal } from "./CompleteTaskModal";
import { PageHeader } from '../../components/common/PageHeader';
import { TabNav } from '../../components/hrms/TabNav';

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

  // Counts for each tab in switcher
  const tabCounts = useMemo(() => {
    if (!me) {
      return {
        delegation: delegations.length,
        checklist: checklistTasks.length,
        loop: 0,
        group: 0,
      };
    }
    const meStr = String(me);
    const delCount = delegations.filter((t) => {
      const doerId = String(t.doerId || t.doer?._id || t.doer || "");
      return doerId === meStr && !t.groupId;
    }).length;

    const chkCount = checklistTasks.filter((t) => {
      const doerId = String(t.doer?._id || t.doer || t.doerId || "");
      return doerId === meStr || !doerId;
    }).length;

    const loopCount = delegations.filter((t) => {
      const doerId = String(t.doerId || t.doer?._id || t.doer || "");
      const loopIds = parseLoopIds(t.inLoop || t.inLoopIds);
      return doerId !== meStr && loopIds.includes(meStr);
    }).length;

    const groupCount = delegations.filter((t) => {
      const doerId = String(t.doerId || t.doer?._id || t.doer || "");
      return doerId === meStr && !!t.groupId;
    }).length;

    return {
      delegation: delCount,
      checklist: chkCount,
      loop: loopCount,
      group: groupCount,
    };
  }, [delegations, checklistTasks, me]);

  // Tab Filtering logic per MY-DAY-UI spec
  const currentTabPool = useMemo(() => {
    if (!me) {
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
    <div className="flex flex-col gap-6 pb-10">
      {/* 1. Header & Sync Controls */}
      {/*
        The shared PageHeader, as O2D and every HRMS page use it. It carries the
        title, the description line and the right-aligned actions, and draws the
        bottom rule every other page in the portal ends its header with.

        The 40px icon tile is dropped: no other page in the portal puts an icon
        beside its title, and the sidebar already marks which page this is.
      */}
      <PageHeader
        title={firstName ? `Hi ${firstName}` : "My Work"}
        subtitle={`${todayFormatted} · Your personal responsibilities & work queue`}
      />

      {/* 2. Task Type Switcher */}
      {/*
        These four are tabs over one dataset, so they are the portal's tab strip
        - components/hrms/TabNav.jsx - rather than a filled-pill segmented group
        of their own. The segmented control stays where it belongs, on the
        Scoreboard's period and scope switchers, which choose a FILTER rather
        than a view.

        TabNav renders whatever JSX the label holds, so each tab keeps its icon.
      */}
      <TabNav
        tabs={[
          { id: "delegation", label: "Delegation", icon: ClipboardList, count: tabCounts.delegation },
          { id: "checklist", label: "Checklist", icon: Repeat, count: tabCounts.checklist },
          { id: "loop", label: "Loop", icon: Radio, count: tabCounts.loop },
          { id: "group", label: "Group", icon: Users, count: tabCounts.group },
        ].map((tab) => {
          const Icon = tab.icon;
          return {
            key: tab.id,
            label: (
              <span className="inline-flex items-center gap-2">
                <Icon className="w-4 h-4 shrink-0" />
                {tab.label}
              </span>
            ),
            badge: tab.count,
          };
        })}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

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
              placeholder="Search my work by title or code…"
              className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
          </div>

          {/* Filter Toggle Button */}
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            type="button"
            className={`h-11 px-4 rounded-xl border text-xs font-bold flex items-center gap-2 shadow-enterprise transition-all cursor-pointer ${
              showFilters || activeFilters.length > 0
                ? "bg-primary-50 border-primary-200 text-primary-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Filters</span>
            {activeFilters.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-[10px] flex items-center justify-center font-semibold">
                {activeFilters.length}
              </span>
            )}
          </button>
        </div>

        {/* Collapsible Filter Row */}
        {showFilters && (
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-enterprise animate-in fade-in duration-150">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Status Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Status
                </label>
                <div className="relative">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Overdue">Overdue</option>
                    <option value="Pending">Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Awaiting Verification">Awaiting Verification</option>
                    <option value="Completed">Completed</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Priority Dropdown (Hidden for checklists) */}
              {activeTab !== "checklist" && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Priority
                  </label>
                  <div className="relative">
                    <select
                      value={filterPriority}
                      onChange={(e) => setFilterPriority(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    >
                      <option value="All">All Priorities</option>
                      <option value="Urgent">Urgent / Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Category Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Category
                </label>
                <div className="relative">
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All">All Categories</option>
                    {availableCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Date Range Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Date Range
                </label>
                <div className="relative">
                  <select
                    value={filterDateRange}
                    onChange={(e) => setFilterDateRange(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="All Time">All Time</option>
                    <option value="Today">Today</option>
                    <option value="This Week">This Week</option>
                    <option value="This Month">This Month</option>
                    <option value="Overdue">Overdue</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
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
                className="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-300 rounded-full pl-3 pr-1.5 py-1 text-[11px] font-bold shadow-enterprise"
              >
                <span>{f.label}</span>
                <button
                  onClick={() => clearFilter(f.key)}
                  className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            <button
              onClick={clearAllFilters}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 underline ml-2 cursor-pointer"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* 4. Quick-Jump Summary Band (4 KPI Metric Tiles) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* LATE */}
        <div
          onClick={() => scrollToSection("sec-late")}
          className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-primary-600 transition-all cursor-pointer shadow-enterprise hover:shadow-md flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-primary-700 transition-colors">
              Late
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-error-500 shrink-0" />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-semibold text-error-600">{groups.late.length}</span>
            <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary-700 group-hover:underline">
              Jump ↓
            </span>
          </div>
        </div>

        {/* TODAY */}
        <div
          onClick={() => scrollToSection("sec-today")}
          className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-primary-600 transition-all cursor-pointer shadow-enterprise hover:shadow-md flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-primary-700 transition-colors">
              Today
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-warning-500 shrink-0" />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-semibold text-warning-600">{groups.today.length}</span>
            <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary-700 group-hover:underline">
              Jump ↓
            </span>
          </div>
        </div>

        {/* UPCOMING */}
        <div
          onClick={() => scrollToSection("sec-upcoming")}
          className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-primary-600 transition-all cursor-pointer shadow-enterprise hover:shadow-md flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-primary-700 transition-colors truncate">
              Upcoming
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-primary-500 shrink-0" />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-semibold text-primary-600">{groups.upcoming.length}</span>
            <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary-700 group-hover:underline">
              Jump ↓
            </span>
          </div>
        </div>

        {/* DONE */}
        <div
          onClick={() => scrollToSection("sec-done")}
          className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-primary-600 transition-all cursor-pointer shadow-enterprise hover:shadow-md flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-primary-700 transition-colors">
              Done
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-success-500 shrink-0" />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-semibold text-success-600">{groups.done.length}</span>
            <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary-700 group-hover:underline">
              Jump ↓
            </span>
          </div>
        </div>
      </div>

      {/* 5. Zero States & Celebration */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-36 rounded-xl bg-white border border-slate-200 p-4 animate-pulse space-y-3"
            >
              <div className="h-4 bg-slate-200 rounded-md w-3/4" />
              <div className="h-3 bg-slate-100 rounded-md w-1/2" />
              <div className="h-10 bg-slate-100 rounded-xl w-full mt-4" />
            </div>
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-xl border border-slate-200 shadow-enterprise">
          {activeFilters.length > 0 ? (
            <div className="max-w-sm mx-auto space-y-3">
              <div className="w-14 h-14 mx-auto rounded-xl bg-warning-50 text-warning-600 border border-warning-100/60 flex items-center justify-center">
                <Search className="w-7 h-7" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                Nothing matches those filters
              </h3>
              <p className="text-xs font-medium text-slate-500">
                Try clearing search or filters to see all assigned responsibilities.
              </p>
              <button
                onClick={clearAllFilters}
                className="mt-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-bold rounded-xl text-slate-700 transition-colors cursor-pointer"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="max-w-sm mx-auto space-y-3">
              <div className="w-14 h-14 mx-auto rounded-xl bg-primary-50 text-primary-700 border border-primary-200/60 flex items-center justify-center">
                <PartyPopper className="w-7 h-7" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                Nothing here yet
              </h3>
              <p className="text-xs font-medium text-slate-500">
                When {activeTab} work is assigned to you, it will show up here.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {/* All caught up banner */}
          {openCount === 0 && groups.done.length > 0 && (
            <div className="flex items-center gap-4 p-5 rounded-xl bg-success-50 border border-success-100 text-success-600 shadow-enterprise">
              <div className="w-10 h-10 rounded-xl bg-success-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-success-600">
                  All caught up! 🎉
                </h3>
                <p className="text-xs text-success-600 font-medium mt-0.5">
                  No pending work right now. Great job keeping the work queue clear.
                </p>
              </div>
            </div>
          )}

          {/* 6. Section Lists */}
          {/* 🔴 LATE SECTION */}
          {groups.late.length > 0 && (
            <section id="sec-late" className="space-y-3 scroll-mt-6">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-error-500 text-white shadow-enterprise">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-error-600 uppercase tracking-wider">
                    Late ({groups.late.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-bold">
                    Tasks that require immediate action
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-warning-500 text-white shadow-enterprise">
                  <Sun className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-warning-600 uppercase tracking-wider">
                    Today ({groups.today.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-bold">
                    Planned for today
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary-500 text-white shadow-enterprise">
                  <CalendarClock className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-primary-600 uppercase tracking-wider">
                    Coming Up ({groups.upcoming.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-bold">
                    Upcoming responsibilities & future dates
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary-500 text-white shadow-enterprise">
                  <Hourglass className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-primary-600 uppercase tracking-wider">
                    Waiting for Approval ({groups.waiting.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-bold">
                    Work submitted, awaiting verifier signoff
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-success-500 text-white shadow-enterprise">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-success-600 uppercase tracking-wider">
                    Done ({groups.done.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-bold">
                    Completed responsibilities
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

      {/* 7. Complete Task Modal */}
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
 * Refined enterprise card with status accent and touch targets.
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

  // Accent border by theme
  const borderStyles = {
    late: "border-l-red-500 hover:border-error-100",
    today: "border-l-amber-500 hover:border-warning-100",
    upcoming: "border-l-blue-500 hover:border-primary-300",
    waiting: "border-l-indigo-500 hover:border-primary-300",
    done: "border-l-emerald-500 hover:border-success-100",
  }[theme] || "border-l-slate-400";

  const dueLabel = formatDueWords(task);
  const taskCode = task.taskCode || (task.id ? `TSK-${task.id.slice(-4).toUpperCase()}` : "");

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white border-l-4 p-4.5 flex flex-col justify-between gap-3.5 shadow-enterprise hover:shadow-md transition-all ${borderStyles}`}
    >
      {/* Card Header & Title */}
      <div className="space-y-2">
        <div
          onClick={() => onClick(task)}
          className={`group flex items-start justify-between gap-2 ${
            !isChecklist ? "cursor-pointer" : ""
          }`}
        >
          <h3 className="text-sm font-bold text-slate-900 group-hover:text-primary-700 transition-colors line-clamp-2 leading-snug">
            {task.taskTitle}
          </h3>
          {!isChecklist && (
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-primary-700 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
          )}
        </div>

        {/* Due wording badge & Code */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span
            className={`${
              theme === "late"
                ? "text-error-600 font-bold"
                : theme === "today"
                ? "text-warning-600 font-bold"
                : theme === "done"
                ? "text-success-600 font-bold"
                : theme === "waiting"
                ? "text-primary-600 font-bold"
                : "text-primary-600 font-bold"
            }`}
          >
            {dueLabel}
          </span>
          {taskCode && (
            <span className="bg-slate-100 text-slate-600 text-[10px] font-mono px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
              {taskCode}
            </span>
          )}
        </div>

        {/* Metadata Chips: Frequency & Site / Department */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
            {task.frequency || "One-off"}
          </span>
          <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
            {task.site || "HO"}
          </span>
          {task.category && (
            <span className="text-[11px] font-bold text-slate-600 bg-primary-50/70 border border-primary-200/50 px-2 py-0.5 rounded-md truncate max-w-[140px]">
              {task.category}
            </span>
          )}
        </div>
      </div>

      {/* Action Button Section: 44px (h-11) Touch Targets */}
      <div className="pt-1">
        {/* CASE 1: In-Loop (Follower Mode) */}
        {isLoop ? (
          <div className="h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-xs gap-2 select-none border border-slate-200">
            <Radio className="w-3.5 h-3.5 text-slate-400 animate-pulse" />
            <span>Following this task</span>
          </div>
        ) : isWaiting ? (
          /* CASE 2: Waiting for Verification */
          <div className="h-10 rounded-xl bg-primary-50 text-primary-700 border border-primary-200 flex items-center justify-center font-bold text-xs gap-2 select-none">
            <Hourglass className="w-3.5 h-3.5" />
            <span>Sent for approval</span>
          </div>
        ) : isDone ? (
          /* CASE 3: Finished */
          <div className="h-10 rounded-xl bg-success-50 text-success-600 border border-success-100 flex items-center justify-center font-bold text-xs gap-2 select-none">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Completed</span>
          </div>
        ) : isChecklist ? (
          /* CASE 4: Checklist Item (One-tap direct completion) */
          <button
            onClick={() => onChecklistDone(task)}
            disabled={busy}
            type="button"
            className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 w-full select-none cursor-pointer"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4 stroke-[2.5]" />
            )}
            <span>Done</span>
          </button>
        ) : isInProgress ? (
          /* CASE 5: Delegation in progress -> Full-width Done */
          <button
            onClick={() => onDelegationDone(task)}
            disabled={busy}
            type="button"
            className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 w-full select-none cursor-pointer"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4 stroke-[2.5]" />
            )}
            <span>Done</span>
          </button>
        ) : (
          /* CASE 6: Delegation pending -> [Start] + [Done] side-by-side */
          <div className="flex items-center gap-2">
            <button
              onClick={() => onStart(task)}
              disabled={busy}
              type="button"
              className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-3 py-1.5 text-xs gap-1.5 flex-1 select-none cursor-pointer"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Start</span>
            </button>

            <button
              onClick={() => onDelegationDone(task)}
              disabled={busy}
              type="button"
              className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-3 py-1.5 text-xs gap-1.5 flex-1 select-none cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Done</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MyDay;
