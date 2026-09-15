import { useEffect } from 'react';
import {
  X,
  Clock,
  Calendar,
  Flag,
  User,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

function getInitials(first = '', last = '') {
  const f = first ? first.trim().charAt(0) : '';
  const l = last ? last.trim().charAt(0) : '';
  return (f + l).toUpperCase() || 'U';
}

function formatTaskDate(dateStr) {
  if (!dateStr) return 'No due date';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function calculateLateDays(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(dueDate).getTime();
  const now = Date.now();
  if (now <= due) return 0;
  return Math.ceil((now - due) / (1000 * 60 * 60 * 24));
}

export function TaskDrilldownDrawer({
  drill,
  onClose,
  onSelectTask,
}) {
  const isOpen = Boolean(drill);
  const list = drill?.list || [];

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-md bg-white h-full shadow-enterprise-lg border-l border-slate-200 z-10 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary-600" />
              <h2 className="text-base font-semibold text-slate-900 leading-tight">
                {drill.label} <span className="text-primary-700">({list.length})</span>
              </h2>
            </div>
            {drill.description && (
              <p className="text-xs font-semibold text-slate-500 mt-1">
                {drill.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            aria-label="Close drilldown"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {list.length === 0 ? (
            <div className="py-16 text-center">
              <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-600">No tasks found</p>
              <p className="text-xs text-slate-400 mt-0.5">There are no tasks matching this metric.</p>
            </div>
          ) : (
            list.map((task) => {
              const doerName = `${task.doerFirstName || ''} ${task.doerLastName || ''}`.trim() || 'Unassigned';
              const assignerName = task.assignerName || `${task.assignerFirstName || ''} ${task.assignerLastName || ''}`.trim() || 'Admin';
              const lateDays = calculateLateDays(task.dueDate);
              const isOverdue = lateDays > 0 && task.status !== 'Completed' && task.status !== 'Awaiting Verification';

              return (
                <div
                  key={task._id}
                  onClick={() => {
                    onSelectTask(task);
                  }}
                  className="p-3.5 bg-white border border-slate-200 hover:border-primary-600 hover:shadow-md rounded-xl transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-primary-700 transition-colors line-clamp-1">
                      {task.taskTitle || 'Untitled Task'}
                    </h3>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-primary-700 shrink-0 transition-colors" />
                  </div>

                  {/* Late Days Badge if overdue */}
                  {isOverdue && (
                    <div className="mb-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-error-50 text-error-600 border border-error-100">
                        <Clock className="w-2.5 h-2.5" />
                        {lateDays}d late
                      </span>
                    </div>
                  )}

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500 pt-1 border-t border-slate-100 mt-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-[9px] font-bold shrink-0">
                        {getInitials(task.doerFirstName, task.doerLastName)}
                      </div>
                      <span className="truncate max-w-[110px]" title={`To: ${doerName}`}>
                        {doerName}
                      </span>
                    </div>

                    <span className="text-slate-300">•</span>

                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>{formatTaskDate(task.dueDate)}</span>
                    </div>

                    <div className="ml-auto flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                        task.status === 'Completed'
                          ? 'bg-success-50 text-success-600 border-success-100'
                          : task.status === 'Awaiting Verification'
                          ? 'bg-primary-50 text-primary-600 border-primary-200'
                          : task.status === 'In Progress'
                          ? 'bg-warning-50 text-warning-600 border-warning-100'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}>
                        {task.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default TaskDrilldownDrawer;
