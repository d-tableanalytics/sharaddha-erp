import { useState } from 'react';
import {
  RotateCcw,
  Clock,
  User,
  Folder,
  Flag,
  Tag,
  CheckSquare,
  ShieldCheck,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  Loader2,
  Calendar,
  Check,
} from 'lucide-react';

function getInitials(first = '', last = '') {
  const f = first ? first.charAt(0) : '';
  const l = last ? last.charAt(0) : '';
  return (f + l).toUpperCase() || 'U';
}

function formatRelativeTime(dateString) {
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

function isTaskOverdue(task) {
  if (!task.dueDate) return false;
  if (task.status === 'Completed' || task.status === 'Awaiting Verification') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

export function TaskListView({
  tasks = [],
  loading = false,
  selectedIds = [],
  onToggleSelect,
  onSelectAll,
  onOpenDetails,
  onQuickVerify,
  onClearFilters,
}) {
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [verifyingId, setVerifyingId] = useState(null);

  const toggleExpand = (id) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  const handleQuickVerify = async (e, task) => {
    e.stopPropagation();
    setVerifyingId(task._id);
    try {
      await onQuickVerify(task._id);
    } finally {
      setVerifyingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="w-12 h-12 border-4 border-[#1E4C92] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold text-slate-600">Loading Tasks...</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-white/60 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-[#1E4C92]/10 text-[#1E4C92] flex items-center justify-center mb-4">
          <CheckSquare className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800 mb-1">No Tasks Found</h3>
        <p className="text-sm font-medium text-slate-500 max-w-md mb-6">
          There are no delegated tasks matching the current filters or date range.
        </p>
        <button
          onClick={onClearFilters}
          className="px-5 py-2.5 bg-[#1E4C92] hover:bg-[#163a6a] text-white text-xs font-semibold rounded-xl shadow-sm transition-all active:scale-95"
        >
          Clear Filters
        </button>
      </div>
    );
  }

  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.includes(t._id));

  return (
    <div className="space-y-3">
      {/* Select All Bar (if tasks exist) */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/70 backdrop-blur-xs border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-600">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer"
          />
          <span>Select All ({tasks.length})</span>
        </div>
        {selectedIds.length > 0 && (
          <span className="text-xs font-semibold text-[#1E4C92] bg-[#1E4C92]/10 px-2.5 py-0.5 rounded-full">
            {selectedIds.length} Selected
          </span>
        )}
      </div>

      {/* Task Rows */}
      {tasks.map((task) => {
        const isExpanded = expandedRowId === task._id;
        const isSelected = selectedIds.includes(task._id);
        const overdue = isTaskOverdue(task);
        const isAwaitingVerification = task.status === 'Awaiting Verification';

        // Badge styling
        let statusBadge = {
          bg: 'bg-slate-50 text-slate-700 border-slate-200',
          label: task.status,
        };
        if (task.status === 'Completed') {
          statusBadge = { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Completed' };
        } else if (isAwaitingVerification) {
          statusBadge = { bg: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Awaiting Verification' };
        } else if (task.status === 'In Progress') {
          statusBadge = { bg: 'bg-orange-50 text-orange-700 border-orange-200', label: 'In Progress' };
        } else if (overdue) {
          statusBadge = { bg: 'bg-red-50 text-red-700 border-red-200', label: 'Overdue' };
        }

        // Priority colors
        const priorityColors = {
          Urgent: 'text-red-500',
          High: 'text-orange-500',
          Medium: 'text-blue-500',
          Low: 'text-slate-400',
        };

        const priorityDot = {
          Urgent: 'bg-red-500',
          High: 'bg-orange-500',
          Medium: 'bg-blue-500',
          Low: 'bg-slate-400',
        };

        const isRecurring = task.recurrence && task.recurrence !== 'none';

        return (
          <div
            key={task._id}
            className={`group bg-white rounded-xl border transition-all duration-200 ${
              isAwaitingVerification
                ? 'ring-2 ring-blue-500/20 border-blue-300 bg-blue-50/10 shadow-xs hover:shadow-md'
                : 'border-slate-200 hover:border-slate-300 shadow-xs hover:shadow-md'
            }`}
          >
            {/* Main Row Header */}
            <div
              onClick={() => toggleExpand(task._id)}
              className="px-4 py-3.5 flex flex-wrap items-center gap-3 md:gap-4 cursor-pointer select-none"
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelect(task._id)}
                className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer"
              />

              {/* Assignee Avatar */}
              <div
                className="w-10 h-10 rounded-full bg-[#1E4C92]/10 text-[#1E4C92] font-black text-xs flex items-center justify-center border border-[#1E4C92]/20 shrink-0 shadow-xs"
                title={`${task.doerFirstName} ${task.doerLastName}`}
              >
                {getInitials(task.doerFirstName, task.doerLastName)}
              </div>

              {/* Assignee Hierarchy & Doer Name */}
              <div className="hidden sm:flex flex-col min-w-[130px] max-w-[170px] shrink-0">
                <span className="text-xs font-black text-slate-800 truncate">
                  {task.doerFirstName} {task.doerLastName}
                </span>
                <span className="text-[11px] font-semibold text-slate-400 truncate">
                  {task.assigneeHierarchy || 'Team Member'}
                </span>
              </div>

              {/* Task Title */}
              <div className="flex-1 min-w-[180px]">
                <h4 className="text-sm font-black text-slate-800 line-clamp-1 group-hover:text-[#1E4C92] transition-colors">
                  {task.taskTitle}
                </h4>
                <div className="sm:hidden text-[10px] font-semibold text-slate-400">
                  {task.doerFirstName} {task.doerLastName}
                </div>
              </div>

              {/* Status Badge */}
              <span
                className={`text-[10px] font-black px-2.5 py-1 rounded-lg border uppercase tracking-wider ${statusBadge.bg} shrink-0`}
              >
                {statusBadge.label}
              </span>

              {/* Recurrence Badge */}
              <span
                className={`hidden md:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg border ${
                  isRecurring
                    ? 'bg-purple-50 text-purple-600 border-purple-200'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                } shrink-0`}
              >
                {isRecurring && <RotateCcw className="w-3 h-3" />}
                {isRecurring ? task.recurrence : 'One Time'}
              </span>

              {/* Priority Indicator */}
              <div className="hidden lg:flex items-center gap-1.5 shrink-0 text-xs font-black">
                <span className={`w-2 h-2 rounded-full ${priorityDot[task.priority] || 'bg-slate-400'}`} />
                <span className={priorityColors[task.priority] || 'text-slate-600'}>
                  {task.priority || 'Medium'}
                </span>
              </div>

              {/* Relative Timestamp */}
              <span className="hidden xl:inline-block text-[11px] font-semibold text-slate-400 shrink-0 min-w-[50px] text-right">
                {formatRelativeTime(task.updatedAt || task.createdAt)}
              </span>

              {/* Quick Action: Verify & Complete (for Awaiting Verification) */}
              {isAwaitingVerification && (
                <button
                  type="button"
                  onClick={(e) => handleQuickVerify(e, task)}
                  disabled={verifyingId === task._id}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-3 py-1.5 font-black uppercase text-[10px] tracking-wider flex items-center gap-1.5 shadow-sm active:scale-95 transition-all shrink-0 cursor-pointer"
                >
                  {verifyingId === task._id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>Verify & Complete</span>
                </button>
              )}

              {/* Action Buttons: Details & Expand Icon */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title="Task Details"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDetails(task);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                <div className="p-1 text-slate-400">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>
            </div>

            {/* Expanded Accordion Details */}
            {isExpanded && (
              <div className="px-6 pb-5 pt-1 border-t border-slate-100 bg-slate-50/40 rounded-b-xl animate-in slide-in-from-top-2 duration-200">
                {/* Metadata Pills */}
                <div className="flex flex-wrap items-center gap-4 py-3 text-xs font-semibold text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Clock className={`w-3.5 h-3.5 ${overdue ? 'text-red-500' : 'text-slate-400'}`} />
                    <span className={overdue ? 'text-red-600' : 'text-slate-600'}>
                      Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Assignee: {task.doerFirstName} {task.doerLastName}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-slate-400" />
                    <span>Category: {task.category || 'Operations'}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Flag className={`w-3.5 h-3.5 ${priorityColors[task.priority]}`} />
                    <span>Priority: {task.priority}</span>
                  </div>
                </div>

                {/* Description Snippet */}
                {task.description && (
                  <div className="border-l-2 border-[#1E4C92]/40 pl-3 py-1 mb-3">
                    <div
                      className="text-xs font-medium text-slate-600 line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: task.description }}
                    />
                  </div>
                )}

                {/* Tag Badges */}
                {task.tags && task.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {task.tags.map((tg, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border"
                        style={{
                          backgroundColor: `${tg.color || '#1E4C92'}15`,
                          borderColor: `${tg.color || '#1E4C92'}40`,
                          color: tg.color || '#1E4C92',
                        }}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {tg.name || tg}
                      </span>
                    ))}
                  </div>
                )}

                {/* Subtask Quick Progress Snippet */}
                {task.subtasks && task.subtasks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-slate-500 font-semibold">
                      <span>Subtasks:</span>
                      <span className="font-semibold text-slate-800">
                        {task.subtasks.filter((s) => s.completed).length} of {task.subtasks.length} done
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenDetails(task)}
                      className="text-[#1E4C92] hover:underline font-semibold text-xs"
                    >
                      Open Full View →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default TaskListView;
