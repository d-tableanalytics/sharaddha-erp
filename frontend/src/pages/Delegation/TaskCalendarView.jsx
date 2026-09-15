import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
} from 'lucide-react';

const HOURS = [
  '08:00 AM',
  '09:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '01:00 PM',
  '02:00 PM',
  '03:00 PM',
  '04:00 PM',
  '05:00 PM',
  '06:00 PM',
  '07:00 PM',
  '08:00 PM',
  '09:00 PM',
  '10:00 PM',
];

export function TaskCalendarView({ tasks = [], onTaskClick }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState('Week'); // 'Day' | 'Week' | 'Month'

  // Navigation
  const prevPeriod = () => {
    const next = new Date(currentDate);
    if (calendarMode === 'Day') next.setDate(next.getDate() - 1);
    else if (calendarMode === 'Week') next.setDate(next.getDate() - 7);
    else if (calendarMode === 'Month') next.setMonth(next.getMonth() - 1);
    setCurrentDate(next);
  };

  const nextPeriod = () => {
    const next = new Date(currentDate);
    if (calendarMode === 'Day') next.setDate(next.getDate() + 1);
    else if (calendarMode === 'Week') next.setDate(next.getDate() + 7);
    else if (calendarMode === 'Month') next.setMonth(next.getMonth() + 1);
    setCurrentDate(next);
  };

  const jumpToday = () => {
    setCurrentDate(new Date());
  };

  // Compute days of current week (Monday through Sunday)
  const weekDays = useMemo(() => {
    const curr = new Date(currentDate);
    const day = curr.getDay();
    const diff = curr.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(curr.setDate(diff));

    const days = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(monday);
      nextDay.setDate(monday.getDate() + i);
      days.push(nextDay);
    }
    return days;
  }, [currentDate]);

  // Format header range text
  const headerDateLabel = useMemo(() => {
    if (calendarMode === 'Day') {
      return currentDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    if (calendarMode === 'Week') {
      const first = weekDays[0];
      const last = weekDays[6];
      return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [calendarMode, currentDate, weekDays]);

  const todayStr = new Date().toDateString();

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-enterprise/40 overflow-hidden flex flex-col">
      {/* Calendar Top Controls */}
      <div className="flex flex-wrap items-center justify-between p-4 border-b border-slate-200 gap-4 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-enterprise">
            <button
              onClick={prevPeriod}
              className="p-1.5 hover:bg-slate-100 rounded text-slate-600 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={jumpToday}
              className="px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded transition-colors"
            >
              Today
            </button>
            <button
              onClick={nextPeriod}
              className="p-1.5 hover:bg-slate-100 rounded text-slate-600 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <span className="text-sm font-bold text-slate-900 ml-2">{headerDateLabel}</span>
        </div>

        {/* Day / Week / Month Pill Selector */}
        <div className="flex items-center bg-slate-200/70 p-1 rounded-lg gap-1">
          {['Day', 'Week', 'Month'].map((mode) => (
            <button
              key={mode}
              onClick={() => setCalendarMode(mode)}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                calendarMode === mode
                  ? 'bg-white text-primary-700 shadow-enterprise'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Week Grid */}
      {calendarMode === 'Week' && (
        <div className="overflow-x-auto">
          <div className="min-w-[850px]">
            {/* Week Header: Days of Week */}
            <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-100/60 text-center text-xs font-bold">
              <div className="p-3 border-r border-slate-200 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                Time
              </div>
              {weekDays.map((d, i) => {
                const isToday = d.toDateString() === todayStr;
                return (
                  <div
                    key={i}
                    className={`p-3 border-r border-slate-200/60 flex flex-col items-center ${
                      isToday ? 'bg-primary-50 text-primary-700' : 'text-slate-700'
                    }`}
                  >
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      {d.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className={`text-sm font-bold mt-0.5 ${isToday ? 'text-primary-700' : ''}`}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Time Grid (08:00 AM to 10:00 PM) */}
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto custom-scrollbar">
              {HOURS.map((hour, hIdx) => (
                <div key={hour} className="grid grid-cols-8 min-h-[56px]">
                  {/* Hour Label */}
                  <div className="p-2 border-r border-slate-200 text-[10px] font-bold text-slate-400 flex items-start justify-end pr-3">
                    {hour}
                  </div>

                  {/* Day Columns */}
                  {weekDays.map((d, dIdx) => {
                    const isToday = d.toDateString() === todayStr;
                    const dStr = d.toISOString().split('T')[0];

                    // Find tasks for this day
                    const dayTasks = tasks.filter((t) => {
                      if (!t.dueDate) return false;
                      const taskDay = new Date(t.dueDate).toISOString().split('T')[0];
                      return taskDay === dStr;
                    });

                    return (
                      <div
                        key={dIdx}
                        className={`p-1 border-r border-slate-100 hover:bg-slate-50/50 transition-colors relative flex flex-col gap-1 ${
                          isToday ? 'bg-primary-50/20' : ''
                        }`}
                      >
                        {/* Only render on first few hours to avoid repeating, or match hour if time stored */}
                        {hIdx === 1 &&
                          dayTasks.map((t) => (
                            <div
                              key={t._id}
                              onClick={() => onTaskClick(t)}
                              className="px-2 py-1 rounded-md bg-primary-600 text-white text-[10px] font-bold shadow-enterprise hover:bg-primary-700 cursor-pointer truncate transition-all active:scale-[0.98]"
                              title={`${t.taskTitle} (${t.doerFirstName})`}
                            >
                              <span className="font-bold">[{t.priority}]</span> {t.taskTitle}
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Day Mode */}
      {calendarMode === 'Day' && (
        <div className="p-6">
          <div className="max-w-xl mx-auto space-y-3">
            <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider">
              Tasks Scheduled for {currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </h4>
            {tasks
              .filter((t) => {
                if (!t.dueDate) return false;
                return (
                  new Date(t.dueDate).toISOString().split('T')[0] ===
                  currentDate.toISOString().split('T')[0]
                );
              })
              .map((t) => (
                <div
                  key={t._id}
                  onClick={() => onTaskClick(t)}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:border-primary-600 hover:shadow-md cursor-pointer transition-all flex items-center justify-between"
                >
                  <div>
                    <h5 className="text-sm font-bold text-slate-900">{t.taskTitle}</h5>
                    <p className="text-xs text-slate-500 font-semibold">
                      Assignee: {t.doerFirstName} {t.doerLastName} · Status: {t.status}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-primary-50 text-primary-700">
                    {t.priority}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Month Mode */}
      {calendarMode === 'Month' && (
        <div className="p-6 text-center">
          <p className="text-xs font-bold text-slate-500 mb-4">
            Viewing tasks for month of{' '}
            <strong className="text-slate-900">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </strong>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {tasks.map((t) => (
              <div
                key={t._id}
                onClick={() => onTaskClick(t)}
                className="p-3 rounded-xl border border-slate-200 bg-white text-left hover:border-primary-600 cursor-pointer hover:shadow-enterprise"
              >
                <div className="text-[10px] font-bold text-slate-400">
                  {t.dueDate
                    ? new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : 'No date'}
                </div>
                <div className="text-xs font-bold text-slate-900 line-clamp-1">{t.taskTitle}</div>
                <div className="text-[11px] font-medium text-slate-500 truncate">
                  {t.doerFirstName} {t.doerLastName}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TaskCalendarView;
