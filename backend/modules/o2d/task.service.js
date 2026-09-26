/**
 * My Tasks — the queue an employee actually works from (§14).
 *
 * ---------------------------------------------------------------------------
 * WHOSE TASK IS IT? — AND A ROLE DISTINCTION THE BRIEF MAKES DELIBERATELY
 * ---------------------------------------------------------------------------
 *
 * A stage names up to three kinds of role, and they are not interchangeable:
 *
 *   ownerRole        who is ACCOUNTABLE. The KPI is attributed here.
 *   completedByRole  who records the ACTUAL, when that is somebody else. §5 and
 *                    §10 both insist on this: Billing acknowledges the stage-2
 *                    handover, the WAREHOUSE acknowledges the stage-7 picking
 *                    request. Crediting the pusher would record work as done at
 *                    the moment it was requested rather than received.
 *   alsoAllowedRoles who may also act — cover, seniors, admins.
 *
 * So "who can close this" and "whose number is it" are different questions, and
 * this module answers both rather than collapsing them:
 *
 *   ACTIONABLE  the caller may complete the stage now. That is
 *               `completedByRole` when the stage names one, otherwise
 *               `ownerRole` — plus `alsoAllowedRoles`, plus the unrestricted.
 *   WATCHING    the caller is the owner but somebody else must record it. Stage
 *               2 for Sales: they have to send the PO, and Billing closes it.
 *
 * ⚠ AMBIGUITY, FLAGGED RATHER THAN DECIDED SILENTLY. The brief does not say
 * whether the owner of a stage with a separate `completedByRole` should see it
 * in their own task list. Hiding it would mean a salesperson has no screen
 * telling them a PO is waiting to be handed over; showing it as actionable
 * would let them close a stage the brief says Billing closes. This returns it
 * as a WATCHING row — visible, not closeable — which loses no information
 * either way. If the business wants stage 2 to vanish from the Sales queue once
 * sent, that is a one-line change to `visibilityFilter` below.
 */

import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';
import {
  STAGE_STATUS, TERMINAL_STAGE_STATUSES, ORDER_STATUS,
  STAGE_DISPLAY_STATUS, displayStatusFor,
} from '../../shared/constants/o2d.js';
import { bucketFor } from './order.service.js';

/** Statuses that mean the stage is live work — everything that is not finished. */
const STAGE_STATUS_WORKABLE = Object.freeze([
  STAGE_STATUS.PENDING,
  STAGE_STATUS.DUE_SOON,
  STAGE_STATUS.OVERDUE,
]);

/**
 * The stage numbers a role may CLOSE, and those it merely owns.
 *
 * Read from the stage master rather than a constant, because §37 lets an
 * administrator reassign a stage's owner without a deploy — and a hardcoded map
 * here would keep routing tasks to the old role while the master said otherwise.
 */
export async function roleStageMap(role) {
  const masters = await O2dStageMaster.find({ enabled: true })
    .select('stageNumber ownerRole alsoAllowedRoles completedByRole skippable')
    .lean();

  const actionable = [];
  const watching = [];
  // Stages this role may act on as cover/senior rather than as the team doing
  // the work — they see those stages even when a named person holds them.
  const supervising = [];

  for (const m of masters) {
    const closer = m.completedByRole || m.ownerRole;
    const allowed = [closer, ...(m.alsoAllowedRoles ?? [])];

    if (allowed.includes(role)) actionable.push(m.stageNumber);
    // Owner, but not the one who records it — see the note above.
    else if (m.ownerRole === role) watching.push(m.stageNumber);

    if (role !== closer && role !== m.ownerRole && (m.alsoAllowedRoles ?? []).includes(role)) {
      supervising.push(m.stageNumber);
    }
  }

  return { actionable, watching, supervising, masters };
}

/**
 * The stages this caller should see.
 *
 * A Super Admin holds the wildcard and sees everything — the same rule every
 * other permission check in the portal follows, rather than a special case that
 * would leave the most privileged account with an empty task list.
 */
