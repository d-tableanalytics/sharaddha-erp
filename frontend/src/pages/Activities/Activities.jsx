import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Search,
  RotateCcw,
  ChevronDown,
  PlusCircle,
  CheckCircle2,
  MessageSquare,
  Clock,
  ArrowRight,
  ExternalLink,
  AlertCircle,
  ShieldAlert,
  Calendar,
  X,
  ListPlus,
  Trash2,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useUserStore } from '../../store/userStore';
import activityService from '../../services/activity';
import delegationService from '../../services/delegation';
import TaskDetailsDrawer from '../Delegation/TaskDetailsDrawer';
import { PageHeader } from '../../components/common/PageHeader';
import { Button } from '../../components/ui/Button';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { ErrorState } from '../../components/hrms/ErrorState';

// Helper: Extract Initials
function getInitials(user) {
  if (!user) return 'U';
  const f = (user.firstName || user.user || '').trim().charAt(0);
  const l = (user.lastName || '').trim().charAt(0);
  if (!f && !l) return 'U';
  return (f + (l || '')).toUpperCase();
}

// Helper: Format Date & Time
function formatActivityDate(dateInput) {
  if (!dateInput) return { date: '', time: '' };
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return { date: '', time: '' };

  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);

  return { date, time };
}

// The portal's initials chip, as HRMS's EmployeesPage renders it: one flat
// primary disc, no per-person hue and no border. The six-hue rotation this
// replaces existed only in the WorkQueue - and once the off-palette hues folded
// onto the portal's four tokens, four of its six entries were the same colour,
// so it was rotating between duplicates.
const AVATAR_CLASS = 'bg-primary-100 text-primary-700';

// Activity Type Config: Semantic styling & Icons
function getActivityConfig(type) {
  switch (type) {
    case 'task_created':
      return {
        label: 'Task Created',
        icon: PlusCircle,
        iconBox: 'bg-primary-50 text-primary-700 border-primary-200/60',
        badge: 'bg-primary-50 text-primary-700 border-primary-200/60',
      };
    case 'subtask_created':
      return {
        label: 'Subtask Added',
        icon: ListPlus,
        iconBox: 'bg-success-50 text-success-600 border-success-100/60',
        badge: 'bg-success-50 text-success-600 border-success-100/60',
      };
    case 'status_change':
      return {
        label: 'Status Change',
        icon: CheckCircle2,
        iconBox: 'bg-primary-50 text-primary-600 border-primary-200/60',
        badge: 'bg-primary-50 text-primary-700 border-primary-200/60',
      };
    case 'remark':
      return {
        label: 'Remark Posted',
        icon: MessageSquare,
        iconBox: 'bg-primary-50 text-primary-600 border-primary-200/60',
        badge: 'bg-primary-50 text-primary-700 border-primary-200/60',
      };
    case 'date_revision':
      return {
        label: 'Date Revised',
        icon: Calendar,
        iconBox: 'bg-warning-50 text-warning-600 border-warning-100/60',
        badge: 'bg-warning-50 text-warning-600 border-warning-100/60',
      };
    case 'deleted':
      return {
        label: 'Task Deleted',
        icon: Trash2,
        iconBox: 'bg-error-50 text-error-600 border-error-100/60',
        badge: 'bg-error-50 text-error-600 border-error-100/60',
      };
    default:
      return {
        label: 'Activity',
        icon: Clock,
        iconBox: 'bg-slate-50 text-slate-600 border-slate-200',
        badge: 'bg-slate-50 text-slate-700 border-slate-200',
      };
  }
}

// Activity Type Dropdown Options
const ACTIVITY_TYPE_OPTIONS = [
  { value: 'All', label: 'All Activities' },
  { value: 'task_created', label: 'Tasks Created' },
  { value: 'subtask_created', label: 'Subtasks Added' },
  { value: 'status_change', label: 'Status Updates' },
  { value: 'remark', label: 'Remarks Posted' },
  { value: 'date_revision', label: 'Date Revisions' },
  { value: 'deleted', label: 'Tasks Deleted' },
];

