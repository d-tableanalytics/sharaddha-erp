import { useMemo } from 'react';
import {
  AlertCircle,
  History,
  CheckCircle2,
  Calendar,
  Tag,
  Clock,
} from 'lucide-react';

function getInitials(first = '', last = '') {
  const f = first ? first.charAt(0) : '';
  const l = last ? last.charAt(0) : '';
  return (f + l).toUpperCase() || 'U';
}

const COLUMNS = [
  { id: 'Pending', label: 'Pending', icon: AlertCircle, color: 'text-error-500', headerBg: 'bg-error-50' },
  { id: 'Need Revision', label: 'Need Revision', icon: History, color: 'text-primary-500', headerBg: 'bg-primary-50' },
  { id: 'In Progress', label: 'In Progress', icon: History, color: 'text-warning-500', headerBg: 'bg-warning-50' },
  { id: 'Completed', label: 'Completed', icon: CheckCircle2, color: 'text-success-500', headerBg: 'bg-success-50' },
];

export function TaskKanbanView({ tasks = [], onTaskClick }) {
  // Group tasks by status
  const grouped = useMemo(() => {
    const map = {
      Pending: [],
      'Need Revision': [],
      'In Progress': [],
      Completed: [],
    };

    tasks.forEach((t) => {
      // Map 'Awaiting Verification' to 'In Progress' or show in Pending/Revision if preferred
      let statusKey = t.status;
      if (statusKey === 'Awaiting Verification') {
        // Group under In Progress with visual badge or special marker
        statusKey = 'In Progress';
      }
      if (!map[statusKey]) {
        map['Pending'].push(t);
      } else {
        map[statusKey].push(t);
      }
    });

    return map;
  }, [tasks]);

  const priorityColors = {
    Urgent: 'bg-error-50 text-error-600 border-error-100',
    High: 'bg-warning-50 text-warning-600 border-warning-100',
    Medium: 'bg-primary-50 text-primary-600 border-primary-200',
    Low: 'bg-slate-50 text-slate-500 border-slate-200',
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 overflow-x-auto pb-4">
      {COLUMNS.map((col) => {
        const Icon = col.icon;
        const colTasks = grouped[col.id] || [];

        return (
          <div
            key={col.id}
            className="flex flex-col rounded-xl bg-slate-100/70 border border-slate-200/70 min-w-[280px] max-h-[80vh] flex-1"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200/80 bg-white/70 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${col.color}`} />
                <h3 className="text-xs font-semibold text-slate-700">
                  {col.label}
                </h3>
              </div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {colTasks.length}
              </span>
            </div>

            {/* Column Cards Container */}
            <div className="p-3 space-y-3 overflow-y-auto flex-1 custom-scrollbar">
              {colTasks.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-lg">
                  <p className="text-xs font-bold text-slate-400">No tasks</p>
                </div>
              ) : (
                colTasks.map((task) => {
                  const overdue =
                    task.dueDate &&
                    task.status !== 'Completed' &&
                    new Date(task.dueDate).getTime() < Date.now();

                  return (
                    <div
                      key={task._id}
                      onClick={() => onTaskClick(task)}
                      className="group bg-white rounded-xl p-4 border border-slate-200/90 shadow-enterprise hover:shadow-md transition-all duration-200 cursor-pointer border-l-4 border-l-transparent hover:border-l-primary-600 flex flex-col gap-2.5"
                    >
                      {/* Card Top: Category & Priority */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate max-w-[120px]">
                          {task.category || 'Operations'}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            priorityColors[task.priority] || priorityColors.Medium
                          }`}
                        >
                          {task.priority || 'Medium'}
                        </span>
                      </div>

                      {/* Card Title */}
                      <h4 className="text-sm font-bold text-slate-900 line-clamp-2 group-hover:text-primary-700 transition-colors leading-snug">
                        {task.taskTitle}
                      </h4>

                      {/* Card Description Preview */}
                      {task.description && (
                        <div
                          className="text-xs text-slate-500 line-clamp-2 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: task.description }}
                        />
                      )}

                      {/* Verification Status tag if applicable */}
                      {task.status === 'Awaiting Verification' && (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-50 border border-primary-200 text-primary-600 text-[10px] font-bold uppercase tracking-wider">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-pulse" />
                          Awaiting Verification
                        </div>
                      )}

                      {/* Card Tags */}
                      {task.tags && task.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {task.tags.slice(0, 3).map((tg, idx) => (
                            <span
                              key={idx}
                              className="text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1"
                              style={{
                                backgroundColor: `${tg.color || '#2563eb'}10`,
                                borderColor: `${tg.color || '#2563eb'}30`,
                                color: tg.color || '#2563eb',
                              }}
                            >
                              <Tag className="w-2 h-2" />
                              {tg.name || tg}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Card Footer: Assignee & Due Date */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500 font-semibold">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full bg-primary-50 text-primary-700 font-bold text-[10px] flex items-center justify-center border border-primary-200"
                            title={`${task.doerFirstName} ${task.doerLastName}`}
                          >
                            {getInitials(task.doerFirstName, task.doerLastName)}
                          </div>
                          <span className="text-[11px] font-bold text-slate-700 truncate max-w-[90px]">
                            {task.doerFirstName}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <Calendar
                            className={`w-3 h-3 ${overdue ? 'text-error-500' : 'text-slate-400'}`}
                          />
                          <span
                            className={`text-[10px] font-bold ${
                              overdue ? 'text-error-600' : 'text-slate-500'
                            }`}
                          >
                            {task.dueDate
                              ? new Date(task.dueDate).toLocaleDateString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                })
                              : 'No date'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TaskKanbanView;