async function visibilityFilter(user) {
  if (isSuperAdmin(user)) {
    /**
     * ⚠ `actionable: null` used to answer here, and it broke a real screen.
     *
     * `null` is exactly right for the FILTER built below — `vis.all` already
     * lets every stage number through, so nothing there ever reads
     * `vis.actionable`. But `myTasks()` also hands `actionable` back at the
     * TOP LEVEL, because `OrderDrawer.jsx` asks it "which of this order's
     * stages may I close right now?" rather than duplicating O2D's role→stage
     * mapping in the browser (see the comment at the top of that file — a
     * copy of the mapping there would go stale the moment an administrator
     * edits it, per §37).
     *
     * `null` answered that question with nothing. The drawer's `tasks?.
     * actionable ?? []` cannot tell "everything" from "nothing" apart in a
     * `null`, so it read as "nothing" — an Admin or Super Admin could open any
     * order and find no Complete button anywhere, on a screen the permission
     * layer had already let them onto.
     *
     * Every ENABLED stage, not a hardcoded count or the caller's own role
     * lookup — an org-level grant is not necessarily one of the roles any
     * stage master happens to name in `alsoAllowedRoles` (a custom role
     * marked `['*']` per the note on `isSuperAdmin` is exactly this case), so
     * this cannot piggy-back on `roleStageMap` the way the branch below does.
     */
    const allStageNumbers = await O2dStageMaster.distinct('stageNumber', { enabled: true });
    return { all: true, actionable: allStageNumbers, watching: [], supervising: allStageNumbers };
  }
  const { actionable, watching, supervising } = await roleStageMap(user?.role);
  return { all: false, actionable, watching, supervising };
}

/**
 * My Tasks.
 *
 * Only NON-TERMINAL stages, and only on live orders. A stage on a cancelled
 * order is not work, and an order on hold is explicitly not the assignee's
 * problem — §19 freezes its SLA, and leaving it in the queue would have people
 * chasing orders they have been told to stop working.
 */
