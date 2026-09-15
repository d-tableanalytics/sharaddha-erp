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
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  const day = dt.getDate().toString().padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
};

// Badge's own variant names - `danger` is the red one; "error" is the palette.
const STATUS_VARIANTS = {
  completed:        'success',
  pending:          'neutral',
  overdue:          'danger',
  'non-functional': 'warning',
};

const StatusBadge = ({ status }) => (
  <Badge variant={STATUS_VARIANTS[status] || STATUS_VARIANTS.pending} className="shrink-0">
    {status === 'non-functional' ? 'Non-Functional' : status?.charAt(0).toUpperCase() + status?.slice(1)}
  </Badge>
);

const FrequencyPill = ({ frequency }) => (
  <Badge variant="primary" className="gap-1">
    <Repeat size={10} />
    {frequency?.toUpperCase()}
  </Badge>
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
        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-enterprise-lg border border-slate-200 z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
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
              className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-bold text-warning-600 hover:bg-warning-50 transition-colors cursor-pointer"
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
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-enterprise">
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
      <div>
        <EmptyState
          title="No Checklist Tasks"
          description={hasFilters ? 'Nothing matches your current filters.' : 'Nothing set up yet.'}
          icon={<ClipboardList className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
        />
        <div className="flex justify-center mt-4">
        {hasFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg shadow-enterprise transition-colors cursor-pointer"
          >
            Clear Filters
          </button>
        ) : (
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 cursor-pointer"
          >
            + Create the first one
          </button>
        )}
        </div>
      </div>
    );
  }

  const openTasks = tasks.filter((t) => t.status !== 'completed');
  const allOpenSelected = openTasks.length > 0 && openTasks.every((t) => selectedIds.includes(t._id));

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-enterprise">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {isAdmin && (
                <th className="w-10 px-4 py-4">
                  <input
                    type="checkbox"
                    checked={allOpenSelected}
                    onChange={() => onToggleSelectAll(openTasks.map((t) => t._id))}
                    className="w-4 h-4 rounded border-slate-300 accent-primary-600 cursor-pointer"
                  />
                </th>
              )}
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Task</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Owner</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Frequency</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Planned</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Proof</th>
              <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const isCompleted = task.status === 'completed';
              const isSelected = selectedIds.includes(task._id);

              return (
                <tr
                  key={task._id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                >
                  {isAdmin && (
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isCompleted}
                        onChange={() => onToggleSelect(task._id)}
                        className="w-4 h-4 rounded border-slate-300 accent-primary-600 cursor-pointer disabled:opacity-30"
                      />
                    </td>
                  )}

                  {/* Task */}
                  <td className="px-6 py-4 max-w-[240px]">
                    <p className="text-sm font-bold text-slate-900 hover:text-primary-700 transition-colors truncate">{task.taskName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono font-semibold text-slate-400">{task.taskCode}</span>
                      {task.remarks?.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-error-500">
                          <MessageSquare size={10} /> {task.remarks.length}
                        </span>
                      )}
                      {task.reassigned && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-primary-500">
                          <UserCog size={10} /> reassigned
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Owner */}
                  <td className="px-6 py-4">
                    <p className="text-xs font-bold text-slate-900">{task.doerFirstName} {task.doerLastName}</p>
                    <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                      {task.department && <>{task.department} · </>}
                      <span className="font-bold text-primary-700">{task.site}</span>
                    </p>
                  </td>

                  {/* Frequency */}
                  <td className="px-6 py-4">
                    <FrequencyPill frequency={task.frequency} />
                  </td>

                  {/* Planned */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <CalendarDays size={13} className="text-slate-400" />
                      {fmtDate(task.plannedDate)}
                    </div>
                    {isCompleted && task.completedDate && (
                      <p className="text-[11px] font-bold text-success-600 mt-0.5">done {fmtDate(task.completedDate)}</p>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4">
                    <StatusBadge status={task.status} />
                  </td>

                  {/* Proof */}
                  <td className="px-6 py-4">
                    {task.proofUrl ? (
                      <a
                        href={task.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline"
                      >
                        <Paperclip size={12} /> View
                      </a>
                    ) : task.proofRequired ? (
                      <span className="text-xs font-bold text-warning-600">Required</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right">
                    {isCompleted ? (
                      <span className="text-xs text-success-600 font-bold">{fmtDate(task.completedDate)}</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onComplete(task)}
                          className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-3 py-1.5 text-xs gap-1.5 cursor-pointer"
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