// Resolve task flow badge [origin ➔ dest] only if real metadata exists
function getTaskFlowBadge(act) {
  if (act.metadata?.originTag && act.metadata?.destTag) {
    return {
      origin: act.metadata.originTag,
      dest: act.metadata.destTag,
    };
  }

  if (act.metadata?.taskUid) {
    return {
      origin: act.metadata.taskUid,
      dest: act.metadata.newStatus || null,
    };
  }

  return null;
}

export function Activities() {
  const navigate = useNavigate();
  const { user } = useUserStore();

  // Role Scoping: Admin / SuperAdmin / Management / Leadership roles
  const isAdmin = useMemo(() => {
    if (!user) return false;
    const role = String(user.role || '').toUpperCase();
    if (['ADMIN', 'SUPERADMIN', 'SUPER ADMIN', 'MANAGEMENT'].includes(role)) return true;
    const des = String(user.designation || '').toLowerCase();
    return /\b(ceo|managing director|md|director|lead|admin)\b/.test(des);
  }, [user]);

  // Filter States
  const [dateRange, setDateRange] = useState('This Month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [activityType, setActivityType] = useState('All');
  const [updatedBy, setUpdatedBy] = useState('All');
  const [search, setSearch] = useState('');

  // Data States
  const [activities, setActivities] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Task Details Drawer States
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedTaskObj, setSelectedTaskObj] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  // Fetch Team Users for "Updated By" filter
  useEffect(() => {
    let isMounted = true;
    async function loadUsers() {
      try {
        const list = await delegationService.getUsers();
        if (isMounted && Array.isArray(list)) {
          setUsersList(list);
        }
      } catch (err) {
        console.error('Failed to load team users for filter', err);
      }
    }
    loadUsers();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch Activities with Active Filters
  const fetchActivities = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);

    try {
      const filters = {};

      // 1. Temporal Filter Logic
      const now = new Date();
      if (dateRange === 'Today') {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filters.startDate = todayStart.toISOString();
      } else if (dateRange === 'Yesterday') {
        const yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
        filters.startDate = yStart.toISOString();
        filters.endDate = yEnd.toISOString();
      } else if (dateRange === 'This Week') {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        filters.startDate = startOfWeek.toISOString();
      } else if (dateRange === 'This Month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        filters.startDate = startOfMonth.toISOString();
      } else if (dateRange === 'Last Month') {
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        filters.startDate = startOfLastMonth.toISOString();
        filters.endDate = endOfLastMonth.toISOString();
      } else if (dateRange === 'Custom') {
        if (customStartDate) {
          filters.startDate = new Date(customStartDate).toISOString();
        }
        if (customEndDate) {
          const end = new Date(customEndDate);
          end.setHours(23, 59, 59, 999);
          filters.endDate = end.toISOString();
        }
      }

      // 2. Activity Type Filter
      if (activityType && activityType !== 'All') {
        filters.type = activityType;
      }

      // 3. Author Filter
      if (updatedBy && updatedBy !== 'All' && updatedBy !== 'Updated By') {
        filters.userId = updatedBy;
      }

      // 4. Search Query
      if (search.trim()) {
        filters.search = search.trim();
      }

      const res = await activityService.getActivities(filters);
      setActivities(Array.isArray(res) ? res : []);
    } catch (err) {
      toast.error('Failed to load activities');
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateRange, customStartDate, customEndDate, activityType, updatedBy, search]);

  // Initial & Filter-Triggered Fetch
  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Compute Top Contributor Metrics (Top 5 Active Users)
  const userStats = useMemo(() => {
    return activities.reduce((acc, act) => {
      if (act.user) {
        const uid = act.user.userId || act.user._id || act.userId;
        if (uid) {
          if (!acc[uid]) {
            acc[uid] = {
              user: act.user,
              count: 0,
            };
          }
          acc[uid].count++;
        }
      }
      return acc;
    }, {});
  }, [activities]);

  const sortedStats = useMemo(() => {
    return Object.values(userStats)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [userStats]);

  // Check if any filter is active
  const isAnyFilterActive = useMemo(() => {
    return (
      search.trim() !== '' ||
      dateRange !== 'This Month' ||
      activityType !== 'All' ||
      updatedBy !== 'All' ||
      customStartDate !== '' ||
      customEndDate !== ''
    );
  }, [search, dateRange, activityType, updatedBy, customStartDate, customEndDate]);

  const handleClearAllFilters = () => {
    setSearch('');
    setDateRange('This Month');
    setCustomStartDate('');
    setCustomEndDate('');
    setActivityType('All');
    setUpdatedBy('All');
  };

  // Open Task in TaskDetailsDrawer
  const handleOpenTaskDetails = async (taskId) => {
    if (!taskId) {
      toast('No task reference available for this activity.', { icon: 'ℹ️' });
      return;
    }

    setSelectedTaskId(taskId);
    setShowDetails(true);

    try {
      const task = await delegationService.getDelegationById(taskId);
      setSelectedTaskObj(task);
    } catch (err) {
      toast.error('Failed to load task details');
      console.error(err);
    }
  };

  const handleCloseDetails = () => {
    setShowDetails(false);
    setSelectedTaskId(null);
    setSelectedTaskObj(null);
  };

  // Drawer Action Handlers with Refresh Sync
  const handleDrawerSuccess = async () => {
    if (selectedTaskId) {
      try {
        const updated = await delegationService.getDelegationById(selectedTaskId);
        setSelectedTaskObj(updated);
      } catch {
        // ignore
      }
    }
    fetchActivities(true);
  };

  const handleUpdateStatus = async (status) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.updateDelegation(selectedTaskId, { status });
      toast.success(`Task status updated to ${status}`);
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleVerifyAndComplete = async (data) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.verifyAndComplete(selectedTaskId, data);
      toast.success('Task verified and completed!');
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to verify and complete task');
    }
  };

  const handleAddSubtask = async (data) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.addSubtask(selectedTaskId, data);
      toast.success('Subtask added');
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to add subtask');
    }
  };

  const handleToggleSubtask = async (subtaskId, completed) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.toggleSubtask(selectedTaskId, subtaskId, completed);
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to toggle subtask');
    }
  };

  const handleAddRemark = async (data) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.addRemark(selectedTaskId, data);
      toast.success('Remark added');
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to add remark');
    }
  };

  const handleReviseDueDate = async (data) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.reviseDueDate(selectedTaskId, data);
      toast.success('Due date revised');
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to revise due date');
    }
  };

  const handleAddReminder = async (data) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.addReminder(selectedTaskId, data);
      toast.success('Reminder added');
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to add reminder');
    }
  };

  const handleAddFollowUp = async (data) => {
    if (!selectedTaskId) return;
    try {
      await delegationService.addFollowUp(selectedTaskId, data);
      toast.success('Follow-up recorded');
      await handleDrawerSuccess();
    } catch {
      toast.error('Failed to add follow-up');
    }
  };

  const handleDeleteTask = async () => {
    if (!selectedTaskId) return;
    try {
      await delegationService.deleteDelegation(selectedTaskId);
      toast.success('Task moved to Trash Bin');
      handleCloseDetails();
      fetchActivities(true);
    } catch {
      toast.error('Failed to delete task');
    }
  };

  // If user is loaded and not admin, show access notice
  if (user && !isAdmin) {
    /*
      The portal's refusal panel, components/hrms/ErrorState.jsx, in its
      `forbidden` variant - the same thing a user sees when HRMS turns them
      away. The panel this replaces was a third empty-state shape with its own
      red icon disc and its own `text-xl font-semibold` heading.
    */
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 select-none">
        <div className="max-w-md">
          <ErrorState
            variant="forbidden"
            title="Admin Access Required"
            description="The centralized Activities audit log is restricted to administrative and management roles."
          />
          <button
            onClick={() => navigate('/work-queue')}
            className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 w-full cursor-pointer mt-4"
          >
            Return to My Work
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* ── 1. HEADER & REFRESH ACTION ─────────────────────────────────── */}
      {/*
        The shared PageHeader, as O2D and every HRMS page already use it.

        The hand-rolled header this replaces differed from the rest of the app
        in every measurable way: `text-2xl font-bold text-slate-900` against the
        system's `text-xl font-bold text-slate-900`, a `text-xs font-bold
        text-slate-400` subtitle against `text-sm font-medium text-slate-500`,
        and no bottom rule at all - so a WorkQueue page announced itself in a
        different voice from the page the user had just left.

        The "Audit Log" chip becomes the `eyebrow`, the slot that exists for
        exactly this. The 40px icon tile is dropped: no other page in the portal
        puts an icon beside its title, and keeping it is part of what made these
        screens read as a different product.
      */}
      <PageHeader
        eyebrow="Audit Log"
        title="Activities"
        subtitle="Centralized administrative timeline, task mutations & forensic accountability ledger"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchActivities()}
            disabled={loading || refreshing}
            title="Refresh activities"
          >
            <RotateCcw className={`w-3.5 h-3.5 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {/* ── 2. TOP CONTRIBUTORS RIBBON ─────────────────────────────────── */}
      {sortedStats.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Top Contributors
              </span>
            </div>
            {updatedBy !== 'All' && (
              <button
                type="button"
                onClick={() => setUpdatedBy('All')}
                className="text-[11px] font-bold text-primary-700 hover:underline cursor-pointer"
              >
                Clear contributor filter
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {sortedStats.map((stat, i) => {
              const uid = stat.user?.userId || stat.user?._id;
              const isSelected = updatedBy === uid;
              const initials = getInitials(stat.user);
              const displayName = stat.user?.firstName
                ? `${stat.user.firstName} ${stat.user.lastName || ''}`.trim()
                : (stat.user?.user || 'Staff');
              const designation = stat.user?.designation || 'Team Member';

              return (
                <div
                  key={uid || i}
                  onClick={() => setUpdatedBy(isSelected ? 'All' : uid)}
                  title={`Filter by ${displayName}`}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer shadow-enterprise hover:shadow-md flex items-center gap-3 group ${
                    isSelected
                      ? 'border-primary-600 ring-2 ring-primary-500/20 bg-white'
                      : 'border-slate-200 bg-white hover:border-primary-600'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className={`w-10 h-10 rounded-full font-bold text-xs flex items-center justify-center ${AVATAR_CLASS}`}>
                      {initials}
                    </div>
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-800 text-white text-[9px] font-semibold flex items-center justify-center border border-white shadow-enterprise">
                      #{i + 1}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-slate-900 truncate group-hover:text-primary-700 transition-colors block">
                      {displayName}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 truncate block">
                      {designation}
                    </span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-base font-semibold text-slate-900 leading-tight">
                        {stat.count}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">
                        {stat.count === 1 ? 'action' : 'actions'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 3. TOOLBAR & MULTI-FACTOR FILTER CONTROLS ───────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Real-time Search Input */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activities, titles, authors..."
            className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Date Range Dropdown */}
        <div className="relative shrink-0">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            <option value="This Month">This Month</option>
            <option value="Today">Today</option>
            <option value="Yesterday">Yesterday</option>
            <option value="This Week">This Week</option>
            <option value="Last Month">Last Month</option>
            <option value="All Time">All Time</option>
            <option value="Custom">Custom Range</option>
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
        </div>

        {/* Custom Start & End Dates */}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <div className="border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2 bg-white min-w-[135px] shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none w-full bg-transparent cursor-pointer"
              />
            </div>
            <span className="text-slate-400 text-xs font-bold">to</span>
            <div className="border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2 bg-white min-w-[135px] shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none w-full bg-transparent cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Activity Type Dropdown */}
        <div className="relative shrink-0">
          <select
            value={activityType}
            onChange={(e) => setActivityType(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            {ACTIVITY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
        </div>

        {/* Updated By Dropdown */}
        <div className="relative shrink-0">
          <select
            value={updatedBy}
            onChange={(e) => setUpdatedBy(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-900 shadow-sm appearance-none outline-none cursor-pointer transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            <option value="All">All Authors</option>
            {usersList.map((u) => {
              const fullName = u.user || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
              return (
                <option key={u._id} value={u._id}>
                  {fullName}
                </option>
              );
            })}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
        </div>

        {/* Clear Filters Button */}
        {isAnyFilterActive && (
          <button
            type="button"
            onClick={handleClearAllFilters}
            className="inline-flex items-center justify-center gap-1.5 font-medium rounded-lg px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all active:scale-[0.98] shrink-0"
          >
            <X size={14} />
            <span>Reset</span>
          </button>
        )}

        {/* Results Counter */}
        <div className="ml-auto text-xs font-bold text-slate-400 hidden sm:block">
          {activities.length} {activities.length === 1 ? 'event' : 'events'}
        </div>
      </div>

      {/* ── 4. CHRONOLOGICAL AUDIT LEDGER / FEED ─────────────────────────── */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 flex flex-col items-center justify-center gap-3 shadow-enterprise">
          <LoadingSpinner size={32} />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Loading audit timeline...
          </span>
        </div>
      ) : activities.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 flex flex-col items-center justify-center text-center shadow-enterprise">
          <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mb-3">
            <AlertCircle size={28} />
          </div>
          <h3 className="text-base font-semibold text-slate-900">No Activities Found</h3>
          <p className="text-xs font-medium text-slate-400 mt-1 max-w-sm">
            No timeline activity logs matched your active filters or date range.
          </p>
          {isAnyFilterActive && (
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 mt-4 cursor-pointer"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {activities.map((act, index) => {
            const cfg = getActivityConfig(act.type);
            const IconComponent = cfg.icon;
            const flowBadge = getTaskFlowBadge(act);
            const initials = getInitials(act.user);
            const authorFullName = `${act.user?.firstName || ''} ${act.user?.lastName || ''}`.trim() || act.user?.user || 'Staff Member';
            const authorDesignation = act.user?.designation || 'Staff';
            const formattedDate = formatActivityDate(act.createdAt);

            return (
              <div
                key={act.id || act._id || index}
                onClick={() => handleOpenTaskDetails(act.relatedId)}
                className="bg-white rounded-xl border border-slate-200 hover:border-primary-300 hover:shadow-md p-4 transition-all cursor-pointer group flex flex-col md:flex-row md:items-center gap-3.5 sm:gap-4"
              >
                {/* Activity Type Icon Indicator */}
                <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 shadow-enterprise ${cfg.iconBox}`}>
                  <IconComponent size={18} strokeWidth={2.5} />
                </div>

                {/* Content: Badge, Title & Description */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border shrink-0 ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    <h4 className="text-sm font-semibold text-slate-900 group-hover:text-primary-700 transition-colors truncate">
                      {act.title}
                    </h4>
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1 line-clamp-1">
                    {act.description || 'System mutation recorded'}
                  </p>
                </div>

                {/* Task Relation Flow Pill (shown only when real relation exists) */}
                {flowBadge && (
                  <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200/80 rounded-lg text-[11px] font-semibold font-mono shrink-0">
                    <span className="text-slate-600">{flowBadge.origin}</span>
                    {flowBadge.dest && (
                      <>
                        <ArrowRight size={12} className="text-slate-400" />
                        <span className="text-primary-700">{flowBadge.dest}</span>
                      </>
                    )}
                  </div>
                )}

                {/* Author Identity Pill */}
                <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200/60 px-2.5 py-1.5 rounded-lg shrink-0">
                  <div className={`w-7 h-7 rounded-full font-bold text-[11px] flex items-center justify-center shrink-0 ${AVATAR_CLASS}`}>
                    {initials}
                  </div>
                  <div className="flex flex-col min-w-[70px]">
                    <span className="text-xs font-semibold text-slate-900 leading-tight truncate max-w-[130px]">
                      {authorFullName}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate max-w-[130px]">
                      {authorDesignation}
                    </span>
                  </div>
                </div>

                {/* Formatted Timestamp */}
                <div className="text-right hidden sm:flex flex-col shrink-0 min-w-[125px]">
                  <span className="text-xs font-semibold text-slate-700">
                    {formattedDate.date}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {formattedDate.time}
                  </span>
                </div>

                {/* Deep-Link Trigger Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenTaskDetails(act.relatedId);
                  }}
                  title="Open task details drawer"
                  className="w-9 h-9 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-50 border border-transparent hover:border-primary-200 flex items-center justify-center transition-all shrink-0 cursor-pointer"
                >
                  <ExternalLink size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 5. SLIDE-OVER INSPECTION DRAWER ────────────────────────────── */}
      <TaskDetailsDrawer
        isOpen={showDetails}
        onClose={handleCloseDetails}
        task={selectedTaskObj}
        onUpdateStatus={handleUpdateStatus}
        onVerifyAndComplete={handleVerifyAndComplete}
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

export default Activities;