export async function myTasks(user, query = {}) {
  const {
    page = 1, pageSize = 50, status, stageNumber, bucket, search,
    sortBy = 'plannedCompletion', sortDir = 'asc',
    /**
     * Which rows to return.
     *
     *   open       only what is still owed — the classic to-do list
     *   completed  only what this role has already closed
     *   all        both, open work first (the default)
     *
     * `all` is the default because a stage the caller has finished is the
     * evidence that they finished it: an order that simply VANISHES from the
     * queue on completion gives them no way to confirm the click registered,
     * and no way to answer "did I already do this one?" without opening the
     * tracker. Keeping the row, marked Done, is the visibility this exists for.
     */
    view = 'all',
  } = query;

  const vis = await visibilityFilter(user);
  const mine = vis.all ? null : [...vis.actionable, ...vis.watching];
  /**
   * A stage personally assigned to THIS user is theirs to see regardless of
   * role — see `canWorkStage`. Without this, somebody handed a stage their
   * role does not normally own could complete it (that permission is already
   * correct) but would never find it in their own My Tasks to DO so, which is
   * the one screen this whole feature exists to make work.
   */
  const myUserId = user?._id ? String(user._id) : null;

  if (!vis.all && (!mine || mine.length === 0) && !myUserId) {
    return { data: [], total: 0, page, pageSize, actionable: [], watching: [] };
  }

  // Live orders only. Resolved first so the stage query stays a single indexed
  // read rather than a lookup per row. An order ON_HOLD is deliberately absent:
  // §19 freezes its SLA, and leaving it here would have people chasing work they
  // have been told to stop.
  const liveOrderIds = await O2dOrder.distinct('_id', { status: ORDER_STATUS.OPEN });

  const filter = { order: { $in: liveOrderIds } };

  /**
   * WHICH STAGES COUNT AS THIS PERSON'S ROWS.
   *
   * A LOCKED stage is not yet work — it is waiting on a predecessor, and
   * showing it would make My Tasks a copy of the tracker. ON_HOLD is absent for
   * the reason §19 exists: the SLA is frozen and people must not be chasing
   * work they have been told to stop.
   *
   * TERMINAL statuses used to be excluded alongside them, which is what made a
   * task disappear the instant it was closed. They are now INCLUDED — an order
   * stays visible in every stage it has passed through, marked Done — and the
   * `view` parameter decides whether the caller wants them right now.
   */
  const neverWork = [STAGE_STATUS.LOCKED, STAGE_STATUS.ON_HOLD];
  const openStatuses = STAGE_STATUS_WORKABLE.filter((x) => !neverWork.includes(x));

  const allowedByView =
    view === 'open' ? openStatuses
      : view === 'completed' ? [...TERMINAL_STAGE_STATUSES]
        : [...openStatuses, ...TERMINAL_STAGE_STATUSES];

  filter.status = status?.length
    // An explicit status filter NARROWS the view; it cannot widen it past what
    // the view allows, or `?status=LOCKED` would reintroduce the tracker.
    ? { $in: status.filter((x) => allowedByView.includes(x)) }
    : { $in: allowedByView };

  /**
   * WHICH ROWS ARE "MINE" — and, just as importantly, which are somebody
   * else's.
   *
   * Two ways in, and only two:
   *
   *   MY ROLE, NOBODY NAMED    the role queue. Stage 3 is Billing's, no
   *                            individual has been put on this one, so it sits
   *                            in every Billing user's list until one of them
   *                            takes it.
   *   NAMED ME                 the assignment. Visible on a stage number my
   *                            ROLE may not hold at all — that is the entire
   *                            point of naming somebody — so it has to stay a
   *                            separate branch rather than fold into the list
   *                            of allowed numbers.
   *
   * ⚠ WHAT CHANGED, AND WHY IT IS THE POINT OF THE SCREEN.
   *
   * The role branch used to match a stage whatever its `assignedTo`, so naming
   * one person ADDED the task to their list without removing it from anyone
   * else's: five Billing users all kept "Send SOR + PI — PO-4471" in My Tasks
   * after it had been handed to exactly one of them. A to-do list that shows
   * four people work that is demonstrably not theirs is a list people stop
   * reading, and it made the two Work Queue screens disagree — the mirror only
   * ever existed for the ONE person named, so the Work Queue showed it to one
   * user and My Tasks to five.
   *
   * Naming somebody now MOVES the task rather than copying it. Note that this
   * is a VISIBILITY rule only: `canWorkStage` is untouched, so a colleague or a
   * manager covering for an absent assignee can still complete the stage — from
   * Order Tracker, which is the all-orders screen and still shows everything.
   * Nothing becomes unreachable; it stops being mistaken for your own to-do.
   */
  const notSomebodyElses = myUserId
    // `assignedTo: null` matches a MISSING field too, which is what an
    // unassigned stage actually looks like on disk.
    ? [{ assignedTo: null }, { assignedTo: myUserId }]
    : [{ assignedTo: null }];

  if (vis.all) {
    /*
     * Admins see every stage on a live order, including ones named to somebody
     * else: when an assignee is absent it is the admin who has to pick the work
     * up, and it has to be on their list to do so. Peers of the same role still
     * lose a stage from their queue once somebody is named — see above.
     */
  } else {
    const branches = [];
    if (mine && mine.length > 0) {
      branches.push({ stageNumber: { $in: mine }, $or: notSomebodyElses });
    }
    // Cover/senior roles (a stage's `alsoAllowedRoles` other than the team that
    // does it) see the stage whoever holds it, for the same reason as admins.
    if (vis.supervising.length > 0) branches.push({ stageNumber: { $in: vis.supervising } });
    if (myUserId) branches.push({ assignedTo: myUserId });
    // Both empty only when neither role nor assignment grants anything, which
    // the early return above already caught — reaching here with an empty
    // array would mean "match nothing", so this is a safety net, not the path.
    filter.$or = branches.length > 0 ? branches : [{ _id: null }];
  }

  // An explicit `?stageNumber=` NARROWS whatever the caller may already see; it
  // never widens it. Layered as an ordinary AND alongside `$or` above — it
  // never replaces the visibility check, or `?stageNumber=9` would turn My
  // Tasks into "any task" for anyone who guessed a number.
  if (stageNumber) filter.stageNumber = Number(stageNumber);

  const rows = await O2dOrderStage.find(filter)
    .sort({ [sortBy === 'poDate' ? 'plannedCompletion' : sortBy]: sortDir === 'desc' ? -1 : 1 })
    .lean();

  // The order header, for the PO number and customer every row displays.
  const orderIds = [...new Set(rows.map((r) => String(r.order)))];
  const orders = await O2dOrder.find({ _id: { $in: orderIds } })
    .select('poNumber poDate customerName promiseDate currentStage status')
    .lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));

  const now = new Date();
  let enriched = rows.map((stage) => {
    const order = byId.get(String(stage.order)) ?? null;
    return {
      ...stage,
      order,
      bucket: bucketFor(stage, now),
      // The flag the UI needs to decide between a "Complete" button and a
      // "waiting on Billing" label. A finished stage is never actionable,
      // whatever the caller's role — otherwise a retained row would offer a
      // Complete button for work already done. Personal assignment grants it
      // exactly like `canWorkStage` does, for the same reason.
      //
      // `Boolean(...)` on the last branch is load-bearing, not decoration:
      // `null && x` evaluates to `null`, not `false`, and without it a caller
      // with no `myUserId` (a system actor, a test double) could turn this
      // whole field into `null` instead of `false` the moment the first two
      // branches were also false.
      actionable:
        !TERMINAL_STAGE_STATUSES.includes(stage.status)
        && (vis.all
          || vis.actionable.includes(stage.stageNumber)
          || Boolean(myUserId && String(stage.assignedTo ?? '') === myUserId)),
      /** True for a row retained as history rather than offered as work. */
      completed: TERMINAL_STAGE_STATUSES.includes(stage.status),
      /** Named to another person; shown to an admin/cover role so they can step in. */
      assignedToOther: Boolean(stage.assignedTo) && String(stage.assignedTo) !== myUserId,
      /** In Progress / Done — the two-state name the screens show. */
      displayStatus: displayStatusFor(stage.status),
    };
  });

  if (search) {
    const needle = String(search).toLowerCase();
    enriched = enriched.filter(
      (r) =>
        r.order?.poNumber?.toLowerCase().includes(needle)
        || r.order?.customerName?.toLowerCase().includes(needle),
    );
  }
  if (bucket) enriched = enriched.filter((r) => r.bucket === bucket);

  /**
   * Open work first, finished work after it.
   *
   * The database sort is by deadline, which is right within each group and
   * wrong across them: a stage completed last week has a deadline older than
   * anything still open, so a single ordering would bury today's three to-dos
   * under a hundred rows of history. Retaining the history must not cost the
   * queue its job.
   *
   * Within the finished group, most recently completed leads — "what did I just
   * do" is the question a retained row answers.
   */
  enriched.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.completed) {
      return new Date(b.actualCompletion ?? 0) - new Date(a.actualCompletion ?? 0);
    }
    return 0; // already in deadline order from the query
  });

  const total = enriched.length;
  const openCount = enriched.filter((r) => !r.completed).length;
  const start = (page - 1) * pageSize;

  return {
    data: enriched.slice(start, start + pageSize),
    total,
    // Counted separately so a screen can say "3 to do - 128 completed" without
    // a second request, and so a badge can never quote the combined number.
    openCount,
    completedCount: total - openCount,
    page,
    pageSize,
    actionable: vis.actionable,
    watching: vis.watching,
  };
}

