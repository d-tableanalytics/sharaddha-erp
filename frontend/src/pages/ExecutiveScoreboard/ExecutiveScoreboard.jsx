import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trophy,
  Building2,
  Download,
  Search,
  Target,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { PageHeader } from '../../components/common/PageHeader';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { TableSkeleton } from '../../components/ui/TableSkeleton';
import { scoreboardApi } from '../../services/scoreboard';
import { useUserStore } from '../../store/userStore';
import { useHrmsStore } from '../../store/hrmsStore';

// Medals for top 3
const MEDALS = ['🥇', '🥈', '🥉'];

// The portal's initials chip, as HRMS's EmployeesPage renders it: one flat
// primary disc, no per-person hue and no border.
const AVATAR_CLASS = 'bg-primary-100 text-primary-700';

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
  if (score >= 85) return 'text-success-600 font-semibold';
  if (score >= 70) return 'text-primary-600 font-semibold';
  if (score >= 50) return 'text-warning-600 font-semibold';
  return 'text-error-600 font-semibold';
}

/**
 * KPI Miss Band against 0% benchmark (Lower miss percentage is better)
 */
export function missBand(pct) {
  if (pct === null || pct === undefined) return 'text-slate-400';
  if (pct === 0) return 'text-success-600 font-semibold';
  if (pct <= 15) return 'text-primary-600 font-semibold';
  if (pct <= 30) return 'text-warning-600 font-semibold';
  return 'text-error-600 font-semibold';
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
        className={`${width} h-7 px-2 py-0.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-xs font-semibold tabular-nums text-center outline-none shadow-sm transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500`}
      />
      {isSaving && (
        <Loader2
          size={12}
          className="animate-spin text-primary-700 absolute -right-3.5 top-1/2 -translate-y-1/2"
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

  const rankTheme = isFirst
    ? {
        border: 'border-warning-100/90 hover:border-warning-500',
        bg: 'bg-gradient-to-br from-warning-50/40 via-white to-white',
        badge: 'bg-warning-500 text-white',
        scoreGlow: 'bg-warning-50 text-warning-600 border border-warning-100/60',
      }
    : isSecond
    ? {
        border: 'border-slate-200 hover:border-slate-300',
        bg: 'bg-gradient-to-br from-slate-50/70 via-white to-white',
        badge: 'bg-slate-600 text-white',
        scoreGlow: 'bg-slate-50 text-slate-700 border border-slate-200',
      }
    : {
        border: 'border-warning-100/70 hover:border-warning-100',
        bg: 'bg-gradient-to-br from-warning-50/30 via-white to-white',
        badge: 'bg-warning-600 text-white',
        scoreGlow: 'bg-warning-50 text-warning-600 border border-warning-100/60',
      };

  return (
    <div
      className={`relative flex items-center gap-3.5 p-4 rounded-xl border transition-all duration-200 shadow-enterprise hover:shadow-md ${rankTheme.border} ${rankTheme.bg}`}
    >
      <div className="relative shrink-0">
        <div
          className={`w-12 h-12 rounded-full font-bold text-xs flex items-center justify-center ${AVATAR_CLASS}`}
        >
          {initials}
        </div>
        <span
          className={`absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold flex items-center justify-center border border-white shadow-enterprise ${rankTheme.badge}`}
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
        <div className="text-sm font-semibold text-slate-900 truncate mt-0.5">
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
        className={`text-2xl font-semibold tabular-nums px-3 py-1.5 rounded-lg ${rankTheme.scoreGlow}`}
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
    <div className="flex flex-col gap-6 pb-10">
      {/* ── 1. HEADER & GLOBAL CONTROLS ──────────────────────────────────── */}
      {/*
        The shared PageHeader, as O2D and every HRMS page already use it.

        The “Leadership” chip becomes the `eyebrow` - the slot that exists
        for exactly this - and the period line becomes the `subtitle`, which is
        where a screen says what it is showing. The 40px Trophy tile is dropped:
        no other page in the portal puts an icon beside its title, and the rail
        already carries this page's Trophy.
      */}
      <PageHeader
        eyebrow="Leadership"
        title="Executive Scoreboard"
        subtitle={
          loading && !data ? (
            'Loading…'
          ) : (
            <>
              {periodLabel} of {data?.periodStart} — {data?.periodEnd} ·{' '}
              <span className="font-semibold text-slate-600">
                {data?.totalDoers || 0} doers
              </span>{' '}
              ·{' '}
              <span className="font-semibold text-success-600">
                {data?.activeDoers || 0} active with work
              </span>{' '}
              this {period}
            </>
          )
        }
        actions={
          <>
          {/* Period Selector Pill Group */}
          <div className="bg-slate-100 rounded-lg p-1 border border-slate-200 flex items-center gap-1 shadow-enterprise shrink-0">
            {['week', 'month', 'year'].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                  period === p
                    ? 'bg-primary-600 text-white shadow-enterprise'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Scope Selector Pill Group */}
          <div className="bg-slate-100 rounded-lg p-1 border border-slate-200 flex items-center gap-1 shadow-enterprise shrink-0">
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
                    ? 'bg-primary-600 text-white shadow-enterprise'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>


          {/* Excel Export Button */}
          <Button size="sm" onClick={exportToExcel}>
            <Download size={14} className="mr-2" />
            Export
          </Button>
          </>
        }
      />

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
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by doer name..."
            className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
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
            <div className="text-[11px] font-semibold text-primary-700 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-primary-50 border border-primary-200 shadow-enterprise">
              <Target size={14} className="text-primary-700 shrink-0" />
              <span>
                Set the <strong>{nextLabel}</strong> score goal & MD adjustment inline — rankings recalculate instantly.
              </span>
            </div>
          ) : (
            <div className="text-[11px] font-semibold text-slate-500 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 shadow-enterprise">
              <Info size={14} className="text-slate-400 shrink-0" />
              <span>Score goals and leadership adjustments are set by the CEO/MD.</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 4. KRA/KPI SCOREBOARD GRID TABLE ──────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-enterprise">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-14">
                  Rank
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 min-w-[200px]">
                  Doer Name
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 min-w-[190px]">
                  KRA
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 min-w-[160px]">
                  KPI
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-24">
                  Benchmark
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center min-w-[120px]">
                  Last {periodLabel} Actual %
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center min-w-[110px]">
                  Current {periodLabel} Planned
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center min-w-[100px]">
                  Current {periodLabel} Actual
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center min-w-[120px]">
                  Current {periodLabel} Actual %
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center min-w-[100px]">
                  {nextLabel} Planned
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-center min-w-[120px] bg-primary-50 text-primary-700 border-l border-slate-200">
                  {nextLabel} Score Goal
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-center min-w-[115px] bg-primary-50 text-primary-700 border-l border-slate-200">
                  MD Adjustment
                </th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-center min-w-[105px] bg-primary-50 text-primary-700 border-l border-slate-200">
                  Final Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data ? (
                // The shared placeholder rows, as HrmsDataTable uses them, so a
                // loading table fills in its own shape rather than showing six
                // grey bars that match no column.
                <TableSkeleton rows={6} columns={13} cellClass="px-3 py-2" />
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-0">
                    <EmptyState
                      title="No doers found"
                      description="No scoreboard records match your current filter criteria."
                      icon={<Trophy className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
                      className="border-0 rounded-none py-12"
                    />
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, rIdx) => {
                  const initials = getInitials(r.doer);

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
                            <div className="inline-flex items-center gap-1 justify-center font-semibold text-xs tabular-nums text-slate-900">
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
                                className={`w-8 h-8 rounded-full font-bold text-[11px] flex items-center justify-center shrink-0 ${AVATAR_CLASS}`}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-xs text-slate-900 hover:text-primary-700 transition-colors truncate">
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
                        <td className="px-3.5 py-2.5 text-xs font-semibold text-slate-900">
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
                            className="px-2.5 py-2.5 text-center align-middle bg-primary-600/[0.02] border-l border-slate-100"
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
                            className="px-2.5 py-2.5 text-center align-middle bg-primary-600/[0.02] border-l border-slate-100"
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
                            className={`px-3.5 py-2.5 text-center align-middle bg-primary-600/[0.04] text-base font-semibold tabular-nums border-l border-slate-100 ${band(
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
      <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-enterprise text-slate-600 text-xs space-y-3 leading-relaxed">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0">
            <Info size={14} strokeWidth={2.5} />
          </div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
            Scoring Methodology & Operational Benchmarks
          </h4>
        </div>
        <p className="text-xs font-medium text-slate-500">
          Both Key Result Areas (KRAs) evaluate operational misses against an absolute benchmark of{' '}
          <strong className="text-slate-700">0%</strong>. Lower miss percentages indicate superior velocity and discipline. Baseline individual score is mathematically calculated as:
        </p>
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 w-fit text-xs font-mono font-semibold text-slate-700 shadow-enterprise">
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
