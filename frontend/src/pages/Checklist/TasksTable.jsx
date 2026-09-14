/**
 * Tasks data table — the default view of the Checklist page.
 *
 * Matches the spec: checkbox column (admin only), task name + code + badges,
 * owner, frequency pill, planned date, status badge, proof column, and actions.
 */

import { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  MoreHorizontal,
  MessageSquare,
  UserCog,
  Ban,
  Repeat,
  CalendarDays,
  Paperclip,
  ClipboardList,
} from 'lucide-react';
import { TableSkeleton } from '../../components/ui/TableSkeleton';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  const day = dt.getDate().toString().padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
};

const STATUS_STYLES = {
  completed:        'bg-emerald-50 text-emerald-600 border-emerald-200',
  pending:          'bg-slate-50 text-slate-600 border-slate-200',
  overdue:          'bg-red-50 text-red-600 border-red-200',
  'non-functional': 'bg-amber-50 text-amber-600 border-amber-200',
};

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider shrink-0 ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
    {status === 'non-functional' ? 'Non-Functional' : status?.charAt(0).toUpperCase() + status?.slice(1)}
  </span>
);

const FrequencyPill = ({ frequency }) => (
  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200 text-[10px] font-bold shadow-xs">
    <Repeat size={10} />
    {frequency?.toUpperCase()}
  </span>
);

// ── Context Menu ─────────────────────────────────────────────────────────────

function ActionMenu({ task, isAdmin, onRemark, onReassign, onNonFunctional }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => { setOpen(false); onRemark(task); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <MessageSquare size={14} className="text-slate-400" /> Add remark
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => { setOpen(false); onReassign(task); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <UserCog size={14} className="text-slate-400" /> Reassign
              </button>
            )}
            <button
              type="button"
              onClick={() => { setOpen(false); onNonFunctional(task); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
            >
              <Ban size={14} /> Mark non-functional
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function TasksTable({
  tasks,
  loading,
  isAdmin,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onComplete,
  onRemark,
  onReassign,
  onNonFunctional,
  hasFilters,
  onClearFilters,
  onCreateNew,
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full min-w-[980px]">
          <tbody>
            <TableSkeleton rows={6} columns={isAdmin ? 8 : 7} />
          </tbody>
        </table>
      </div>
    );
  }

  if (!tasks?.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs flex flex-col items-center justify-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#1E4C92] border border-blue-200/60 flex items-center justify-center mb-3">
          <ClipboardList size={28} />
        </div>
        <h3 className="text-base font-black text-slate-800 mb-1">No Checklist Tasks</h3>
        <p className="text-xs font-medium text-slate-500 max-w-sm mb-4">
          {hasFilters ? 'Nothing matches your current filters.' : 'Nothing set up yet.'}
        </p>
        {hasFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            Clear Filters
          </button>
        ) : (
          <button
            type="button"
            onClick={onCreateNew}
            className="px-4 py-2 bg-[#1E4C92] hover:bg-[#163a6a] text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            + Create the first one
          </button>
        )}
      </div>
    );
  }

  const openTasks = tasks.filter((t) => t.status !== 'completed');
  const allOpenSelected = openTasks.length > 0 && openTasks.every((t) => selectedIds.includes(t._id));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80">
              {isAdmin && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allOpenSelected}
                    onChange={() => onToggleSelectAll(openTasks.map((t) => t._id))}
                    className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer"
                  />
                </th>
              )}
              <th className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500 px-4 py-3">Task</th>
              <th className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500 px-4 py-3">Owner</th>
              <th className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500 px-4 py-3">Frequency</th>
              <th className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500 px-4 py-3">Planned</th>
              <th className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500 px-4 py-3">Status</th>
              <th className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500 px-4 py-3">Proof</th>
              <th className="text-right text-[11px] font-black uppercase tracking-wider text-slate-500 px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const isCompleted = task.status === 'completed';
              const isSelected = selectedIds.includes(task._id);

              return (
                <tr
                  key={task._id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors duration-150"
                >
                  {isAdmin && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isCompleted}
                        onChange={() => onToggleSelect(task._id)}
                        className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer disabled:opacity-30"
                      />
                    </td>
                  )}

                  {/* Task */}
                  <td className="px-4 py-3 max-w-[240px]">
                    <p className="text-sm font-bold text-slate-800 hover:text-[#1E4C92] transition-colors truncate">{task.taskName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono font-semibold text-slate-400">{task.taskCode}</span>
                      {task.remarks?.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-500">
                          <MessageSquare size={10} /> {task.remarks.length}
                        </span>
                      )}
                      {task.reassigned && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-purple-500">
                          <UserCog size={10} /> reassigned
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Owner */}
                  <td className="px-4 py-3">
                    <p className="text-xs font-bold text-slate-800">{task.doerFirstName} {task.doerLastName}</p>
                    <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                      {task.department && <>{task.department} · </>}
                      <span className="font-bold text-[#1E4C92]">{task.site}</span>
                    </p>
                  </td>

                  {/* Frequency */}
                  <td className="px-4 py-3">
                    <FrequencyPill frequency={task.frequency} />
                  </td>

                  {/* Planned */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <CalendarDays size={13} className="text-slate-400" />
                      {fmtDate(task.plannedDate)}
                    </div>
                    {isCompleted && task.completedDate && (
                      <p className="text-[11px] font-bold text-emerald-600 mt-0.5">done {fmtDate(task.completedDate)}</p>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <StatusBadge status={task.status} />
                  </td>

                  {/* Proof */}
                  <td className="px-4 py-3">
                    {task.proofUrl ? (
                      <a
                        href={task.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#1E4C92] hover:underline"
                      >
                        <Paperclip size={12} /> View
                      </a>
                    ) : task.proofRequired ? (
                      <span className="text-xs font-bold text-amber-600">Required</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    {isCompleted ? (
                      <span className="text-xs text-emerald-600 font-bold">{fmtDate(task.completedDate)}</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onComplete(task)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer"
                        >
                          <CheckCircle2 size={13} /> Complete
                        </button>
                        <ActionMenu
                          task={task}
                          isAdmin={isAdmin}
                          onRemark={onRemark}
                          onReassign={onReassign}
                          onNonFunctional={onNonFunctional}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TasksTable;
