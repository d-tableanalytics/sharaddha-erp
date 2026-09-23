import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { groupModules, permKey } from "./permissionKeys";

/**
 * The (module x action x scope) grid a custom role is built out of.
 *
 * ---------------------------------------------------------------------------
 * ONE CARD PER MODULE FAMILY, NOT ONE WIDE TABLE
 * ---------------------------------------------------------------------------
 * 32 modules x 10 actions x 4 scopes is 1,280 checkboxes. A flat table needs
 * horizontal scrolling at any usable row height, and the thing a matrix is for
 * — running your eye down a column — stops working the moment the row label
 * leaves the screen. Collapsed cards with a "{n}/{total}" badge mean the list
 * still answers "where does this role have grants" at a glance, and only the
 * module being edited is expanded.
 *
 * ---------------------------------------------------------------------------
 * SUB-MODULES SIT UNDER THEIR PARENT
 * ---------------------------------------------------------------------------
 * `employees:compensation`, `helpdesk:it` and `reports:payroll` are separate
 * module keys, not a fourth axis — that is what lets a Payroll Admin see
 * salary-linked data without the whole employee record. Listing them as 11
 * more top-level cards would bury that relationship; grouping them under the
 * parent shows it, while keeping each one its own independently tickable row.
 *
 * They are NOT hierarchical: granting `helpdesk/resolve/org` does not imply
 * `helpdesk:it/resolve/org`, so the group's bulk control ticks each key
 * explicitly rather than implying anything.
 *
 * The vocabulary is a PROP, served by the API from the same constants the
 * evaluator imports. Hardcoding it here is how the reference's builder ended
 * up offering 19 of its 33 modules and 7 of its 10 actions — a role that
 * cannot be given `payroll/run` at all.
 */

const prettify = (key) =>
  key
    .split(":")
    .pop()
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

export function PermissionMatrixGrid({
  modules,
  actions,
  scopes,
  selected,
  onToggle,
  onBulkToggle,
  readOnly = false,
}) {
  const [expanded, setExpanded] = useState(() => ({}));
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupModules(modules), [modules]);

  const keysFor = (mods) =>
    mods.flatMap((m) => actions.flatMap((a) => scopes.map((s) => permKey(m, a, s))));

  /*
   * Filtering, not hiding.
   *
   * A search that narrowed the list without saying so would let an
   * administrator tick four boxes, save, and never see the twenty-eight
   * modules they did not search for — so the count of what is filtered out is
   * always on screen, and the ticks themselves are untouched by the query.
   */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      ([parent, mods]) =>
        parent.toLowerCase().includes(q) || mods.some((m) => m.toLowerCase().includes(q)),
    );
  }, [groups, query]);

  const totalSelected = useMemo(
    () => groups.reduce((n, [, mods]) => n + keysFor(mods).filter((k) => selected.has(k)).length, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, selected, actions, scopes],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter modules…"
            aria-label="Filter modules"
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <p className="text-xs text-slate-500">
          {totalSelected} selected
          {query.trim() && shown.length !== groups.length && (
            <> · showing {shown.length} of {groups.length} modules</>
          )}
        </p>
      </div>

      <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
      {shown.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          No module matches “{query}”.
        </p>
      )}
      {shown.map(([parent, mods]) => {
        const all = keysFor(mods);
        const count = all.filter((k) => selected.has(k)).length;
        const isOpen = Boolean(expanded[parent]);

        return (
          <div key={parent} className="overflow-hidden rounded-lg border border-slate-200">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => setExpanded((prev) => ({ ...prev, [parent]: !prev[parent] }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((prev) => ({ ...prev, [parent]: !prev[parent] }));
                }
              }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-left ${
                count > 0 ? "bg-slate-50" : "bg-white"
              }`}
            >
              <span className="text-slate-400">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>

              <span className="text-sm font-medium text-slate-800">{prettify(parent)}</span>
              {mods.length > 1 && (
                <span className="text-[11px] text-slate-400">
                  +{mods.length - 1} sub-module{mods.length > 2 ? "s" : ""}
                </span>
              )}

              {count > 0 && (
                <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[11px] font-semibold text-primary-700">
                  {count} / {all.length}
                </span>
              )}

              {!readOnly && (
                <button
                  type="button"
                  onClick={(e) => {
                    // Without this the bulk control would also collapse the card
                    // it just filled in.
                    e.stopPropagation();
                    onBulkToggle(all, count < all.length);
                  }}
                  className="ml-auto text-xs font-semibold text-primary-700 hover:underline"
                >
                  {count === all.length ? "Clear all" : count > 0 ? "Select all" : "Grant all"}
                </button>
              )}
            </div>

            {isOpen && (
              <div className="border-t border-slate-200 bg-slate-50/50 px-3 py-2">
                {mods.map((module) => (
                  <ModuleRows
                    key={module}
                    module={module}
                    showLabel={mods.length > 1}
                    actions={actions}
                    scopes={scopes}
                    selected={selected}
                    onToggle={onToggle}
                    onBulkToggle={onBulkToggle}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

function ModuleRows({
  module,
  showLabel,
  actions,
  scopes,
  selected,
  onToggle,
  onBulkToggle,
  readOnly,
}) {
  return (
    <div className="mb-2 last:mb-0">
      {showLabel && (
        <p className="py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {module}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
            <th scope="col" className="w-28 py-1 font-medium">Action</th>
            {scopes.map((s) => (
              <th key={s} scope="col" className="py-1 text-center font-medium">
                {s}
              </th>
            ))}
            <th scope="col" className="w-12 py-1 text-center font-medium">Row</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => {
            const rowKeys = scopes.map((s) => permKey(module, action, s));
            const rowAll = rowKeys.every((k) => selected.has(k));

            return (
              <tr key={action} className="border-t border-dashed border-slate-200">
                <td className="py-1 text-[13px] text-slate-600">{action}</td>

                {scopes.map((scope) => {
                  const key = permKey(module, action, scope);
                  return (
                    <td key={scope} className="py-1 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        disabled={readOnly}
                        onChange={() => onToggle(module, action, scope)}
                        aria-label={`${action} ${module} at ${scope} scope`}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-primary-600 focus:ring-primary-500 disabled:cursor-default"
                      />
                    </td>
                  );
                })}

                <td className="py-1 text-center">
                  <input
                    type="checkbox"
                    checked={rowAll}
                    disabled={readOnly}
                    onChange={() => onBulkToggle(rowKeys, !rowAll)}
                    aria-label={`${action} ${module} at every scope`}
                    className="h-4 w-4 cursor-pointer rounded border-slate-300 text-primary-600 focus:ring-primary-500 disabled:cursor-default"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default PermissionMatrixGrid;
