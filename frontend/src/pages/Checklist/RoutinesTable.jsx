/**
 * Routines table — the master-rule view (admin/manager only).
 *
 * Shows each routine with its task name, code, owner, frequency, date window,
 * progress bar, and edit/stop actions.
 */

import { Repeat, Edit3, StopCircle, ClipboardList } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SkeletonLoader } from '../../components/ui/SkeletonLoader';

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
          <SkeletonLoader key={i} variant="rectangular" className="h-16 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!routines?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-dashed border-slate-200">
        <div className="flex items-center justify-center w-14 h-14 mb-4 bg-slate-50 rounded-full border border-slate-100">
          <ClipboardList size={24} className="text-slate-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">No routines yet</h3>
        <p className="text-xs text-slate-500">
          Create one and every occurrence is generated up front.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Routine</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Owner</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Frequency</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Window</th>
              <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Progress</th>
              <th className="text-right text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {routines.map((routine) => {
              const prog = routine.progress || { total: 0, done: 0 };
              const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

              return (
                <tr key={routine._id} className="border-b border-slate-100 last:border-0 hover:bg-emerald-50/40 transition-colors duration-200">
                  {/* Routine name */}
                  <td className="px-4 py-3 max-w-[260px]">
                    <p className="text-sm font-semibold text-slate-900 truncate">{routine.taskName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono text-slate-400">{routine.taskCode}</span>
                      {!routine.isActive && (
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">stopped</span>
                      )}
                      {!routine.frequency && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">no cadence</span>
                      )}
                    </div>
                  </td>

                  {/* Owner */}
                  <td className="px-4 py-3">
                    <p className="text-[13px] text-slate-800">{routine.doerFirstName} {routine.doerLastName}</p>
                  </td>

                  {/* Frequency */}
                  <td className="px-4 py-3">
                    {routine.frequency && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-semibold">
                        <Repeat size={10} />
                        {routine.frequency.charAt(0).toUpperCase() + routine.frequency.slice(1)}
                      </span>
                    )}
                  </td>

                  {/* Window */}
                  <td className="px-4 py-3">
                    <p className="text-[12px] text-slate-500">
                      {fmtDate(routine.startDate)} to {fmtDate(routine.endDate)}
                    </p>
                  </td>

                  {/* Progress */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden max-w-[100px]">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
                        {prog.done}/{prog.total}
                      </span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onEdit(routine)}
                        className="!text-[11px]"
                      >
                        <Edit3 size={12} className="mr-1" /> Edit
                      </Button>
                      {routine.isActive && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => onStop(routine)}
                          className="!text-[11px] !text-amber-600 !border-amber-200 hover:!bg-amber-50"
                        >
                          <StopCircle size={12} className="mr-1" /> Stop
                        </Button>
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
