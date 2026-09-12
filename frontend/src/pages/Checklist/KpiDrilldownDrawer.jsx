/**
 * KPI Drilldown Drawer — right-side panel showing occurrences behind a stat tile.
 *
 * Opened by clicking a stat tile. Shows a filtered list of tasks, with a
 * "Show in list →" button to apply the same filter to the main Tasks view.
 */

import { useState, useEffect } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { checklistApi } from '../../services/checklist';
import {
  ClipboardList,
  Clock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
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
  total:        { label: 'Total Tasks',    icon: ClipboardList, color: 'slate' },
  pendingToday: { label: 'Pending Today',  icon: Clock,         color: 'blue' },
  overdue:      { label: 'Overdue Tasks',  icon: AlertTriangle, color: 'red' },
  completed:    { label: 'Completed',      icon: CheckCircle2,  color: 'emerald' },
};

const STATUS_STYLES = {
  completed:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending:          'bg-slate-100 text-slate-600 border-slate-200',
  overdue:          'bg-red-50 text-red-700 border-red-200',
  'non-functional': 'bg-amber-50 text-amber-700 border-amber-200',
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl bg-${meta.color}-100 flex items-center justify-center`}>
              <Icon size={18} className={`text-${meta.color}-600`} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{meta.label}</p>
              <p className="text-[11px] text-slate-400">{tasks.length} task(s)</p>
            </div>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => { onShowInList(kpi); onClose(); }}
            className="!text-[11px]"
          >
            Show in list <ArrowRight size={12} className="ml-1" />
          </Button>
        </div>

        {/* Task list */}
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-emerald-500" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-slate-500">No tasks in this bucket.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
            {tasks.map((task) => (
              <div
                key={task._id}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{task.taskName}</p>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">{task.taskCode}</p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[task.status] || STATUS_STYLES.pending}`}>
                    {task.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                  <span>{task.doerFirstName} {task.doerLastName}</span>
                  <span className="flex items-center gap-1">
                    <CalendarDays size={11} /> {fmtDate(task.plannedDate)}
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
