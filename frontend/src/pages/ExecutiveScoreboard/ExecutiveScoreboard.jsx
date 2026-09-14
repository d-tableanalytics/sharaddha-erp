import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trophy,
  Building2,
  RefreshCw,
  Download,
  Search,
  Target,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { scoreboardApi } from '../../services/scoreboard';
import { useUserStore } from '../../store/userStore';
import { useHrmsStore } from '../../store/hrmsStore';

// Medals for top 3
const MEDALS = ['🥇', '🥈', '🥉'];

// Enterprise Avatar Color Palette (consistent with application standard)
const AVATAR_COLOR_PALETTE = [
  'bg-[#1E4C92]/10 text-[#1E4C92] border-[#1E4C92]/20',
  'bg-indigo-50 text-indigo-700 border-indigo-200/60',
  'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  'bg-sky-50 text-sky-700 border-sky-200/60',
  'bg-amber-50 text-amber-700 border-amber-200/60',
  'bg-purple-50 text-purple-700 border-purple-200/60',
];

function getAvatarColor(nameOrId = '', index = 0) {
  if (!nameOrId) return AVATAR_COLOR_PALETTE[index % AVATAR_COLOR_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < nameOrId.length; i++) {
    hash = nameOrId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_COLOR_PALETTE.length;
  return AVATAR_COLOR_PALETTE[idx];
}

function getInitials(name = '') {
  if (!name) return 'U';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Score Performance Band (Higher score is better)
 */
export function band(score) {
  if (score === null || score === undefined) return 'text-slate-400';
  if (score >= 85) return 'text-emerald-600 font-semibold';
  if (score >= 70) return 'text-sky-600 font-semibold';
  if (score >= 50) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

/**
 * KPI Miss Band against 0% benchmark (Lower miss percentage is better)
 */
export function missBand(pct) {
  if (pct === null || pct === undefined) return 'text-slate-400';
  if (pct === 0) return 'text-emerald-600 font-semibold';
  if (pct <= 15) return 'text-sky-600 font-semibold';
  if (pct <= 30) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

/**
 * Inline Number Editor Component
 */
function EditableNum({
  value,
  disabled,
  placeholder = '—',
  onCommit,
  title,
  width = 'w-16',
  allowSign = false,
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  if (disabled) {
    const formatted =
      value !== null && value !== undefined && value !== ''
        ? allowSign && Number(value) > 0
          ? `+${value}`
          : value
        : placeholder;
    return (
      <span className="tabular-nums text-slate-600 font-semibold text-xs">
        {formatted}
      </span>
    );
  }

  const handleBlur = async () => {
    if (String(draft).trim() === String(value ?? '').trim()) return;

    let normalised = null;
    if (draft !== '' && draft !== null && draft !== undefined) {
      const num = Number(draft);
      if (!isNaN(num)) {
        normalised = num;
      }
    }

    setIsSaving(true);
    try {
      await onCommit(normalised);
    } catch {
      setDraft(value ?? '');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(value ?? '');
      e.currentTarget.blur();
    }
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <input
        type="text"
        title={title}
        disabled={isSaving}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`${width} h-7 px-2 py-0.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white text-slate-800 text-xs font-semibold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-[#1E4C92]/20 focus:border-[#1E4C92] shadow-xs transition-all`}
      />
      {isSaving && (
        <Loader2
          size={12}
          className="animate-spin text-[#1E4C92] absolute -right-3.5 top-1/2 -translate-y-1/2"
        />
      )}
    </div>
  );
}

/**
 * Top 3 Podium Card Component
 */
function PodiumCard({ row, rankIdx }) {
  const isFirst = rankIdx === 0;
  const isSecond = rankIdx === 1;

  const initials = getInitials(row.doer);
  const avatarColor = getAvatarColor(row.doer, rankIdx);

  const rankTheme = isFirst
    ? {
        border: 'border-amber-200/90 hover:border-amber-400',
        bg: 'bg-gradient-to-br from-amber-50/40 via-white to-white',
        badge: 'bg-amber-500 text-white',
        scoreGlow: 'bg-amber-50 text-amber-700 border border-amber-200/60',
      }
    : isSecond
    ? {
        border: 'border-slate-200 hover:border-slate-300',
        bg: 'bg-gradient-to-br from-slate-50/70 via-white to-white',
        badge: 'bg-slate-600 text-white',
        scoreGlow: 'bg-slate-50 text-slate-700 border border-slate-200',
      }
    : {
        border: 'border-orange-200/70 hover:border-orange-300',
        bg: 'bg-gradient-to-br from-orange-50/30 via-white to-white',
        badge: 'bg-orange-600 text-white',
        scoreGlow: 'bg-orange-50 text-orange-700 border border-orange-200/60',
      };

  return (
    <div
      className={`relative flex items-center gap-3.5 p-4 rounded-2xl border transition-all duration-200 shadow-xs hover:shadow-md ${rankTheme.border} ${rankTheme.bg}`}
    >
      <div className="relative shrink-0">
        <div
          className={`w-12 h-12 rounded-full font-semibold text-xs flex items-center justify-center border shadow-xs ${avatarColor}`}
        >
          {initials}
        </div>
        <span
          className={`absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold flex items-center justify-center border border-white shadow-xs ${rankTheme.badge}`}
        >
          #{row.rank}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-base leading-none select-none">
            {MEDALS[rankIdx] || '🎖️'}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Rank {row.rank}
          </span>
        </div>
        <div className="text-sm font-semibold text-slate-800 truncate mt-0.5">
          {row.doer}
        </div>
        <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5 mt-0.5">
          <span>Final Score:</span>
          <span className={`font-semibold tabular-nums ${band(row.finalScore)}`}>
            {row.finalScore ?? '—'}
          </span>
          {row.mdAdjustment !== 0 && (
            <span className="text-[10px] font-semibold text-slate-400">
              ({row.mdAdjustment > 0 ? `+${row.mdAdjustment}` : row.mdAdjustment})
            </span>
          )}
        </div>
      </div>

      <div
        className={`text-2xl font-semibold tabular-nums px-3 py-1.5 rounded-xl ${rankTheme.scoreGlow}`}
      >
        {row.finalScore ?? '—'}
      </div>
    </div>
  );
}

/**
 * Main Executive Scoreboard Component
 */
export function ExecutiveScoreboard() {
  const [period, setPeriod] = useState('week'); // 'week' | 'month' | 'year'
  const [scope, setScope] = useState('all'); // 'all' | 'HO' | 'Bhandup'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');

  const { user } = useUserStore();
  const { actor } = useHrmsStore();

  // Determine local permission override fallback if API has not responded yet
  const localCanEdit = useMemo(() => {
    if (!user) return false;
    const role = String(user.role || '').toUpperCase();
    if (['ADMIN', 'SUPERADMIN', 'SUPER ADMIN', 'MANAGEMENT'].includes(role)) return true;
    const des = user.designation || actor?.employee?.designation || '';
    return /\b(ceo|managing director|md)\b/i.test(des);
  }, [user, actor]);

  const canEdit = data?.canEdit !== undefined ? data.canEdit : localCanEdit;

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);
    try {
      const res = await scoreboardApi.getScoreboard({ period, scope });
      if (res) {
        setData(res);
      }
    } catch {
      toast.error('Failed to load scoreboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, scope]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Labels for headers based on period
  const periodLabel = useMemo(() => {
    if (period === 'month') return 'Month';
    if (period === 'year') return 'Year';
    return 'Week';
  }, [period]);

  const nextLabel = useMemo(() => {
    if (period === 'month') return 'Next Month';
    if (period === 'year') return 'Next Year';
    return 'Next Week';
  }, [period]);

  // Search filtering
  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    if (!search.trim()) return data.rows;
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => r.doer.toLowerCase().includes(q));
  }, [data?.rows, search]);

  // Handle inline goal / adjustment commit
  const handleCommitGoal = async (row, field, value) => {
    if (!data?.periodKey) return;

    const payload = {
      doerName: row.doer,
      userId: row.userId,
      period,
      periodKey: data.periodKey,
      [field]: value,
    };

    try {
      await scoreboardApi.updateGoal(payload);
      toast.success(`${field === 'nextGoal' ? 'Next goal' : 'MD adjustment'} updated`);

      // Optimistically update state and re-sort live
      setData((prev) => {
        if (!prev) return prev;
        const updatedRows = prev.rows.map((r) => {
          if (r.doer === row.doer) {
            const nextGoal = field === 'nextGoal' ? value : r.nextGoal;
            const mdAdjustment = field === 'mdAdjustment' ? (Number(value) || 0) : r.mdAdjustment;
            const finalScore = r.baselineScore !== null ? Math.max(0, r.baselineScore + mdAdjustment) : null;
            return {
              ...r,
              nextGoal,
              mdAdjustment,
              finalScore,
            };
          }
          return r;
        });

        // Re-sort using 3-level comparator
        updatedRows.sort((a, b) => {
          if (a.hasWork !== b.hasWork) return a.hasWork ? -1 : 1;
          const scoreA = a.finalScore !== null ? a.finalScore : -999;
          const scoreB = b.finalScore !== null ? b.finalScore : -999;
          if (scoreA !== scoreB) return scoreB - scoreA;
          return a.doer.localeCompare(b.doer);
        });

        updatedRows.forEach((r, idx) => {
          r.rank = idx + 1;
        });

        const top = updatedRows.filter((r) => r.hasWork && r.finalScore !== null).slice(0, 3);

        return {
          ...prev,
          rows: updatedRows,
          top,
        };
      });
    } catch (err) {
      toast.error('Failed to save update');
      throw err;
    }
  };

  // Excel / CSV Export
  const exportToExcel = () => {
    if (!filteredRows || filteredRows.length === 0) {
      toast.error('No scoreboard data to export');
      return;
    }

    const headers = [
      'Rank',
      'Doer Name',
      'KRA',
      'KPI',
      'Benchmark',
      `Last ${periodLabel} Actual %`,
      `Current ${periodLabel} Planned`,
      `Current ${periodLabel} Actual`,
      `Current ${periodLabel} Actual %`,
      `${nextLabel} Planned`,
      `${nextLabel} Score Goal`,
      'MD Adjustment',
      'Final Score',
    ];

    const flattened = filteredRows.flatMap((r) =>
      r.kras.map((k, i) => [
        i === 0 ? r.rank : '',
        i === 0 ? `"${r.doer.replace(/"/g, '""')}"` : '',
        `"${k.kra.replace(/"/g, '""')}"`,
        `"${k.kpi.replace(/"/g, '""')}"`,
        `${k.benchmark}%`,
        k.lastPct !== null ? `${k.lastPct}%` : '',
        k.planned,
        k.actual,
        k.actualPct !== null ? `${k.actualPct}%` : '',
        i === 0 ? r.nextPlanned : '',
        i === 0 ? (r.nextGoal ?? '') : '',
        i === 0 ? (r.mdAdjustment ?? 0) : '',
        i === 0 ? (r.finalScore ?? '') : '',
      ])
    );

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...flattened.map((row) => row.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const filename = `Executive-Scoreboard-${period}-${data?.periodStart || 'export'}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Scoreboard exported successfully');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* ── 1. HEADER & GLOBAL CONTROLS ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-[#1E4C92] rounded-xl flex items-center justify-center shadow-lg shadow-[#1E4C92]/30 shrink-0">
            <Trophy className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-800 leading-none">
                Executive Scoreboard
              </h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#1E4C92] bg-[#1E4C92]/10 border border-[#1E4C92]/20 px-2.5 py-0.5 rounded-full">
                Leadership
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-400 mt-1">
              {loading && !data ? (
                'Loading…'
              ) : (
                <>
                  {periodLabel} of {data?.periodStart} — {data?.periodEnd} ·{' '}
                  <span className="font-semibold text-slate-600">
                    {data?.totalDoers || 0} doers
                  </span>{' '}
                  ·{' '}
                  <span className="font-semibold text-emerald-600">
                    {data?.activeDoers || 0} active with work
                  </span>{' '}
                  this {period}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Period Selector Pill Group */}
          <div className="h-10 bg-slate-100 rounded-xl p-1 border border-slate-200 flex items-center gap-1 shadow-xs shrink-0">
            {['week', 'month', 'year'].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                  period === p
                    ? 'bg-[#1E4C92] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Scope Selector Pill Group */}
          <div className="h-10 bg-slate-100 rounded-xl p-1 border border-slate-200 flex items-center gap-1 shadow-xs shrink-0">
            <Building2 size={14} className="ml-2 mr-0.5 text-slate-400 shrink-0" />
            {[
              { id: 'all', label: 'Overall' },
              { id: 'HO', label: 'HO' },
              { id: 'Bhandup', label: 'Bhandup' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  scope === s.id
                    ? 'bg-[#1E4C92] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
            title="Refresh Scoreboard"
            className="h-10 px-3.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#1E4C92] rounded-xl font-semibold text-xs flex items-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#1E4C92]' : 'text-slate-500'}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Excel Export Button */}
          <button
            type="button"
            onClick={exportToExcel}
            className="h-10 px-4 bg-[#1E4C92] hover:bg-[#163a6a] text-white rounded-xl font-semibold text-xs flex items-center gap-2 shadow-sm shadow-[#1E4C92]/20 transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Download size={14} strokeWidth={2.5} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* ── 2. TOP 3 PODIUM CARDS ────────────────────────────────────────── */}
      {!loading && data?.top?.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Top Performers Podium
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {data.top.map((row, idx) => (
              <PodiumCard key={row.doer} row={row} rankIdx={idx} />
            ))}
          </div>
        </div>
      )}

      {/* ── 3. SEARCH & EXECUTIVE ADVISORY BAR ───────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search
            size={15}
            className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by doer name..."
            className="w-full h-11 pl-10 pr-9 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-semibold outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 shadow-xs text-slate-700 placeholder:text-slate-400 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Advisory Banner */}
        <div className="shrink-0">
          {canEdit ? (
            <div className="text-[11px] font-semibold text-[#1E4C92] inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#1E4C92]/5 border border-[#1E4C92]/20 shadow-xs">
              <Target size={14} className="text-[#1E4C92] shrink-0" />
              <span>
                Set the <strong>{nextLabel}</strong> score goal & MD adjustment inline — rankings recalculate instantly.
              </span>
            </div>
          ) : (
            <div className="text-[11px] font-semibold text-slate-500 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 shadow-xs">
              <Info size={14} className="text-slate-400 shrink-0" />
              <span>Score goals and leadership adjustments are set by the CEO/MD.</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 4. KRA/KPI SCOREBOARD GRID TABLE ──────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200">
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-center w-14">
                  Rank
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[200px]">
                  Doer Name
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[190px]">
                  KRA
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[160px]">
                  KPI
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-center w-24">
                  Benchmark
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-center min-w-[120px]">
                  Last {periodLabel} Actual %
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-center min-w-[110px]">
                  Current {periodLabel} Planned
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-center min-w-[100px]">
                  Current {periodLabel} Actual
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-center min-w-[120px]">
                  Current {periodLabel} Actual %
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-center min-w-[100px]">
                  {nextLabel} Planned
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold uppercase tracking-wider text-center min-w-[120px] bg-[#1E4C92]/5 text-[#1E4C92] border-l border-slate-200">
                  {nextLabel} Score Goal
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold uppercase tracking-wider text-center min-w-[115px] bg-[#1E4C92]/5 text-[#1E4C92] border-l border-slate-200">
                  MD Adjustment
                </th>
                <th className="px-3.5 py-3 text-[10px] font-semibold uppercase tracking-wider text-center min-w-[105px] bg-[#1E4C92]/10 text-[#1E4C92] border-l border-slate-200">
                  Final Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data ? (
                // Skeleton Rows
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={13} className="px-4 py-3">
                      <div className="h-10 bg-slate-100 rounded-xl" />
                    </td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                // Empty State
                <tr>
                  <td colSpan={13} className="py-16 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                      <Trophy size={26} strokeWidth={2} />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800">
                      No doers found
                    </h3>
                    <p className="text-xs font-semibold text-slate-400 mt-1">
                      No scoreboard records match your current filter criteria.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, rIdx) => {
                  const initials = getInitials(r.doer);
                  const avatarColor = getAvatarColor(r.doer, rIdx);

                  return r.kras.map((k, i) => {
                    const isFirstKra = i === 0;
                    const isRankPodium = r.hasWork && r.rank <= 3;
                    const medalEmoji = isRankPodium ? MEDALS[r.rank - 1] : null;
                    const isLastKraOfDoer = i === r.kras.length - 1;

                    return (
                      <tr
                        key={`${r.doer}-${k.key}`}
                        className={`transition-colors hover:bg-slate-50/60 ${
                          isLastKraOfDoer
                            ? 'border-b-2 border-slate-200/90'
                            : 'border-b border-slate-100'
                        }`}
                      >
                        {/* Spanned Column: Rank */}
                        {isFirstKra && (
                          <td
                            rowSpan={2}
                            className="px-3.5 py-2.5 text-center align-middle border-r border-slate-100 bg-white"
                          >
                            <div className="inline-flex items-center gap-1 justify-center font-semibold text-xs tabular-nums text-slate-800">
                              {medalEmoji ? (
                                <span className="text-base leading-none">{medalEmoji}</span>
                              ) : (
                                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-semibold">
                                  {r.rank}
                                </span>
                              )}
                            </div>
                          </td>
                        )}

                        {/* Spanned Column: Doer Name */}
                        {isFirstKra && (
                          <td
                            rowSpan={2}
                            className="px-3.5 py-2.5 align-middle border-r border-slate-100 bg-white"
                          >
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8 h-8 rounded-full font-semibold text-[11px] flex items-center justify-center border shadow-xs shrink-0 ${avatarColor}`}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-xs text-slate-800 hover:text-[#1E4C92] transition-colors truncate">
                                  {r.doer}
                                </div>
                                {!r.hasWork ? (
                                  <span className="inline-block text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                                    No tasks
                                  </span>
                                ) : (
                                  <span className="inline-block text-[10px] font-semibold text-slate-400 truncate">
                                    Active Contributor
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        )}

                        {/* KRA description */}
                        <td className="px-3.5 py-2.5 text-xs font-semibold text-slate-800">
                          {k.kra}
                        </td>

                        {/* KPI description */}
                        <td className="px-3.5 py-2.5 text-xs font-medium text-slate-500">
                          {k.kpi}
                        </td>

                        {/* Benchmark: 0% */}
                        <td className="px-3.5 py-2.5 text-center text-xs font-semibold text-slate-400">
                          0%
                        </td>

                        {/* Last Period Actual % */}
                        <td
                          className={`px-3.5 py-2.5 text-center text-xs font-semibold tabular-nums ${missBand(
                            k.lastPct
                          )}`}
                        >
                          {k.lastPct !== null ? `${k.lastPct}%` : '—'}
                        </td>

                        {/* Current Planned */}
                        <td className="px-3.5 py-2.5 text-center text-xs font-semibold tabular-nums text-slate-700">
                          {k.planned}
                        </td>

                        {/* Current Actual */}
                        <td className="px-3.5 py-2.5 text-center text-xs font-semibold tabular-nums text-slate-700">
                          {k.actual}
                        </td>

                        {/* Current Actual % */}
                        <td
                          className={`px-3.5 py-2.5 text-center text-xs font-semibold tabular-nums ${missBand(
                            k.actualPct
                          )}`}
                        >
                          {k.actualPct !== null ? `${k.actualPct}%` : '—'}
                        </td>

                        {/* Spanned Column: Next Planned */}
                        {isFirstKra && (
                          <td
                            rowSpan={2}
                            className="px-3.5 py-2.5 text-center align-middle text-xs font-semibold tabular-nums text-slate-700 border-l border-slate-100 bg-white"
                          >
                            {r.nextPlanned}
                          </td>
                        )}

                        {/* Spanned Column: Next Period Score Goal (MD) */}
                        {isFirstKra && (
                          <td
                            rowSpan={2}
                            className="px-2.5 py-2.5 text-center align-middle bg-[#1E4C92]/[0.02] border-l border-slate-100"
                          >
                            <EditableNum
                              value={r.nextGoal}
                              disabled={!canEdit}
                              placeholder="—"
                              title="Set next period score goal (0-100)"
                              width="w-16"
                              onCommit={(val) => handleCommitGoal(r, 'nextGoal', val)}
                            />
                          </td>
                        )}

                        {/* Spanned Column: MD Adjustment */}
                        {isFirstKra && (
                          <td
                            rowSpan={2}
                            className="px-2.5 py-2.5 text-center align-middle bg-[#1E4C92]/[0.02] border-l border-slate-100"
                          >
                            <EditableNum
                              value={r.mdAdjustment}
                              disabled={!canEdit}
                              placeholder="0"
                              allowSign={true}
                              title="Set MD tie-breaker adjustment (-10 to +10)"
                              width="w-16"
                              onCommit={(val) => handleCommitGoal(r, 'mdAdjustment', val)}
                            />
                          </td>
                        )}

                        {/* Spanned Column: Final Score */}
                        {isFirstKra && (
                          <td
                            rowSpan={2}
                            className={`px-3.5 py-2.5 text-center align-middle bg-[#1E4C92]/[0.04] text-base font-semibold tabular-nums border-l border-slate-100 ${band(
                              r.finalScore
                            )}`}
                          >
                            {r.finalScore !== null ? r.finalScore : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  });
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 5. FOOTNOTE & CALCULATION METHODOLOGY ─────────────────────────── */}
      <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs text-slate-600 text-xs space-y-3 leading-relaxed">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[#1E4C92]/10 text-[#1E4C92] flex items-center justify-center shrink-0">
            <Info size={14} strokeWidth={2.5} />
          </div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
            Scoring Methodology & Operational Benchmarks
          </h4>
        </div>
        <p className="text-xs font-medium text-slate-500">
          Both Key Result Areas (KRAs) evaluate operational misses against an absolute benchmark of{' '}
          <strong className="text-slate-700">0%</strong>. Lower miss percentages indicate superior velocity and discipline. Baseline individual score is mathematically calculated as:
        </p>
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 w-fit text-xs font-mono font-semibold text-slate-700 shadow-xs">
          Baseline Score = Mean( (100 - % Work Not Done) + (100 - % Work Not Done On Time) )
        </div>
        <p className="text-xs font-medium text-slate-500">
          Final executive standing is determined by{' '}
          <strong className="text-slate-700">Final Score = max(0, Baseline Score + MD Adjustment)</strong>. Employees with scheduled tasks during the period take priority over unassigned team members, and executive leadership exercises governance through the inline MD Adjustment column.
        </p>
      </div>
    </div>
  );
}

export default ExecutiveScoreboard;
