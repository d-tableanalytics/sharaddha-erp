/**
 * Department Scoreboard — the departments view (admin/manager only).
 *
 * Shows an overall summary strip (4 colored cards), then a ranked accordion
 * list of departments with compliance bars and expandable people rows.
 */

import { useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Users, ArrowRight } from 'lucide-react';
import { SkeletonLoader } from '../../components/ui/SkeletonLoader';

// ── Helpers ──────────────────────────────────────────────────────────────────

const complianceColor = (rate) => {
  if (rate >= 80) return 'emerald';
  if (rate >= 50) return 'amber';
  return 'red';
};

const rankBadge = (rank) => {
  if (rank === 1) return 'bg-amber-400 text-white';       // Gold
  if (rank === 2) return 'bg-slate-300 text-slate-700';    // Silver
  if (rank === 3) return 'bg-amber-700 text-white';        // Bronze
  return 'bg-slate-100 text-slate-500';
};

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber:   'bg-amber-50 text-amber-700 ring-amber-200',
    red:     'bg-red-50 text-red-700 ring-red-200',
    indigo:  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  };

  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${colors[color] || colors.emerald}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

// ── Department Row ───────────────────────────────────────────────────────────

function DepartmentRow({ dept, rank, onViewTasks }) {
  const [expanded, setExpanded] = useState(false);
  const cc = complianceColor(dept.complianceRate);

  const barColors = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden transition-all duration-200 hover:shadow-md">
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/50 transition-colors"
      >
        {/* Rank badge */}
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${rankBadge(rank)}`}>
          {rank}
        </span>

        {/* Department info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{dept._id || 'Unknown'}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {dept.totalTasks} tasks · {dept.peopleCount} people
          </p>
        </div>

        {/* Stats pills */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            {dept.totalCompleted} ✓
          </span>
          <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
            {dept.totalPending} pend
          </span>
          <span className="text-[11px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
            {dept.totalMissed} miss
          </span>
        </div>

        {/* Compliance */}
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-lg font-extrabold tabular-nums text-${cc}-600`}>
            {dept.complianceRate}%
          </span>
          <div className="w-24 bg-slate-200 rounded-full h-2 overflow-hidden hidden md:block">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColors[cc]}`}
              style={{ width: `${dept.complianceRate}%` }}
            />
          </div>
          {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </button>

      {/* Expanded: people list */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/40">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <Users size={12} className="inline mr-1" />
              People in {dept._id}
            </span>
            <button
              onClick={() => onViewTasks(dept._id)}
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors"
            >
              View tasks <ArrowRight size={12} />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {(dept.people || []).map((person, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="flex-1 text-slate-800 font-medium truncate">
                  {person.doerFirstName} {person.doerLastName}
                  <span className="text-slate-400 font-normal ml-1">· {person.total} tasks</span>
                </span>
                <span className="text-emerald-600 font-semibold text-[11px]">{person.completed}✓</span>
                <span className="text-amber-600 font-semibold text-[11px]">{person.pending} pend</span>
                <span className="text-red-600 font-semibold text-[11px]">{person.missed} miss</span>
                <span className="text-slate-700 font-bold text-[11px] tabular-nums w-10 text-right">{person.complianceRate}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DepartmentScoreboard({ data, loading, onViewTasks }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonLoader key={i} variant="rectangular" className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!data?.departments?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-dashed border-slate-200">
        <div className="flex items-center justify-center w-14 h-14 mb-4 bg-slate-50 rounded-full border border-slate-100">
          <Building2 size={24} className="text-slate-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">No department data yet</h3>
        <p className="text-xs text-slate-500 max-w-xs text-center">
          Department compliance is calculated from checklist tasks. Create routines and assign them to see data here.
        </p>
      </div>
    );
  }

  const { overall, departments } = data;

  return (
    <div className="space-y-5">
      {/* Overall summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Completed" value={overall.completed} color="emerald" />
        <SummaryCard label="Pending" value={overall.pending} color="amber" />
        <SummaryCard label="Missed" value={overall.missed} color="red" />
        <SummaryCard label="Compliance" value={`${overall.complianceRate}%`} color="indigo" />
      </div>

      {/* Ranked department list */}
      <div className="space-y-2">
        {departments.map((dept, i) => (
          <DepartmentRow
            key={dept._id || i}
            dept={dept}
            rank={i + 1}
            onViewTasks={onViewTasks}
          />
        ))}
      </div>
    </div>
  );
}
