/**
 * Routines table — the master-rule view (admin/manager only).
 *
 * Shows each routine with its task name, code, owner, frequency, date window,
 * progress bar, and edit/stop actions.
 */

import { Repeat, Edit3, StopCircle, ClipboardList } from 'lucide-react';
import { SkeletonLoader } from '../../components/ui/SkeletonLoader';
import { EmptyState } from '../../components/ui/EmptyState';

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  const day = dt.getDate().toString().padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
};

export function RoutinesTable({ routines, loading, onEdit, onStop }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonLoader key={i} variant="rectangular" className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!routines?.length) {
    return (
      <EmptyState
        title="No Routines Yet"
        description="Create one and every occurrence is generated up front."
        icon={<ClipboardList className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
      />
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-enterprise">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Routine</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Owner</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Frequency</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Window</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Progress</th>
              <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {routines.map((routine) => {
              const prog = routine.progress || { total: 0, done: 0 };
              const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

              return (
                <tr key={routine._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  {/* Routine name */}
                  <td className="px-6 py-4 max-w-[260px]">
                    <p className="text-sm font-bold text-slate-900 hover:text-primary-700 transition-colors truncate">{routine.taskName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono font-semibold text-slate-400">{routine.taskCode}</span>
                      {!routine.isActive && (
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">stopped</span>
                      )}
                      {!routine.frequency && (
                        <span className="text-[10px] font-bold text-warning-600 bg-warning-50 px-2 py-0.5 rounded-full border border-warning-100">no cadence</span>
                      )}
                    </div>
                  </td>

                  {/* Owner */}
                  <td className="px-6 py-4">
                    <p className="text-xs font-bold text-slate-900">{routine.doerFirstName} {routine.doerLastName}</p>
                  </td>

                  {/* Frequency */}
                  <td className="px-6 py-4">
                    {routine.frequency && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary-50 text-primary-600 border border-primary-200 text-[10px] font-bold shadow-enterprise">
                        <Repeat size={10} />
                        {routine.frequency.toUpperCase()}
                      </span>
                    )}
                  </td>

                  {/* Window */}
                  <td className="px-6 py-4">
                    <p className="text-xs font-semibold text-slate-500">
                      {fmtDate(routine.startDate)} to {fmtDate(routine.endDate)}
                    </p>
                  </td>

                  {/* Progress */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden max-w-[100px]">
                        <div
                          className="bg-success-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-slate-500 font-bold whitespace-nowrap">
                        {prog.done}/{prog.total}
                      </span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(routine)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 hover:text-primary-700 font-bold text-xs flex items-center gap-1 shadow-enterprise transition-all cursor-pointer"
                      >
                        <Edit3 size={12} /> Edit
                      </button>
                      {routine.isActive && (
                        <button
                          type="button"
                          onClick={() => onStop(routine)}
                          className="px-3 py-1.5 rounded-lg border border-warning-100 hover:border-warning-100 bg-white hover:bg-warning-50 text-warning-600 font-bold text-xs flex items-center gap-1 shadow-enterprise transition-all cursor-pointer"
                        >
                          <StopCircle size={12} /> Stop
                        </button>
                      )}
                    </div>
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

export default RoutinesTable;
