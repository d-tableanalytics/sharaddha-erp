import { Badge } from "../../components/ui/Badge";
import {
  STAGE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  BUCKET_LABELS,
  stageTone,
  bucketTone,
  formatDateTime,
  formatDelay,
} from "../../services/o2d/orders";
import { STAGE_STATUS, TERMINAL_STAGE_STATUSES } from "@shared/constants/o2d.js";

/**
 * Presentation shared by the O2D screens.
 *
 * Kept beside the pages rather than in `components/`, the way each HRMS module
 * keeps its `<module>Shared.jsx`: these know about stages and SLAs and are not
 * reusable outside O2D, and promoting them to the shared component folder would
 * invite somebody to make them general and break both callers.
 */

/** Unknown statuses render their raw value rather than vanishing. */
export const StageBadge = ({ status, className }) => (
  <Badge variant={stageTone(status)} className={className}>
    {STAGE_STATUS_LABELS[status] ?? status ?? "Unknown"}
  </Badge>
);

export const OrderStatusBadge = ({ status, className }) => (
  <Badge
    variant={
      { OPEN: "primary", ON_HOLD: "warning", CLOSED: "success", CANCELLED: "danger", VOID: "neutral" }[
        status
      ] ?? "neutral"
    }
    className={className}
  >
    {ORDER_STATUS_LABELS[status] ?? status ?? "Unknown"}
  </Badge>
);

export const BucketBadge = ({ bucket, className }) => (
  <Badge variant={bucketTone(bucket)} className={className}>
    {BUCKET_LABELS[bucket] ?? bucket}
  </Badge>
);

/**
 * The twelve stages as a vertical timeline — the heart of Order 360 (§22).
 *
 * Renders EVERY stage, including the ones still locked, because "where is this
 * order and what is left" is the question the screen exists to answer, and a
 * list that shows only what has happened answers half of it.
 *
 * Three things are deliberately shown that a simpler stepper would drop:
 *
 *   the DEADLINE on an open stage, so the next action has a time attached;
 *   the DELAY on a late one, because "done" and "done four hours late" are
 *     different facts and the SLA engine exists to tell them apart;
 *   the REASON on a skipped one, since a skip with no reason is
 *     indistinguishable on screen from work that was never done.
 */
export function StageTimeline({ stages = [], currentStage, onAct, actionableStages = [] }) {
  if (stages.length === 0) {
    return <p className="text-sm text-slate-500">No stages recorded for this order.</p>;
  }

  return (
    <ol className="relative space-y-0" aria-label="Order progress">
      {stages.map((stage, index) => {
        const done = TERMINAL_STAGE_STATUSES.includes(stage.status);
        const isCurrent = stage.stageNumber === currentStage;
        const skipped = stage.status === STAGE_STATUS.SKIPPED;
        const canAct = actionableStages.includes(stage.stageNumber) && isCurrent;
        const last = index === stages.length - 1;

        return (
          <li key={stage.stageNumber} className="relative flex gap-3 pb-5">
            {/* The connector, drawn between dots rather than under the last. */}
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute left-[11px] top-6 bottom-0 w-px ${
                  done ? "bg-primary-300" : "bg-slate-200"
                }`}
              />
            )}

            <span
              aria-hidden="true"
              className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                skipped
                  ? "border-slate-300 bg-slate-100 text-slate-400"
                  : done
                    ? "border-primary-600 bg-primary-600 text-white"
                    : isCurrent
                      ? "border-primary-600 bg-white text-primary-700"
                      : "border-slate-300 bg-white text-slate-400"
              }`}
            >
              {stage.stageNumber}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-sm font-medium ${
                    skipped ? "text-slate-400 line-through" : "text-slate-900"
                  }`}
                >
                  {stage.stageName}
                </span>
                <StageBadge status={stage.status} />
                {stage.overridden && (
                  <Badge variant="warning" title={stage.overrideReason ?? undefined}>
                    Out of order
                  </Badge>
                )}
              </div>

              <p className="mt-0.5 text-xs text-slate-500">{stage.ownerRole}</p>

              <dl className="mt-1 space-y-0.5 text-xs text-slate-600">
                {done && !skipped && (
                  <div className="flex gap-1.5">
                    <dt className="text-slate-400">Completed</dt>
                    <dd>
                      {formatDateTime(stage.actualCompletion)}
                      {stage.completedByName ? ` · ${stage.completedByName}` : ""}
                      {stage.delayMinutes > 0 && (
                        <span className="ml-1 text-amber-700">({formatDelay(stage.delayMinutes)})</span>
                      )}
                    </dd>
                  </div>
                )}

                {skipped && stage.skipReason && (
                  <div className="flex gap-1.5">
                    <dt className="text-slate-400">Skipped</dt>
                    <dd className="italic">{stage.skipReason}</dd>
                  </div>
                )}

                {!done && stage.plannedCompletion && (
                  <div className="flex gap-1.5">
                    <dt className="text-slate-400">Due</dt>
                    <dd>{formatDateTime(stage.plannedCompletion)}</dd>
                  </div>
                )}

                {/*
                  Back-fill, surfaced rather than hidden. The two timestamps are
                  equal on an ordinary completion, so this line appears only when
                  the work was recorded after the fact.
                */}
                {done
                  && stage.recordedAt
                  && stage.actualCompletion
                  && new Date(stage.recordedAt).getTime() !== new Date(stage.actualCompletion).getTime() && (
                    <div className="flex gap-1.5">
                      <dt className="text-slate-400">Recorded</dt>
                      <dd className="text-slate-500">{formatDateTime(stage.recordedAt)} (back-filled)</dd>
                    </div>
                  )}
              </dl>

              {canAct && onAct && (
                <button
                  type="button"
                  onClick={() => onAct(stage)}
                  className="mt-2 rounded-md bg-primary-600 px-3 py-1 text-xs font-medium text-white hover:bg-primary-700"
                >
                  Complete this stage
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A label/value pair, for the detail cards. */
export const Field = ({ label, children, className = "" }) => (
  <div className={className}>
    <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-900">{children ?? "—"}</dd>
  </div>
);

export const Section = ({ title, actions, children }) => (
  <section className="rounded-lg border border-slate-200 bg-white p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {actions}
    </div>
    {children}
  </section>
);

export default { StageBadge, OrderStatusBadge, BucketBadge, StageTimeline, Field, Section };