/**
 * The three counts the task screen shows above the list.
 *
 * Computed over the caller's whole queue, not the current page — a badge saying
 * "2 overdue" because only two were on this page would be worse than no badge.
 */
export async function myTaskCounts(user) {
  /**
   * OPEN work only.
   *
   * These drive the badge above the list, and a badge counts work to be done.
   * Now that finished stages are retained as history, counting the whole queue
   * would show a warehouse user "412 tasks" when three are actually theirs to
   * do — which is how a badge stops being read at all.
   */
  // Asked for BOTH and split here, rather than querying `view: 'open'` — that
  // would make `completedCount` zero by construction, which is a count nobody
  // could act on and exactly the bug this comment replaces.
  const { data, completedCount } = await myTasks(user, {
    page: 1, pageSize: 10_000, view: 'all',
  });
  const open = data.filter((r) => !r.completed);

  return {
    /** Reported so a screen can offer "128 completed" without a second call. */
    completed: completedCount,
    total: open.length,
    overdue: open.filter((r) => r.bucket === 'overdue').length,
    dueSoon: open.filter((r) => r.bucket === 'due_soon').length,
    onTrack: open.filter((r) => r.bucket === 'on_track').length,
    actionable: open.filter((r) => r.actionable).length,
  };
}

/**
 * May this user complete this particular stage?
 *
 * The authorisation the routes cannot express. `WORK_O2D_STAGE` says the caller
 * works O2D stages at all; it cannot say WHICH, because that mapping lives in
 * the stage master and an administrator can change it (§37). Without this check
 * anyone holding the permission could close anyone else's stage.
 *
 * ---------------------------------------------------------------------------
 * `assignedTo` — THE ONE OTHER DOOR IN
 * ---------------------------------------------------------------------------
 * A stage can also be handed to one named person on top of its role (see
 * `o2dDelegationSync.service.js`), and that assignment IS the grant for that
 * one stage instance — the entire point of naming somebody rather than leaving
 * it to the role queue. This is the single place that answer lives, so it
 * cannot drift between "can I complete it from Order Tracker", "can I complete
 * it from my Work Queue" and "does it show up in My Tasks at all" — all three
 * call this same function.
 *
 * `assignedTo` is OPTIONAL and caller-supplied because this function has no
 * order context of its own — a stage NUMBER is not a stage INSTANCE, and only
 * the caller holding the actual row knows who it is assigned to.
 */
export async function canWorkStage(user, stageNumber, { assignedTo } = {}) {
  if (isSuperAdmin(user)) return true;
  if (assignedTo && user?._id && String(assignedTo) === String(user._id)) return true;
  const { actionable } = await roleStageMap(user?.role);
  return actionable.includes(Number(stageNumber));
}

export default { myTasks, myTaskCounts, canWorkStage, roleStageMap };
