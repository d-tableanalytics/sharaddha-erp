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
import { Button } from '../../components/ui/Button';
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
  completed:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending:          'bg-slate-100 text-slate-600 border-slate-200',
  overdue:          'bg-red-50 text-red-700 border-red-200',
  'non-functional': 'bg-amber-50 text-amber-700 border-amber-200',
};

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
    {status === 'non-functional' ? 'Non-Functional' : status?.charAt(0).toUpperCase() + status?.slice(1)}
  </span>
);

const FrequencyPill = ({ frequency }) => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-semibold">
    <Repeat size={10} />
    {frequency?.charAt(0).toUpperCase() + frequency?.slice(1)}
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
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 z-20 py-1 overflow-hidden">
            <button
              onClick={() => { setOpen(false); onRemark(task); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <MessageSquare size={14} /> Add remark
            </button>
            {isAdmin && (
              <button
                onClick={() => { setOpen(false); onReassign(task); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <UserCog size={14} /> Reassign
              </button>
            )}
            <button
              onClick={() => { setOpen(false); onNonFunctional(task); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 transition-colors"
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
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
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
      <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-dashed border-slate-200">
        <div className="flex items-center justify-center w-14 h-14 mb-4 bg-slate-50 rounded-full border border-slate-100">
          <ClipboardList size={24} className="text-slate-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">No checklist tasks</h3>
        <p className="text-xs text-slate-500 mb-4">
          {hasFilters ? 'Nothing matches your current filters.' : 'Nothing set up yet.'}
        </p>
        {hasFilters ? (
          <Button variant="outline" size="sm" onClick={onClearFilters}>Clear filters</Button>
        ) : (
          <Button size="sm" onClick={onCreateNew} className="!bg-emerald-600 hover:!bg-emerald-700 !text-white">
            + Create the first one
          </Button>
        )}
      </div>
    );
  }

  const openTasks = tasks.filter((t) => t.status !== 'completed');
  const allOpenSelected = openTasks.length > 0 && openTasks.every((t) => selectedIds.includes(t._id));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              {isAdmin && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allOpenSelected}
                    onChange={() => onToggleSelectAll(openTasks.map((t) => t._id))}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
              )}
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Task</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Owner</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Frequency</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Planned</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Status</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Proof</th>
              <th className="text-right text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const isCompleted = task.status === 'completed';
              const isSelected = selectedIds.includes(task._id);

              return (
                <tr
                  key={task._id}
                  className="border-b border-slate-100 last:border-0 hover:bg-emerald-50/40 transition-colors duration-200"
                >
                  {isAdmin && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isCompleted}
                        onChange={() => onToggleSelect(task._id)}
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-30"
                      />
                    </td>
                  )}

                  {/* Task */}
                  <td className="px-4 py-3 max-w-[240px]">
                    <p className="text-sm font-semibold text-slate-900 truncate">{task.taskName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono text-slate-400">{task.taskCode}</span>
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
                    <p className="text-[13px] text-slate-800">{task.doerFirstName} {task.doerLastName}</p>
                    <p className="text-[11px] text-slate-400">
                      {task.department && <>{task.department} · </>}
                      <span className="font-bold text-sky-600">{task.site}</span>
                    </p>
                  </td>

                  {/* Frequency */}
                  <td className="px-4 py-3">
                    <FrequencyPill frequency={task.frequency} />
                  </td>

                  {/* Planned */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[13px] text-slate-700">
                      <CalendarDays size={13} className="text-slate-400" />
                      {fmtDate(task.plannedDate)}
                    </div>
                    {isCompleted && task.completedDate && (
                      <p className="text-[11px] text-emerald-600 mt-0.5">done {fmtDate(task.completedDate)}</p>
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
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                      >
                        <Paperclip size={12} /> View
                      </a>
                    ) : task.proofRequired ? (
                      <span className="text-xs font-semibold text-amber-600">Required</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    {isCompleted ? (
                      <span className="text-xs text-emerald-600 font-medium">{fmtDate(task.completedDate)}</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="xs"
                          onClick={() => onComplete(task)}
                          className="!bg-emerald-600 hover:!bg-emerald-700 !text-white !text-[11px]"
                        >
                          <CheckCircle2 size={12} className="mr-1" /> Complete
                        </Button>
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
