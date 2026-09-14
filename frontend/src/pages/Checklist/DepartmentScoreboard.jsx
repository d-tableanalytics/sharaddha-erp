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
  const textColors = {
    emerald: 'text-emerald-600',
    amber:   'text-amber-600',
    red:     'text-red-600',
    indigo:  'text-indigo-600',
  };

  const dots = {
    emerald: 'bg-emerald-500',
    amber:   'bg-amber-500',
    red:     'bg-red-500',
    indigo:  'bg-indigo-500',
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs flex flex-col justify-between">
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dots[color] || 'bg-slate-400'}`} />
      </div>
      <p className={`text-2xl font-black tabular-nums mt-0.5 ${textColors[color] || 'text-slate-800'}`}>{value}</p>
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
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden transition-all duration-200 hover:shadow-md shadow-xs">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/80 transition-colors cursor-pointer select-none"
      >
        {/* Rank badge */}
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${rankBadge(rank)}`}>
          {rank}
        </span>

        {/* Department info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{dept._id || 'Unknown'}</p>
          <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
            {dept.totalTasks} tasks · {dept.peopleCount} people
          </p>
        </div>

        {/* Stats pills */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            {dept.totalCompleted} ✓
          </span>
          <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {dept.totalPending} pend
          </span>
          <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            {dept.totalMissed} miss
          </span>
        </div>

        {/* Compliance */}
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-base font-black tabular-nums ${cc === 'emerald' ? 'text-emerald-600' : cc === 'amber' ? 'text-amber-600' : 'text-red-600'}`}>
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
        <div className="border-t border-slate-100 bg-slate-50/50 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <Users size={12} className="inline mr-1" />
              People in {dept._id}
            </span>
            <button
              type="button"
              onClick={() => onViewTasks(dept._id)}
              className="text-[11px] font-bold text-[#1E4C92] hover:underline flex items-center gap-1 transition-colors cursor-pointer"
            >
              View tasks <ArrowRight size={12} />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {(dept.people || []).map((person, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className="flex-1 text-slate-800 font-bold truncate">
                  {person.doerFirstName} {person.doerLastName}
                  <span className="text-slate-400 font-normal ml-1">· {person.total} tasks</span>
                </span>
                <span className="text-emerald-600 font-bold text-[11px]">{person.completed}✓</span>
                <span className="text-amber-600 font-bold text-[11px]">{person.pending} pend</span>
                <span className="text-red-600 font-bold text-[11px]">{person.missed} miss</span>
                <span className="text-slate-700 font-black text-[11px] tabular-nums w-10 text-right">{person.complianceRate}%</span>
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

  if (!data || !data.departments?.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs flex flex-col items-center justify-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#1E4C92] border border-blue-200/60 flex items-center justify-center mb-3">
          <Building2 size={28} />
        </div>
        <h3 className="text-base font-black text-slate-800 mb-1">No Department Data</h3>
        <p className="text-xs font-medium text-slate-500 max-w-sm">
          Run checklists to see rankings and compliance rates across departments.
        </p>
      </div>
    );
  }

  const { overall = {}, departments = [] } = data;

  return (
    <div className="space-y-5">
      {/* ── Summary strip ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Tasks" value={overall.totalTasks || 0} color="indigo" />
        <SummaryCard label="Completed" value={overall.totalCompleted || 0} color="emerald" />
        <SummaryCard label="Pending" value={overall.totalPending || 0} color="amber" />
        <SummaryCard label="Avg Compliance" value={`${overall.avgCompliance || 0}%`} color="emerald" />
      </div>

      {/* ── Department list ──────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {departments.map((dept, idx) => (
          <DepartmentRow
            key={dept._id || idx}
            dept={dept}
            rank={idx + 1}
            onViewTasks={onViewTasks}
          />
        ))}
      </div>
    </div>
  );
}

export default DepartmentScoreboard;
