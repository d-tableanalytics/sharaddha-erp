/**
 * KPI Drilldown Drawer — right-side panel showing occurrences behind a stat tile.
 *
 * Opened by clicking a stat tile. Shows a filtered list of tasks, with a
 * "Show in list →" button to apply the same filter to the main Tasks view.
 */

import { useState, useEffect } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { checklistApi } from '../../services/checklist';
import {
  ClipboardList,
  Clock,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  ArrowRight,
  Loader2,
} from 'lucide-react';

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  const day = dt.getDate().toString().padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
};

const KPI_META = {
  total:        { label: 'Total Tasks',    icon: ClipboardList, bg: 'bg-slate-100', text: 'text-slate-700' },
  pendingToday: { label: 'Pending Today',  icon: Clock,         bg: 'bg-primary-50',   text: 'text-primary-600' },
  overdue:      { label: 'Overdue Tasks',  icon: AlertTriangle, bg: 'bg-red-50',    text: 'text-red-600' },
  completed:    { label: 'Completed',      icon: CheckCircle2,  bg: 'bg-emerald-50', text: 'text-emerald-600' },
};

const STATUS_STYLES = {
  completed:        'bg-emerald-50 text-emerald-600 border-emerald-200',
  pending:          'bg-slate-50 text-slate-600 border-slate-200',
  overdue:          'bg-red-50 text-red-600 border-red-200',
  'non-functional': 'bg-amber-50 text-amber-600 border-amber-200',
};

export function KpiDrilldownDrawer({ isOpen, onClose, kpi, site, onShowInList }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !kpi) return;
    setLoading(true);
    checklistApi.getDrilldown({ kpi, site })
      .then((data) => setTasks(data || []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [isOpen, kpi, site]);

  const meta = KPI_META[kpi] || KPI_META.total;
  const Icon = meta.icon;

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={meta.label} maxWidth="max-w-md">
      <div className="space-y-4">
        {/* Header with icon and count */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-lg ${meta.bg} flex items-center justify-center`}>
              <Icon size={18} className={meta.text} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{meta.label}</p>
              <p className="text-[11px] font-semibold text-slate-400">{tasks.length} task(s)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { onShowInList(kpi); onClose(); }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 hover:text-primary-700 font-bold text-xs flex items-center gap-1 transition-all cursor-pointer shadow-xs"
          >
            <span>Show in list</span>
            <ArrowRight size={12} />
          </button>
        </div>

        {/* Task list */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary-700 mb-2" />
            <p className="text-xs font-semibold text-slate-400">Loading occurrences...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xs font-semibold text-slate-500">No tasks in this category.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
            {tasks.map((task) => (
              <div
                key={task._id}
                className="p-3.5 rounded-lg bg-white border border-slate-200 hover:border-primary-600 hover:shadow-xs transition-all shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 truncate">{task.taskName}</p>
                    <p className="text-[11px] font-mono font-semibold text-slate-400 mt-0.5">{task.taskCode}</p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${STATUS_STYLES[task.status] || STATUS_STYLES.pending}`}>
                    {task.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[11px] font-semibold text-slate-500 pt-1 border-t border-slate-100">
                  <span>{task.doerFirstName} {task.doerLastName}</span>
                  <span className="flex items-center gap-1 ml-auto">
                    <CalendarDays size={11} className="text-slate-400" /> {fmtDate(task.plannedDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default KpiDrilldownDrawer;
