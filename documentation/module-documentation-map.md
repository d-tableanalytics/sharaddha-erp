# Employee Portal: module documentation map

Generated from the module audit. Every screen with its route, its verified connections and impacts, and the code each statement was read from. Items marked **UNVERIFIED** could not be confirmed from the code.

## Home and Work Queue

### Home dashboard (`work_queue.home`)

Routes: `/`, `/dashboard`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Tasks (My Work / Delegation) | one-way | Your own open tasks, and tasks you assigned that wait for verification | Page load | frontend/src/pages/Home/homeSources.js:HOME_SOURCES myWork, myWorkMetrics |
| Checklist & Routines | one-way | Due-today, overdue and compliance counts | Page load | frontend/src/pages/Home/homeSources.js checklist source -> checklistApi.getSummary; backend/modules/checklist/checklist.controller.js getSummary |
| Executive Scoreboard | one-way | This week's rows, average final score, top 3 | Page load | frontend/src/pages/Home/homeSources.js scoreboardMetrics |
| Activity Log | one-way | Latest 6 activity entries | Page load | frontend/src/pages/Home/homeSources.js activity source |
| FMS / O2D (My Order Stages, Order Tracker) | one-way | Task counts, analytics summary, SLA on-time % | Page load | frontend/src/pages/Home/homeSources.js o2dTasks, o2dOrders |
| HRMS (Dashboard, Inbox, Attendance, Leave, Academy, Performance, Hiring) | one-way | Widgets, summary, unread inbox, today's punch, leave balances, learning, goals/reviews, requisitions/interviews | Page load | frontend/src/pages/Home/homeSources.js HRMS sources |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Opening the Home page | Nothing is changed. The page only reads from each module; every module still checks access on its own. | historical | frontend/src/pages/Home/homeSources.js header comment; all sources are GET calls |

Rules:

- **Cards follow your access**: A card is requested only if you could open the matching screen. Hiding a card is display only; the server still checks every request. _(frontend/src/pages/Home/homeSources.js visibleSources)_
- **No access at all**: If no card or admin shortcut applies, the page says 'No Employee Portal access'. Administrators still see a Roles & Permissions link. _(frontend/src/components/layout/HomeRoute.jsx, frontend/src/pages/Home/homeAccess.js)_
- **Clock-in reminder**: Shown only if you can clock in, have not, and today is not a Sunday or a listed company holiday. _(frontend/src/pages/Home/homeSources.js buildAttention)_
- **Overdue means the same everywhere**: Overdue tasks use the same rule as the task lists, so Home never calls a task late when the list does not. _(frontend/src/pages/Home/homeSources.js uses Delegation/taskOverdue.js isTaskOverdue)_

### My Work (`work_queue.tasks`)

Routes: `/work-queue`, `/work-queue/:taskId`, `/my-work`, `/my-work/:taskId`, `/my-tasks/:taskId`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Checklist & Routines | two-way | Your occurrences plus open order-stage team tasks for your role | Page load; completing an item from My Work | frontend/src/pages/MyDay/MyDay.jsx:217,568; backend/modules/checklist/checklist.controller.js visibilityScope |
| FMS / O2D Order Tracker | two-way | Stage task (order, stage number, PO number, deadline); completion runs the real stage completion | Stage becomes active/assigned/completed/held in O2D; completing the task here | backend/modules/o2d/stageMirror.service.js ensureStageTask; backend/modules/delegation/delegation.controller.js updateDelegation/verifyAndComplete -> completeMirroredTask |
| Executive Scoreboard | one-way | Due date, status, completion date | Scoreboard reads tasks when opened | backend/modules/scoreboard/scoreboard.controller.js getScoreboard |
| Activity Log | one-way | Created, status change, subtask, remark, date revision, deleted, restored | Each task action | backend/modules/delegation/delegation.controller.js logActivity calls |
| HRMS Leave & Attendance | one-way | Approved full-day leave, attendance marks, employee status, holidays | Buddy rotation job every 15 minutes | backend/modules/workqueue/availability.service.js |
| HRMS Inbox | one-way | Inbox notification | Buddy rotation or manual override | backend/modules/workqueue/buddy.service.js rotateRow notifyUsers; delegation.controller.js:747 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Submitting a task for verification | Status becomes Awaiting Verification; it appears in the assigner's 'To verify' count on Home and on Delegation. | automatic | frontend/src/pages/Home/homeSources.js toVerify; delegation.controller.js applyStatus |
| Completing an order-stage task | The O2D stage is completed with its evidence and SLA, and Order Tracker shows it done. | multi | backend/modules/delegation/delegation.controller.js:502, completeMirroredTask |
| Deleting a task | The task is hidden from all lists and moved to Deleted Tasks. It can be restored. | manual | backend/modules/delegation/delegation.controller.js deleteDelegation (soft delete) |
| Order put on hold or cancelled in O2D | Its stage task is parked and drops out of My Work, keeping its status. | automatic | backend/models/Delegation.js heldAt; delegation.controller.js getDelegations myWork filter |

Rules:

- **Statuses**: Pending → In Progress → Awaiting Verification → Completed, or Need Revision. 'Reassigned' is set only by the system when an order stage moves to someone else. _(backend/models/Delegation.js status enum; delegation.controller.js SETTABLE_STATUSES)_
- **No self-verification**: If a task needs verification, the doer cannot mark it Completed; the assigner or a manager verifies it. _(backend/modules/delegation/delegation.controller.js updateDelegation, verifyAndComplete)_
- **Evidence required**: A task marked 'evidence required' cannot be submitted or completed without a link or notes. _(delegation.controller.js EVIDENCE_REQUIRED)_
- **Who may act on a task**: The assigner or a manager (Super Admin, Admin, Management, HR) may edit, verify, move the due date or delete. The doer only moves the work forward. In-loop people and buddy backups can read and remark. _(backend/modules/delegation/delegation.controller.js relationTo, ADMIN_ROLES)_
- **Permissions**: View, create, edit, assign, complete and delete are separate permissions. All are held by Sales, Billing, Accounts, Billing Head, Warehouse User and Management; Admin and Super Admin hold everything. _(backend/config/permissions.js WORK_QUEUE_DOER; backend/modules/delegation/delegation.routes.js)_
- **Order-stage tasks are locked**: Their title and due date come from the order stage. They cannot be deleted here, cannot use a buddy chain and are skipped by bulk actions. Unassign the stage in Order Tracker instead. _(delegation.controller.js deleteDelegation O2D_MIRROR_NOT_DELETABLE, bulkUpdateStatus, updateDelegation:586)_
- **Buddy rotation**: A buddy task goes each office day to the first person in its chain who is available. A job runs every 15 minutes (on by default) and at server start. Company holidays are skipped. _(backend/server.js BUDDY_CRON_SCHEDULE '*/15 * * * *'; backend/modules/workqueue/buddy.service.js)_
- **Held order stages are hidden**: Tasks for orders on hold, cancelled or voided drop out of My Work until the order resumes. _(backend/modules/delegation/delegation.controller.js getDelegations myWork heldAt)_

Requires verification:

- The 'Group' tab filters tasks that carry a group id, but the task record has no group field; requires verification whether this tab ever shows anything.
- Tasks have a 'recurrence' setting, but no code was found that creates the next occurrence; requires verification whether recurring delegated tasks repeat.
- No email, WhatsApp or inbox message is sent to the doer when a normal task is created; only buddy hand-overs and manual overrides send inbox notifications. Confirm this is intended.

### Delegation (`work_queue.tasks.delegation`)

Routes: `/wq/delegation`, `/wq/delegation/:taskId`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| My Work | two-way | The task | Task creation and status changes | backend/modules/delegation/delegation.controller.js getDelegations myWork |
| HRMS Leave & Attendance | one-way | Approved leave, attendance marks, employee status, holidays | Buddy job every 15 min; right after creation | backend/modules/workqueue/availability.service.js; delegation.controller.js createDelegation runBuddySweep |
| HRMS Inbox | one-way | 'You have been automatically assigned…', 'No one is available…' (to the assigner) | Buddy job or manual override | backend/modules/workqueue/buddy.service.js rotateRow |
| Audit Log (system) | one-way | Backup activated, primary restored, no assignee, manual override, rotation resumed | Buddy job or override | buddy.service.js recordSystemAudit; delegation.controller.js recordAudit |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Creating a task | It appears in the doer's My Work and in the Activity Log as 'task created'. | automatic | delegation.controller.js createDelegation logActivity task_created |
| Primary in a buddy chain is on full-day leave | Within 15 minutes the next available backup gets the task and an inbox message. Next office day it returns to the primary if available. | automatic | backend/modules/workqueue/buddy.service.js header rules, pickAssignee |
| Nobody in the chain is available | The task stays with its last doer, is flagged, and the assigner gets one inbox message. | automatic | buddy.service.js rotateRow no_assignee |

Rules:

- **Creating needs two permissions**: Create and Task Assignment, since creating also picks the doer. _(backend/modules/delegation/delegation.routes.js POST / canCreate, canAssign)_
- **Who counts as available**: Active login, employee in a working status, no approved full-day leave, and no absent / on leave / weekly off / holiday mark. Half-day leave still counts as available. 'Not checked in' counts as away only if a cut-off time is configured. _(backend/modules/workqueue/availability.service.js availabilityOn)_
- **Within a day the holder keeps it**: If the primary comes back mid-day, the backup keeps the task until the next day. _(buddy.service.js pickAssignee sameDay)_
- **Chain size**: Primary plus 1 to 5 backups. _(backend/models/workQueueBuddy.js BUDDY_CHAIN_MIN/MAX)_
- **Default list**: Shows tasks you assigned. Managers can view all. _(delegation.controller.js getDelegations assignerId filter)_

### Loop Tasks (`work_queue.tasks.in_loop`)

Routes: `/in-loop-tasks`, `/in-loop-tasks/:taskId`, `/wq/looptasks`, `/wq/looptasks/:taskId`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Delegation | one-way | In-loop people list on the task | Task create/edit | backend/models/Delegation.js inLoop; delegation.controller.js getDelegations scope inLoop |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Posting a remark | The remark is added to the task and to the Activity Log. | automatic | delegation.controller.js addRemark logActivity |

Rules:

- **Read and remark only**: Being in loop lets you read and remark. You cannot change, verify or complete the task. _(delegation.controller.js relationTo 'sees')_
- **Managers can look at another person's loop list**: Managers may pass another user to see that person's in-loop tasks. _(delegation.controller.js getDelegations inLoopUserId)_

### All Tasks (`work_queue.tasks.all`)

Routes: `/all-tasks`, `/all-tasks/:taskId`, `/wq/alltasks`, `/wq/alltasks/:taskId`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Delegation | two-way | Delegated tasks | Page load; edits | frontend/src/pages/AllTasks/AllTasks.jsx:312; backend/modules/delegation/delegation.controller.js getDelegations |
| Deleted Tasks | one-way | Deleted flag, who and when | Delete / bulk delete | delegation.controller.js deleteDelegation, bulkDeleteDelegations |
| Activity Log | one-way | Status changes, deletes | Task actions | delegation.controller.js logActivity |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Bulk status change | Changes status on the selected tasks you own. Order-stage tasks are skipped and reported. | manual | delegation.controller.js bulkUpdateStatus |
| Bulk delete | Selected tasks you own move to Deleted Tasks. Order-stage tasks are skipped. | manual | delegation.controller.js bulkDeleteDelegations |

Rules:

- **Who sees what**: Admin, Super Admin and Management see all tasks. Others see tasks they assigned, do or are in loop on. _(frontend/src/pages/AllTasks/AllTasks.jsx:204; delegation.controller.js getDelegations viewAll)_
- **Bulk actions need administration rights**: Bulk status and bulk delete need the 'Work Queue Administration' permission. _(backend/modules/delegation/delegation.routes.js bulk-status, bulk-delete)_
- **Reassigned tasks stay visible**: A task taken off someone because its order stage moved shows here as 'Reassigned', with where it went. _(delegation.controller.js getDelegations comment; backend/models/Delegation.js reassignedTo)_

### Checklist (`work_queue.checklist`)

Routes: `/wq/checklist`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| FMS / O2D Order Tracker | two-way | Stage task with order, stage, PO number, deadline | Stage activated/assigned/completed/held in O2D; completing it here | backend/modules/o2d/stageMirror.service.js routing rule, ensureStageTask; backend/modules/checklist/checklist.controller.js completeTask -> completeMirroredTask |
| My Work | two-way | Your items and open team tasks | Page load | frontend/src/pages/MyDay/MyDay.jsx:217 |
| Executive Scoreboard | one-way | Planned date, status, completed date | Scoreboard load | backend/modules/scoreboard/scoreboard.controller.js occurrenceQuery |
| Home dashboard | one-way | Due today, overdue, compliance % | Home load | frontend/src/pages/Home/homeSources.js |
| HRMS Leave & Attendance / Inbox | one-way | Availability; inbox notices | Buddy job every 15 min | backend/modules/workqueue/buddy.service.js KINDS.occurrence |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Creating a routine | All its dated items between start and end date are created at once (up to 1000). No nightly job is needed. | automatic | backend/modules/checklist/checklist.controller.js createRoutine insertMany, MAX_OCCURRENCES |
| Editing a routine's dates or frequency | Future unworked items are deleted and regenerated. Past and worked items stay as they were. | historical | checklist.controller.js updateRoutine deleteMany/insertMany |
| Stopping a routine | Pending items from tomorrow onward are deleted. Past items stay. | manual | checklist.controller.js stopRoutine |
| Completing an order-stage item | The real O2D stage is completed with its evidence rules; Order Tracker shows it done and the next stage opens. | multi | checklist.controller.js completeTask |
| Manual reassign | The item moves to the new person and is written to the audit log. | manual | checklist.controller.js reassignTask recordAudit |

Rules:

- **Overdue**: A pending item becomes overdue once its day has passed. Order stages with no deadline yet are never overdue. _(checklist.controller.js overdueClause)_
- **Compliance %**: Completed ÷ items due up to today (plus any done early). Non-functional items are left out. _(checklist.controller.js complianceBaseClause, getSummary)_
- **Proof**: If the routine requires proof, an item cannot be completed without it. _(checklist.controller.js completeTask proofRequired)_
- **Non-managers**: May only create routines for themselves and only complete their own items. Managers (Super Admin, Admin, Management, HR) edit, stop and reassign routines and set buddy chains. _(checklist.controller.js isManager, createRoutine, updateRoutine, stopRoutine, reassignTask)_
- **Team tasks**: An order stage with nobody named is visible to every person whose role completes it; whoever completes it becomes its doer. Senior roles that cover a stage and admins also see it. _(checklist.controller.js visibilityScope, o2dAbilityFor; backend/models/Checklist.js)_
- **Permissions**: View, create, edit, stop (delete) and complete are separate cells. Stopping uses the Work Queue administration key; reassigning uses Task Assignment. _(backend/modules/checklist/checklist.routes.js)_

Requires verification:

- A code comment mentions a nightly job that marks items overdue, but no such scheduled job exists. Overdue is worked out when the list is read.

### Executive Scoreboard (`work_queue.scoreboard`)

Routes: `/wq/executivescoreboard`, `/scoreboard`, `/executive-scoreboard`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Tasks / Delegation | one-way | Doer, due date, status, completed date | Scoreboard load | backend/modules/scoreboard/scoreboard.controller.js delegationQuery |
| Checklist & Routines | one-way | Doer, planned date, status, completed date | Scoreboard load | scoreboard.controller.js occurrenceQuery |
| FMS / O2D | one-way | Stage tasks; deadline is the exact stage deadline, not end of day | Scoreboard load | scoreboard.controller.js onTimeDeadline |
| HRMS Employee records | one-way | Designation | Opening or saving the scoreboard | scoreboard.controller.js canUserEditScoreboard |
| Home dashboard | one-way | Average and top 3 | Home load | frontend/src/pages/Home/homeSources.js scoreboardMetrics |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Saving a goal or MD adjustment | Stored for that person and period; the final score changes at once. | manual | scoreboard.controller.js updateGoalOrAdjustment, ScoreboardGoal |

Rules:

- **What counts as done**: Completed or Awaiting Verification (delegated), or completed (checklist). _(scoreboard.controller.js isCompleted)_
- **On time**: Done by the end of the due day (exact deadline for order stages). _(scoreboard.controller.js onTimeDeadline)_
- **Left out**: Deleted tasks, tasks reassigned away, and unclaimed team tasks. _(scoreboard.controller.js delegationQuery, occurrenceQuery)_
- **Who may set goals**: Needs the Work Queue administration permission AND must be Super Admin, Admin, Management, or have a CEO / MD designation. _(backend/modules/scoreboard/scoreboard.routes.js; scoreboard.controller.js canUserEditScoreboard)_
- **Everyone's scores are visible**: Anyone who can view the scoreboard sees every person's row. _(scoreboard.controller.js getScoreboard (no per-user filter))_

Requires verification:

- Non-functional checklist items: requires verification whether they are excluded from the scoreboard's planned count.

### Activities (`work_queue.activity`)

Routes: `/wq/activities`, `/activities`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Tasks / Delegation | one-way | Activity entries written by task actions | Task actions | backend/modules/delegation/delegation.controller.js logActivity |
| Buddy rotation job | one-way | 'Automatically assigned to…' / 'Returned to…' | Job every 15 min | backend/modules/workqueue/buddy.service.js rotateRow logActivity |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Viewing | Read-only. Nothing is changed. | historical | backend/modules/activities/activity.routes.js (GET only) |

Rules:

- **Separate permission**: Needs 'view Work Queue activity', held by Management; Admin and Super Admin hold it through full access. Task doers do not. _(backend/config/permissions.js Management VIEW_WORK_QUEUE_ACTIVITY; activity.routes.js)_
- **Checklist changes are not here**: Only delegated-task actions write to this log. Checklist reassigns and buddy events go to the system audit log. _(grep: logActivity used only in delegation.controller.js and buddy.service.js)_

### Deleted Tasks (`work_queue.trash`)

Routes: `/wq/deletedtasks`, `/deleted-tasks`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Tasks / Delegation | two-way | The task's deleted flag | Delete or Restore | backend/modules/delegation/delegation.controller.js deleteDelegation, restoreDelegation |
| Activity Log | one-way | 'Task Deleted' / 'Task Restored' | Delete or Restore | delegation.controller.js logActivity deleted/restored |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Restoring a task | It reappears in My Work, Delegation and All Tasks, and counts on the Scoreboard again. | multi | delegation.controller.js restoreDelegation; scoreboard excludes isDeleted |

Rules:

- **Separate permission**: Needs 'manage Work Queue trash'. Only Admin and Super Admin hold it by default; other roles need it ticked in Roles & Permissions. _(backend/config/permissions.js MANAGE_WORK_QUEUE_TRASH; delegation.routes.js canReadTrash, canRestore)_
- **Restore also needs ownership**: Only the task's assigner or a manager can restore it. _(delegation.controller.js restoreDelegation loadTaskFor 'owner')_
- **No permanent delete**: Tasks stay in the bin; there is no purge. _(No deleteMany/findByIdAndDelete on Delegation in delegation.controller.js)_
- **Only delegated tasks**: Checklist items are not soft-deleted and never appear here. Order-stage tasks cannot be deleted. _(checklist.controller.js stopRoutine deleteMany; delegation.controller.js O2D_MIRROR_NOT_DELETABLE)_

## HRMS

### Dashboard (`hrms.dashboard`)

Routes: `/hrms`, `/hrms/dashboard`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Leave | one-way | Approved and pending leave requests; holidays | Page load | backend/modules/hrms/dashboard/dashboard.service.js:155,172,409 |
| Attendance | one-way | Today's attendance records; pending corrections | Page load | backend/modules/hrms/dashboard/dashboard.service.js:195,410 |
| Employees | one-way | Employee status, joining date, birth date | Page load | backend/modules/hrms/dashboard/dashboard.service.js:243,397 |
| Engage | one-way | Published announcements, open polls | Page load | backend/modules/hrms/dashboard/dashboard.service.js:328-349 |
| HR Audit Logs | one-way | Login audit rows | Page load (audit permission only) | backend/modules/hrms/dashboard/dashboard.service.js:376 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Opening the dashboard | Nothing is changed. Every figure is read from the module that owns it. | historical | backend/modules/hrms/dashboard/dashboard.service.js:1-20 |

Rules:

- **What you see depends on your scope**: Company figures need 'view all employees'. Team figures need leave approval for your team. Everyone else gets only the personal widgets. _(backend/modules/hrms/dashboard/dashboard.service.js:542-549)_
- **Each widget loads on its own**: If one widget fails, the rest of the page still shows. _(backend/modules/hrms/dashboard/dashboard.service.js:92-99)_

### Inbox (`hrms.inbox`)

Routes: `/hrms/inbox`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Leave | one-way | 'Leave request' and 'Leave decision' items | Leave applied / approved / rejected | backend/modules/hrms/leave/leave.service.js:466,605 |
| Attendance | one-way | 'Attendance correction' and 'Correction decision' items | Correction submitted / decided | backend/modules/hrms/attendance/correction.service.js:180,358 |
| Expenses | one-way | 'Expense claim' and 'Expense decision' items | Claim submitted / decided | backend/modules/hrms/expenses/claim.service.js:527,642 |
| Exits, Documents, Engage, Helpdesk, Hiring, Onboarding, Assets, Performance, SI Academy | one-way | Inbox items of each type | Business event in that module | backend/shared/constants/inbox.js (INBOX_TYPES); notify() callers under backend/modules/hrms/* |
| Work Queue (Delegation / Checklist) | one-way | 'Task assigned to you' and 'No available assignee' items | Delegation buddy assignment; buddy rotation job | backend/modules/delegation/delegation.controller.js:749; backend/modules/workqueue/buddy.service.js:218,227,333 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Any of the events above | An inbox item is written for each recipient. For seven event types an email is also sent, but only when the server has HR mail switched on. | automatic | backend/modules/hrms/inbox/notifier.service.js:155-171; backend/modules/hrms/inbox/mail.service.js:41; backend/modules/hrms/inbox/mailTemplates.js:95-164 |
| Mark all read / mark selected read / archive | The items change only for you. An audit entry records how many items were cleared, without their titles. | automatic | backend/modules/hrms/inbox/inbox.service.js:268-276 |

Rules:

- **Only your own items**: The server always filters by your own employee record. An account without an employee record has an empty inbox. _(backend/modules/hrms/inbox/inbox.service.js:63-68)_
- **No one creates items by hand**: Items come only from business events. There is no screen or API to post one. _(backend/modules/hrms/inbox/notifier.service.js:26-32)_
- **Emails are off by default**: Emails go out only when the server setting HRMS_MAIL_ENABLED is 'true'. They cover leave requests and decisions, correction requests and decisions, expense requests, exit requests and offer letters. _(backend/modules/hrms/inbox/mail.service.js:41-42; backend/modules/hrms/inbox/mailTemplates.js:95-164)_
- **A notification never blocks the action**: If writing a notification fails, the leave, claim or other action still goes through. _(backend/modules/hrms/inbox/notifier.service.js:173-180)_
- **Old read items may be swept**: The retention sweep can remove or archive old READ items once a window is set. Unread items are never swept. By default they are kept. _(backend/modules/hrms/inbox/inbox.service.js:290-360)_

Requires verification:

- The 15-second unread badge refresh is described in code comments; the frontend polling interval was not checked.

### My Profile (`hrms.me`)

Routes: `/hrms/me`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Employees | one-way | Your employee id | Opening the page | frontend/src/pages/Hrms/MyProfilePage.jsx:39-40 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Saving changes to your own profile | Your employee record is updated and an audit entry is written. | automatic | backend/modules/hrms/employees/employee.controller.js:96-100 |

Rules:

- **Needs view-own-record permission**: Held by every HRMS role except Auditor (Auditor has no self-service baseline). _(frontend/src/components/hrms/navItems.js (hrms-me); backend/shared/permissions/matrix.js (SELF_BASELINE, AUDITOR))_

Requires verification:

- Exactly which fields an employee may change on their own record (self edit) was not traced field by field.

### Employees (`hrms.employees`)

Routes: `/hrms/employees`, `/hrms/employees/:id`, `/hrms/employees/:id/edit`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Portal User accounts | two-way | Email, display name, HRMS roles, status, password | Create / edit / deactivate / reset password / delete | backend/modules/hrms/employees/employee.service.js:463,708,778,878,910 |
| Org Structure | one-way | Department id, location id | Create / edit employee | backend/modules/hrms/employees/employee.service.js:444 (assertReferencesResolve) |
| Leave, Expenses, Attendance approvals | one-way | Reporting manager and reporting chain | Request submitted | backend/modules/hrms/leave/leave.service.js:319-343; backend/modules/hrms/expenses/claim.service.js:450-480; backend/modules/hrms/attendance/correction.service.js:179 |
| SI Academy | one-way | New employee | Employee created | backend/modules/hrms/employees/employee.service.js:569-585 |
| Payroll | one-way | Employee id, compensation | Payroll run compute | backend/modules/hrms/payroll/run.service.js:44,55 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Creating an employee | A login is created with the Employee role (or the roles you pick) and a temporary password shown once. Matching SI Academy training is assigned. An audit entry is written. | multi | backend/modules/hrms/employees/employee.service.js:429-587; employee.controller.js:58 |
| Changing the reporting manager | The reporting chain is recomputed. This changes who approves this person's leave, expenses and corrections, and who sees them under team scope. | multi | backend/modules/hrms/employees/employee.service.js:690; backend/modules/hrms/employees/managerChain.js |
| Deactivating | The record is marked exited and hidden. The login is suspended and signed out everywhere. | automatic | backend/modules/hrms/employees/employee.service.js:749-790 |
| Delete permanently | Erases the employee, login, attendance, leave, payslips, documents, exit, claims, tickets, training, goals and inbox. Approvals they gave on other people's records stay. Past payroll run totals stay unchanged. | multi | backend/modules/hrms/employees/employeeErasure.js:1-60 |

Rules:

- **Who can see whom**: View all needs 'employees view all' (HR Admin, Recruiter, Auditor, Super Admin). Managers see their reporting tree. Everyone can see their own record. _(backend/modules/hrms/employees/employee.routes.js:42-46; backend/shared/permissions/matrix.js)_
- **Who can create, edit, delete**: Create: HR Admin and Super Admin. Edit: HR Admin, Recruiter, Super Admin. Deactivate and permanent delete: Super Admin only. _(backend/modules/hrms/employees/employee.routes.js:105-145; backend/shared/permissions/matrix.js)_
- **Sensitive fields are encrypted**: PAN, Aadhaar, UAN, bank account and IFSC are stored encrypted. Viewing one in full is recorded in the audit log. _(backend/modules/hrms/employees/sensitiveUpdate.js; employee.controller.js:185-192)_
- **No reporting loops**: A manager change that would create a loop (A reports to B, B reports to A) is refused. _(backend/modules/hrms/employees/managerChain.js:1-20)_
- **Deactivate refuses managers**: You cannot deactivate someone who still has direct reports. Reassign them first. _(backend/modules/hrms/employees/employee.service.js:757-766)_
- **Permanent delete refuses**: Refused for yourself, for someone with direct reports, and for the last active Super Admin. Assets still issued do not block it. _(backend/modules/hrms/employees/employeeErasure.js:41-50,243-254)_
- **Customers cannot hold HRMS roles**: A customer-portal-only login can never be given an HRMS role. _(backend/utils/hrmsRoleGuard.js; backend/modules/hrms/employees/employee.service.js:874)_

Requires verification:

- Whether existing pending leave or expense requests are re-routed when a manager changes was not traced (approval steps store the approver at submit time).

### Org Structure (`hrms.org`)

Routes: `/hrms/org`, `/hrms/org/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Employees | two-way | Department, location, reporting manager | Employee create / edit | backend/modules/hrms/org/orgChart.service.js:1-20; backend/modules/hrms/org/department.service.js:215 |
| Dashboard, Hiring, Planning, Engage, SI Academy, Payroll, Leave | one-way | Department and location ids | Their own screens | grep departmentId/locationId under backend/modules/hrms (dashboard, hiring, planning, engage, academy, payroll/compensation, leave) |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Create / edit / delete a department or location | Saved and recorded in the HR audit log. | automatic | backend/modules/hrms/org/department.service.js:153,185,228; location.service.js:121,159 |
| Renaming a department | Every employee, dashboard and report shows the new name, because records point to the department, not its name. | multi | backend/modules/hrms/dashboard/dashboard.service.js:478-488 |

Rules:

- **Cannot delete what is in use**: A department or location that still has active employees cannot be deleted. _(backend/modules/hrms/org/department.service.js:215-217; location.service.js:181-183)_
- **Who can edit**: Editing needs 'org structure edit' (HR Admin and Super Admin). Other users only see the Org Chart tab. _(backend/modules/hrms/org/org.routes.js:56; frontend/src/pages/Hrms/org/OrgStructurePage.jsx:69-86)_
- **Org chart scope**: The whole chart needs 'view all employees' or 'org structure edit'; others see only their own subtree. _(backend/modules/hrms/org/orgChart.service.js:12-20)_

Requires verification:

- There is no designations list: designation is a free-text field on each employee (backend/models/hrms/Employee.js:133).
- Reporting lines are set on each employee in Employees, not on this screen.

### Attendance (`hrms.attendance`)

Routes: `/hrms/attendance`, `/hrms/attendance/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Correction pending / decided items (and email if enabled) | Correction submitted / decided | backend/modules/hrms/attendance/correction.service.js:179-183,358-360 |
| Employees | one-way | Employee status, reporting chain | Punch / list | backend/modules/hrms/attendance/attendance.service.js:227-241 |
| Dashboard | one-way | Attendance records, corrections | Dashboard load | backend/modules/hrms/dashboard/dashboard.service.js:195,410 |
| Payroll | one-way | None | — | backend/modules/hrms/payroll/run.service.js:36-55 (no attendance import); backend/shared/payroll/lop.js:8 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Clock in / clock out | Today's attendance record is written and an audit entry is made. The location name is looked up afterwards (OpenStreetMap), so the punch never waits for it. | automatic | backend/modules/hrms/attendance/attendance.service.js:304-443; geocode.service.js:30,188 |
| Approving a correction | The attendance record for that day is created or changed to the corrected times, and the employee is notified. | multi | backend/modules/hrms/attendance/correction.service.js:339-410 |
| Selfie retention sweep | Old selfie photos are deleted after the configured window. The attendance record itself is kept. | automatic | backend/modules/hrms/attendance/selfieRetention.handler.js:1-20 |

Rules:

- **One punch in and out per day**: A second clock-in, or clock-out without clock-in, is refused. _(backend/modules/hrms/attendance/attendance.service.js:313,403,408)_
- **Cannot decide your own correction**: Corrections are decided by someone with attendance approval for the team (reporting manager) or for the company (HR Admin, Recruiter, Super Admin). _(backend/modules/hrms/attendance/correction.service.js:294-307; backend/shared/permissions/matrix.js)_
- **Selfie and location need consent**: Consent is recorded per purpose and can be changed by the employee. _(backend/modules/hrms/attendance/attendance.service.js:253-285; consent.service.js:132)_
- **Status is calculated**: No clock-in = Absent; clocked in only = On the clock; a full day depends on hours worked. _(backend/shared/attendance/status.js:115-145)_

Requires verification:

- The exact retention window for selfies is configured in HR settings, not in code (code comment states 90 days).
- The retention sweep cron is off in this portal by default (HRMS_RETENTION_CRON); code says the Customer Portal still runs it (backend/server.js:44-62).

### Leave (`hrms.leave`)

Routes: `/hrms/leave`, `/hrms/leave/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Employees | one-way | Reporting manager | Leave applied | backend/modules/hrms/leave/leave.service.js:319-343 |
| Inbox | one-way | Leave request / Leave decision items (and email if enabled) | Apply / decide | backend/modules/hrms/leave/leave.service.js:466,605 |
| Payroll | one-way | Approved leave requests, leave type paid flag, holidays | Payroll run compute | backend/modules/hrms/payroll/run.service.js:254-261,349; backend/shared/payroll/lop.js |
| Exits | one-way | Leave balances | Full & final computation | backend/modules/hrms/exits/fnf.service.js:39,157 |
| Dashboard | one-way | Leave requests, holidays | Dashboard load | backend/modules/hrms/dashboard/dashboard.service.js:155,172 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Applying for leave | A pending request is created, the days are held as 'pending' on the balance, the manager gets an inbox item, and an audit entry is written. | multi | backend/modules/hrms/leave/leave.service.js:400-475 |
| Approving leave | The request becomes approved, the balance moves from pending to used, and the employee is notified. If the type is unpaid, the next payroll run docks those days. | multi | backend/modules/hrms/leave/leave.service.js:505-610; payroll/run.service.js:349 |
| Cancelling a pending request | The request becomes cancelled and the pending days are released. | automatic | backend/modules/hrms/leave/leave.service.js:622-645 |
| Adding or removing a holiday | Changes leave day counts for new requests and the loss-of-pay count in the next payroll compute. | multi | backend/modules/hrms/leave/leave.service.js:379; payroll/run.service.js:47,261 |

Rules:

- **Only the direct manager or HR decides**: A skip-level manager can see but not decide. HR Admin and Super Admin can decide any request. Nobody can decide their own. _(backend/modules/hrms/leave/leave.service.js:13-18,529-547)_
- **No manager means auto-approved**: If the employee has no reporting manager, or the manager's record was deleted, the request is approved at once. _(backend/modules/hrms/leave/leave.service.js:323,335,400-401)_
- **Balance is not enforced**: A request is never refused for low balance. Balances only move if a balance row exists. _(backend/modules/hrms/leave/leave.service.js:20-25,240-248)_
- **No overlaps**: A request that overlaps one of your live requests is refused. _(backend/modules/hrms/leave/leave.service.js:388-396)_
- **HR-only types**: Some leave types can only be granted by people with leave admin rights. _(backend/modules/hrms/leave/leave.service.js:371-372)_
- **Only pending requests can be cancelled**: Only the requester can cancel, and only while it is pending. _(backend/modules/hrms/leave/leave.service.js:628-633)_

Requires verification:

- No leave accrual job exists in code: balance rows are created only by the employee import (backend/modules/hrms/import/pipeline.js). There is no monthly accrual cron.
- A code comment says a deleted manager 'falls to the HR override', but the code auto-approves in that case (leave.service.js:332-335 vs 400-401). Requires confirmation of intended behaviour.

### Payroll (`hrms.payroll`)

Routes: `/hrms/payroll`, `/hrms/payroll/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Leave | one-way | Approved leave, leave type paid flag, holiday calendar | Compute run | backend/modules/hrms/payroll/run.service.js:45-47,254-261,349 |
| Employees | one-way | Compensation, state for PT/LWF | Compute run | backend/modules/hrms/payroll/run.service.js:55; compensation.service.js:81,93 |
| Attendance | one-way | None | — | grep of backend/modules/hrms/payroll shows no AttendanceRecord use |
| Expenses | one-way | None | — | grep of backend/modules/hrms/payroll shows no ExpenseClaim use |
| Exits | one-way | Compensation | Full & final computation | backend/modules/hrms/exits/fnf.service.js:41,110 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Compute a run | Payslips are calculated for everyone in the pay group from compensation, structure, statutory settings, adjustments and unpaid leave. The run moves to review. | multi | backend/modules/hrms/payroll/run.service.js:212-430 |
| Lock a run | Payslips become visible to employees and can no longer change. | automatic | backend/modules/hrms/payroll/run.service.js:467-490; backend/shared/constants/payroll.js:110 |
| Disburse a run | The run is marked paid. Nothing can change after this. | automatic | backend/modules/hrms/payroll/run.service.js:500-525 |
| Every run step, compensation and statutory change | Recorded in the HR audit log. | automatic | backend/modules/hrms/payroll/run.service.js:181,427,489,521,557; compensation.service.js:204,256; statutory.service.js:130,167,197 |

Rules:

- **Run order**: Draft → compute → review → lock → disbursed. Rollback is only possible before locking. _(backend/modules/hrms/payroll/run.service.js:1-15)_
- **Who runs payroll**: Only Payroll Admin and Super Admin can create, compute, lock, disburse or roll back runs. HR Admin can view but not run. _(backend/modules/hrms/payroll/payroll.routes.js:82,257-270; backend/shared/permissions/matrix.js)_
- **Who edits structures**: Structures, components, pay groups and statutory settings need 'payroll structure edit' (Payroll Admin, Super Admin). _(backend/modules/hrms/payroll/payroll.routes.js:68-76)_
- **Who edits salary**: Employee compensation can be viewed by Payroll Admin and Super Admin, but edited only by Super Admin. _(backend/modules/hrms/payroll/payroll.routes.js:89-97; backend/shared/permissions/matrix.js)_
- **Employees see only locked runs**: A payslip appears to an employee only once its run is locked or disbursed. _(backend/modules/hrms/payroll/payslip.service.js:106,213-214)_
- **Payroll does not read the clock**: The month being run decides the dates, so recomputing gives the same result. _(backend/modules/hrms/payroll/run.service.js:17-25)_

Requires verification:

- No email or inbox notification is sent when payslips are published (no notify call in payroll was found).
- Payslip PDF generation (pdfKey field) was not traced.

### Expenses (`hrms.expenses`)

Routes: `/hrms/expenses`, `/hrms/expenses/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Employees | one-way | Reporting manager | Claim submitted | backend/modules/hrms/expenses/claim.service.js:450-480 |
| Inbox | one-way | Expense claim / Expense decision items (email for new claims if enabled) | Submit / decide | backend/modules/hrms/expenses/claim.service.js:527,642 |
| Payroll | one-way | None | — | backend/modules/hrms/expenses/claim.service.js:664-700; no ExpenseClaim use in backend/modules/hrms/payroll |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Submitting a claim | The claim gets a two-step approval chain (manager, then finance), the manager is notified, and an audit entry is written. | multi | backend/modules/hrms/expenses/claim.service.js:431-535 |
| Approving or rejecting | One rejection ends the claim. Manager approval moves it to finance; finance approval makes it ready to reimburse. The claimant is notified each time. | automatic | backend/modules/hrms/expenses/claim.service.js:552-650 |
| Marking reimbursed | The claim is closed as reimbursed with the date. Audit entry written. | automatic | backend/modules/hrms/expenses/claim.service.js:664-697 |

Rules:

- **Two-step approval**: Step 1: the direct reporting manager (or a company-level approver). Step 2: finance — anyone with company-level expense approval (HR Admin, Payroll Admin, Super Admin). _(backend/modules/hrms/expenses/claim.service.js:579-592; backend/shared/permissions/matrix.js)_
- **No manager skips step 1**: If the claimant has no reporting manager, the manager step is marked approved automatically and the claim goes straight to finance. _(backend/modules/hrms/expenses/claim.service.js:472-480)_
- **No self-approval**: You cannot approve or reimburse your own claim at any step. _(backend/modules/hrms/expenses/claim.service.js:569-570,676-677)_
- **Drafts only are editable**: Only the claimant can edit, and only while it is a draft. A claim needs at least one line to submit. _(backend/modules/hrms/expenses/claim.service.js:384-447)_
- **Reimburse only finance-approved claims**: A claim must be finance approved before it can be marked reimbursed. _(backend/modules/hrms/expenses/claim.service.js:670-674)_
- **Receipts are checked**: Uploaded receipts are checked to be real files; only the claimant can attach them. _(backend/modules/hrms/expenses/claim.service.js:731-770)_

Requires verification:

- Category policy limits (daily/monthly limit, auto-approve below, receipt required) are stored, but no check of them was found in the claim submit or approve flow (ExpensePolicy is only imported in claim.service.js:35).
- Whether a rejected claim can be resubmitted was inferred from the status flow, not from a test.

### Performance (`hrms.performance`)

Routes: `/hrms/performance`, `/hrms/performance/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Review-assigned notice | Assigning a review | backend/modules/hrms/performance/review.service.js (notify REVIEW_ASSIGNED) |
| Employees | one-way | Employee and manager records | Every read | backend/modules/hrms/performance/goal.service.js:28 (Employee import) |
| Audit Logs | one-way | Audit entries | Each write | backend/modules/hrms/performance/*.service.js (recordAudit) |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Assigning a review | The reviewer gets an inbox item. | automatic | backend/modules/hrms/performance/review.service.js |
| Advancing a cycle phase | Controls when review responses can be written (open phases only). | automatic | backend/modules/hrms/performance/review.service.js:43 (RESPONSE_OPEN_PHASES) |

Rules:

- **Who can run cycles**: Creating cycles, changing phase and calibration need 'Performance approve (whole company)': HR Admin and HRMS Super Admin. _(backend/modules/hrms/performance/performance.routes.js (canAdminister); backend/shared/permissions/matrix.js)_
- **Who can schedule 1:1s**: Managers (team approval) and HR/Super Admin. _(backend/modules/hrms/performance/performance.routes.js (canScheduleOneOnOne))_
- **Ratings range**: Ratings must fall within the fixed minimum and maximum. _(backend/modules/hrms/performance/review.service.js:34 (RATING_MIN/MAX))_
- **Goal status changes**: Goals can only move along allowed status transitions. _(backend/modules/hrms/performance/goal.service.js:32 (GOAL_TRANSITIONS))_

Requires verification:

- Whether the HR Dashboard / home dashboard goal widget reads the same goals list (memory says a scope bug there was fixed) — not re-traced here.

### Documents (`hrms.documents`)

Routes: `/hrms/documents`, `/hrms/documents/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Policy-published notice | Publishing a policy | backend/modules/hrms/documents/document.service.js (notify POLICY_PUBLISHED) |
| File storage | one-way | Signed read links | Opening a document | backend/modules/hrms/hrms.bootstrap.js (registerFileAccessRule EMPLOYEE_DOCUMENT / COMPANY_ASSET) |
| Data retention sweep | one-way | Stored file bytes (record kept) | Retention cron | backend/modules/hrms/documents/documentRetention.handler.js; backend/server.js:63 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Publishing a policy | Every targeted employee gets an inbox item and the policy shows as pending for them. | automatic | backend/modules/hrms/documents/document.service.js |
| Opening a file | A 'document viewed' audit entry is written. | automatic | backend/modules/hrms/hrms.bootstrap.js (AUDIT_ACTIONS.DOCUMENT_VIEWED) |

Rules:

- **HR-only actions**: Folders, publishing policies and the acknowledgement report need 'Documents edit (whole company)': HR Admin and HRMS Super Admin. _(backend/modules/hrms/documents/document.routes.js (canAdminister))_
- **Upload checks**: Uploads have a size limit and the file content is checked against its type. _(backend/modules/hrms/documents/documentUpload.js)_

### Engage (`hrms.engage`)

Routes: `/hrms/engage`, `/hrms/engage/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Announcement and recognition notices | Publishing an announcement / giving recognition | backend/modules/hrms/engage/announcement.service.js; engage/recognition.service.js (notify) |
| HR Dashboard | one-way | Announcement and poll lists | Opening the dashboard | backend/modules/hrms/dashboard/dashboard.service.js:66-67 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Publishing an announcement | Recipients get an inbox item; it appears on the HR Dashboard. | multi | backend/modules/hrms/engage/announcement.service.js |
| Giving recognition | The receiver gets an inbox item and it appears on the wall. | automatic | backend/modules/hrms/engage/recognition.service.js |

Rules:

- **HR controls content**: Creating announcements, polls, badges and eNPS surveys, and seeing results, needs 'Engage edit (whole company)': HR Admin and HRMS Super Admin. _(backend/modules/hrms/engage/engage.routes.js (canManage))_
- **Results are HR-only**: A respondent sees the question, never everyone's answers. _(backend/modules/hrms/engage/engage.routes.js (/polls/:id/results, /enps/:id/results))_

Requires verification:

- Whether poll/eNPS responses are stored anonymously — not traced.

### Helpdesk (`hrms.helpdesk`)

Routes: `/hrms/helpdesk`, `/hrms/helpdesk/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Ticket-assigned notice | Assigning a ticket | backend/modules/hrms/helpdesk/helpdesk.service.js (notify TICKET_ASSIGNED) |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Changing a category's SLA | Only new tickets use the new hours; existing tickets keep the SLA they were created with. | historical | backend/modules/hrms/helpdesk/helpdesk.service.js:36 |

Rules:

- **Resolver areas**: HR Admin resolves HR tickets, Payroll Admin payroll tickets, IT / Asset Admin IT tickets; HRMS Super Admin resolves all. _(backend/modules/hrms/helpdesk/helpdesk.routes.js (canResolve); backend/shared/permissions/matrix.js)_
- **Categories are Super Admin only**: Managing categories needs 'Helpdesk resolve (whole company)', held only by HRMS Super Admin. _(backend/modules/hrms/helpdesk/helpdesk.routes.js (canAdminister))_
- **SLA snapshot**: SLA hours are copied onto the ticket at creation. _(backend/modules/hrms/helpdesk/helpdesk.service.js:166)_

Requires verification:

- No scheduled SLA escalation job was found; breach is only shown on screen.

### SI Academy (`hrms.academy`)

Routes: `/hrms/academy`, `/hrms/academy/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Employees | one-way | New employee -> learning assignments | Employee created | backend/modules/hrms/employees/employee.service.js:571 |
| Inbox | one-way | Assigned, completed, certificate, due-soon and overdue notices | Assigning, completing, certificate issue, daily reminder job | backend/modules/hrms/academy/assignment.service.js; certificate.service.js; reminder.service.js:120 |
| Daily reminder job | one-way | Reminder inbox items | Cron, only when ACADEMY_REMINDER_CRON=enabled (off by default) | backend/server.js:84-90 |
| Org Structure | one-way | Department list | Rule run | backend/modules/hrms/academy/rule.service.js (Department import) |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Creating an employee in HRMS | Matching rules assign training automatically; a rule failure does not block employee creation. | multi | backend/modules/hrms/employees/employee.service.js:555-585 |
| Completing all lessons of a path | A certificate is issued and the learner is notified. | automatic | backend/modules/hrms/academy/assignment.service.js:59 (issueCertificate) |
| Revoking a certificate | The certificate is marked revoked. | manual | backend/modules/hrms/academy/academy.routes.js (/certificates/:id/revoke) |

Rules:

- **Authoring**: Paths, courses, content and assessments need 'Academy edit (whole company)': HR Admin and HRMS Super Admin. _(backend/modules/hrms/academy/academy.routes.js (canManage))_
- **Assigning and rules**: Need 'Academy assign (whole company)': HR Admin and HRMS Super Admin. _(backend/modules/hrms/academy/academy.routes.js (canAssign))_
- **Progress is personal**: Only the learner can complete their own lessons; managers and auditors read only. _(backend/shared/permissions/matrix.js (ACADEMY entries))_

### Learning path (`hrms.academy.learn`)

Routes: `/hrms/academy/learn/:assignmentId`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| SI Academy | two-way | Assignment and progress | Opening an assignment | frontend/src/routes/index.jsx (learn/:assignmentId); backend/modules/hrms/academy/academy.routes.js (GET /assignments/:id) |

Rules:

- **Own assignments**: Needs 'Academy view (self)', which every employee has. _(backend/modules/hrms/academy/academy.routes.js (canLearn))_

### Lesson player (`hrms.academy.lesson`)

Routes: `/hrms/academy/learn/:assignmentId/lesson/:lessonId`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Audit Logs | one-way | Content-viewed audit entry | Opening content | backend/modules/hrms/hrms.bootstrap.js (ACADEMY_CONTENT_VIEWED) |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Completing the last lesson | The path completes and a certificate is issued. | automatic | backend/modules/hrms/academy/assignment.service.js |

Rules:

- **Submit permission**: Completing lessons needs 'Academy submit (self)', which every employee has. _(backend/modules/hrms/academy/academy.routes.js (canSubmit))_

Requires verification:

- Pass mark and retry limits for assessments not traced.

### Path builder (`hrms.academy.builder`)

Routes: `/hrms/academy/paths/:pathId`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Content Library | one-way | Content items | Adding a lesson | backend/modules/hrms/academy/catalogue.service.js:58 (contentByIds) |

Rules:

- **HR only**: Needs 'Academy edit (whole company)'. _(backend/modules/hrms/academy/academy.routes.js (canManage))_

Requires verification:

- Whether editing a path changes assignments already in progress — not traced.

### Onboarding (`hrms.onboarding`)

Routes: `/hrms/onboarding`, `/hrms/onboarding/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Onboarding-task and offer-letter-ready notices (offer letter can also email) | Starting a checklist / sending an offer letter | backend/modules/hrms/onboarding/checklist.service.js; offerLetter.service.js (notify); inbox/mailTemplates.js |
| Hiring | one-way | None | Manual — HR creates the employee, then starts a checklist | backend/modules/hrms/hiring/offer.service.js:389-433; onboarding/offerLetter.service.js:7-20 |
| Employees | one-way | Employee id, department | Starting a checklist | backend/modules/hrms/onboarding/checklist.service.js:36 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Starting a checklist | Assignees get inbox items for their tasks. | automatic | backend/modules/hrms/onboarding/checklist.service.js:191 |
| Editing a template | Checklists already started are not changed. | historical **UNVERIFIED** | backend/modules/hrms/onboarding/template.service.js |

Rules:

- **HR controls**: Templates, starting/cancelling checklists and offer letters need 'Onboarding edit (whole company)': HR Admin and HRMS Super Admin. _(backend/modules/hrms/onboarding/onboarding.routes.js (canAdminister))_
- **Two different offers**: This offer letter is for an existing employee and is signed after login. The Hiring offer is for a candidate via a public link. _(backend/modules/hrms/onboarding/offerLetter.service.js:7-20)_

Requires verification:

- Whether template edits affect running checklists.

### Exits (`hrms.exits`)

Routes: `/hrms/exits`, `/hrms/exits/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Exit-initiated (can also email) and clearance notices | Initiating an exit / opening clearances | backend/modules/hrms/exits/exit.service.js (notify EXIT_INITIATED, EXIT_CLEARANCE) |
| Leave | one-way | Leave balances | Settlement preview | backend/modules/hrms/exits/fnf.service.js:157 |
| Payroll | one-way | Compensation | Settlement preview | backend/modules/hrms/exits/fnf.service.js:110; payrollRunId only defined in backend/models/hrms/ExitRequest.js:104, never set |
| Assets | one-way | None | Manual | backend/modules/hrms/exits/exit.service.js:603-645 (no asset model import) |
| Employees | one-way | Employee status, notice end date | Disburse | backend/modules/hrms/exits/exit.service.js:932-935 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Disbursing the settlement | Exit closes and the employee's status becomes exited; assets can no longer be assigned to them. | multi | backend/modules/hrms/exits/exit.service.js:907-948; assets/asset.service.js:557 |
| Opening clearances | Clearances are routed to the first active IT Admin, Payroll Admin and HR Admin/Super Admin found, plus the manager. | automatic | backend/modules/hrms/exits/exit.service.js:603-645 |

Rules:

- **Approval chain**: Manager approval ('Exits approve (team)': Reporting Manager), then HR approval ('Exits edit (whole company)': HR Admin, Super Admin). _(backend/modules/hrms/exits/exit.routes.js)_
- **Order of steps**: Clearances only while awaiting clearance; disbursing only while settlement is pending; relieving letter only after close. _(backend/modules/hrms/exits/exit.service.js:676, 911, 956)_

Requires verification:

- Whether the portal login is disabled when the employee is marked exited.

### Assets (`hrms.assets`)

Routes: `/hrms/assets`, `/hrms/assets/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Inbox | one-way | Request raised, request decided, asset assigned | Raising/deciding a request, assigning an item | backend/modules/hrms/assets/asset.service.js (notify) |
| Customer Portal Inventory | one-way | None | None | backend/modules/hrms/assets/asset.service.js:45-52 (imports only Employee and AssetModels) |
| Exits | one-way | Employee status | Assigning an item | backend/modules/hrms/assets/asset.service.js:557 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Assigning an item | Item becomes 'assigned' and appears in the holder's My Assets. | automatic | backend/models/hrms/AssetModels.js:136-145 |

Rules:

- **Admin actions**: Inventory changes, categories and request decisions need 'Assets assign (whole company)': IT / Asset Admin, HR Admin, HRMS Super Admin. _(backend/modules/hrms/assets/asset.routes.js (canAdminister); backend/shared/permissions/matrix.js)_
- **Inventory view**: Auditor can view the inventory but not change it. _(backend/shared/permissions/matrix.js)_

### Hiring (`hrms.hiring`)

Routes: `/hrms/hiring`, `/hrms/hiring/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Careers site (public) | two-way | Postings, applications, offer decisions | Publish posting / candidate applies / candidate accepts | backend/modules/hrms/hiring/careers.routes.js; frontend/src/routes/index.jsx:128-133 |
| Inbox | one-way | Interview-scheduled, requisition-approved notices | Scheduling / approving | backend/modules/hrms/hiring/interview.service.js; requisition.service.js (notify) |
| Planning | one-way | Requisition reference | Creating a hiring plan | backend/modules/hrms/planning/hiringPlan.service.js:122 |
| Onboarding | one-way | None | Manual | backend/modules/hrms/hiring/offer.service.js:389-433 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Publishing a posting | Role appears on the public Careers page; an approved requisition becomes open. | multi | backend/modules/hrms/hiring/requisition.service.js:533-551 |
| Candidate accepts an offer | Offer is stamped accepted with signature, IP and browser; the link stops working. Requisition is not set to filled and no employee is created. | automatic | backend/modules/hrms/hiring/offer.service.js:389-433 |

Rules:

- **Who edits**: All writes need 'Hiring edit (whole company)': Recruiter, HR Admin, HRMS Super Admin. Managers only view as interviewers. _(backend/modules/hrms/hiring/hiring.routes.js; backend/shared/permissions/matrix.js)_
- **Postable requisitions**: Only approved or open requisitions can be published; a closed posting cannot be republished. _(backend/modules/hrms/hiring/requisition.service.js:520-531)_
- **Offer link**: Link is shown once, expires after a fixed number of days, and works for one decision only. _(backend/modules/hrms/hiring/offer.service.js:264-274, 408-410)_

Requires verification:

- Memory's 'undelivered candidate email / early requisition close / unstamped retention' findings belong to a different project (Sparsh HRMS). Here: no candidate email is sent (by design, link copied manually); no early close found; no retention handler is registered for candidate resumes (bootstrap registers only audit, selfies, employee documents, inbox) — so resumes are kept indefinitely.
- A code comment says the offer link is mailed to the candidate, but no email is sent. HR has to copy the link and send it.

### Planning (`hrms.planning`)

Routes: `/hrms/planning`, `/hrms/planning/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Employees | one-way | Active employee counts by department | Opening Headcount | backend/modules/hrms/planning/headcountPlan.service.js:114-119 |
| Hiring | one-way | Requisition | Creating a hiring plan | backend/modules/hrms/planning/hiringPlan.service.js:122 |

Rules:

- **Org scope only**: View and edit need Planning (whole company): HR Admin and HRMS Super Admin. _(backend/modules/hrms/planning/planning.routes.js; backend/shared/permissions/matrix.js)_

### Reports (`hrms.reports`)

Routes: `/hrms/reports`, `/hrms/reports/:key`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Employees / Attendance / Leave | one-way | Employees, attendance records, leave balances | Running a report | backend/modules/hrms/reports/report.registry.js:198, 248, 336; report.service.js:30-34 |
| Audit Logs **UNVERIFIED** | one-way | Audit entry | Run/export | backend/modules/hrms/reports/report.service.js:34 (recordAudit import) |

Rules:

- **Entry**: Opens for anyone with HR Reports, payroll reports, hiring reports, asset reports or team reports; each report is then hidden unless you can read its data module. _(backend/modules/hrms/reports/report.routes.js; frontend/src/components/hrms/navItems.js (REPORTS_ENTRY_GRANTS))_

Requires verification:

- Only three reports exist; a Payroll Admin, Recruiter or IT Admin may see an empty catalogue — requires verification in the UI.

### Settings (`hrms.settings`)

Routes: `/hrms/settings`, `/hrms/settings/:tab`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Portal Roles & Permissions | one-way | Implied HRMS roles | Each sign-in / permission check | backend/utils/hrmsAccessBridge.js |
| Audit Logs | one-way | Audit entries | Each save | backend/modules/hrms/settings/settings.service.js:31; audit/audit.service.js:42-82 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Editing a custom role | Changes access for every user holding it. | multi | backend/modules/hrms/rbac/customRole.service.js:224, 367 |

Rules:

- **Super Admin only**: View and edit need Settings (whole company), held only by HRMS Super Admin. _(backend/modules/hrms/settings/settings.routes.js; backend/shared/permissions/matrix.js)_
- **Super Admin cannot be locked out**: The HRMS Super Admin role cannot be deleted or stripped of its settings access. _(backend/modules/hrms/rbac/customRole.service.js:28-111)_

Requires verification:

- Earlier critical 'HR takeover via HRMS reset': the employee password reset (Employees screen, not this one) is limited to HRMS Super Admin, but it does not check whether the target is a portal Admin. Anyone given the portal 'Administer HRMS' grant becomes HRMS Super Admin and can reset any employee-linked login. Evidence: backend/modules/hrms/employees/employee.service.js:893-915; backend/utils/hrmsAccessBridge.js. Requires verification whether this is still considered open.

### Audit Logs (`hrms.audit`)

Routes: `/hrms/audit-logs`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| All HRMS modules | one-way | Audit entries | User actions | backend/utils/auditLog.js:1-52 |
| Portal modules (Work Queue, O2D, login) | one-way | Audit entries | User actions | backend/modules/hrms/audit/audit.service.js:100-110; backend/modules/auth/auth.controller.js, checklist, delegation, o2d (recordAudit) |
| Retention sweep | one-way | Audit rows | Retention cron (HRMS_RETENTION_CRON, off by default here; Customer Portal cron runs it) | backend/modules/hrms/hrms.bootstrap.js; backend/server.js:45-63 |

Rules:

- **Read only**: Needs 'Audit logs view (whole company)': HRMS Super Admin, HR Admin, Auditor. _(backend/shared/permissions/matrix.js)_

Requires verification:

- Configured audit retention window — stored in data, not traced.

## Administration

### Internal User Management (`administration.users`)

Routes: `/admin/users`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Roles & Permissions | one-way | Role name on the account | Saving a role change | CP backend/utils/roleResolver.js:338-344 (permissions resolved from user.role on every request) |
| HRMS employee records | one-way | HRMS roles on the account | Changing an account's role | CP backend/modules/users/user.controller.js:491-498 (denyIfRoleCombinationInvalid) |
| Other portal | two-way | Staff accounts | Any save in either portal | CP and EP backend/models/User.js identical; EP frontend/src/routes/index.jsx:160-172 |
| Audit log | one-way | Create, update, role, password, access actions | Saving | EP backend/modules/users/user.routes.js:49-58 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Changing a person's role | Their menus and allowed actions change on their next page load in both portals. No re-login is needed because access is worked out on each request. | automatic | CP backend/middlewares/rbac.js:65; CP backend/utils/roleResolver.js:338 |
| Suspending a staff account | They are refused on the next request in both portals. Work assigned to them (Work Queue tasks, O2D stages) is not reassigned automatically. | manual **UNVERIFIED** | CP backend/middlewares/auth.js:22-26 |

Rules:

- **Who can use it**: Opening needs 'Manage Users'. Creating needs 'Create Users', editing needs 'Edit Users'. Super Admin and Admin hold all of these; Sales does not. _(CP backend/config/moduleRegistry.js:929-958; EP backend/modules/users/user.routes.js:45-58)_
- **Customer Portal checks per target**: In the Customer Portal, which accounts you may create or edit is checked against the account type: Customer accounts need the Customer Management permission, staff accounts need the Internal User Management permission. _(CP backend/modules/users/user.controller.js:110-135)_
- **Extra access: admins only**: Only full administrators who can also manage roles see the Access button. _(CP frontend/src/pages/Admin/Settings/UserManagement.jsx:241,760)_
- **Each portal edits only its own extra grants**: In the Customer Portal, extra grants for Employee Portal modules are kept as stored and cannot be changed from there. _(CP backend/modules/users/user.controller.js:556-619 (mergeServedGrants, normaliseExtraGrants))_

Requires verification:

- Permanent erase of an employee is done in HRMS (employee record), not on this screen. Its effect on the login account requires verification. (EP backend/modules/hrms/employees/employee.routes.js:144)
- Whether open Work Queue or O2D work moves when a staff account is suspended was not traced.

### Roles & Permissions (`administration.roles`)

Routes: `/admin/permissions`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Every Employee Portal screen | one-way | Role grants | Saving a role | EP backend/utils/roleResolver.js (resolveRolePermissions, menuFor) |
| Customer Portal | two-way | Role grants | Save here; periodic reload there | CP backend/server.js:124-125 (setInterval loadRoles) |
| HRMS Settings | one-way | HRMS role matrix | Opening the HRMS roles view | EP backend/modules/roles/role.controller.js:19,123-129 |
| Audit log | one-way | Actor and action | Saving | EP backend/modules/roles/role.routes.js:75-81 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Saving a role | This portal's in-memory role list is refreshed before the save returns, so holders get the new access on their next request. The Customer Portal picks it up within about a minute. | multi | EP backend/modules/roles/role.controller.js:265; CP backend/server.js:124-125 |
| Unticking a cell | Removes the permission. A role that has a saved row gets only what the row says; the built-in defaults apply only to a role with no row. | automatic | EP backend/utils/roleResolver.js (resolveRolePermissions header and body) |

Rules:

- **Who can use it**: Opening needs 'Manage Roles'. Creating, editing and deleting need 'Create Roles', 'Edit Roles' and 'Delete Roles'. By default only Super Admin and Admin hold these. _(EP backend/modules/roles/role.routes.js:51-81; EP backend/config/moduleRegistry.js:960-985)_
- **Full-access flag**: Only a Super Admin can create a full-access role or change that flag. The built-in Super Admin and Admin roles can never lose full access. _(EP backend/modules/roles/role.controller.js:151-157,221-237)_
- **Built-in roles**: Built-in roles cannot be renamed or deleted; their ticks can be changed. _(EP backend/modules/roles/role.controller.js:198-205,317-322)_
- **Role in use**: A role still held by any account cannot be deleted. _(EP backend/modules/roles/role.controller.js:324-330)_
- **Customer fence**: The Customer role is always limited to Customer Portal screens, whatever is ticked. _(EP backend/modules/roles/role.controller.js:239-250; EP backend/utils/roleResolver.js (portalOnly ceiling))_
- **Only this portal's modules**: The matrix lists only Employee Portal modules. _(EP backend/modules/roles/role.controller.js:103-120 (registryForClient(currentPortal())))_

Requires verification:

- Employee Portal save replaces the whole grants list with what the screen sends (no per-portal merge on the server). The screen is believed to send every stored cell back; requires verification that Customer Portal cells are never lost.

## FMS: Order to Dispatch

### My Tasks (`o2d.tasks`)

Routes: `/fms/o2d/tasks`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Work Queue: Checklist and Delegation | two-way | One task per open stage: a team Checklist task for the owning role, or a personal task when a person is assigned. Completing it from the Work Queue completes the real stage. | Stage unlocks, is assigned, completed, skipped, held | EP backend/modules/o2d/stage.engine.js:220-224 (ensureStageTask on unlock); EP backend/modules/o2d/stageMirror.service.js:1-30,159; EP backend/modules/checklist/checklist.controller.js:20,43-72 |
| Executive Scoreboard | one-way | Stage task completion times | Completing the stage task | EP backend/modules/scoreboard/scoreboard.controller.js:16-18,272 |
| O2D bell (in-app notifications) | one-way | Unlocked, due soon, overdue, escalated | Stage events and the 5-minute sweep | EP backend/modules/o2d/notification.service.js:1-30; EP frontend/src/pages/O2d/O2dBell.jsx |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Completing a stage | The next stage unlocks with a new deadline, its owner gets a task and a notification, and the Work Queue copy of this stage is marked done. | multi | EP backend/modules/o2d/stage.engine.js:260,461 |
| Leaving a stage past its deadline | The 5-minute sweep sends an overdue alert to the owner, and after a grace period escalates to the stage's escalation role (Management by default). | automatic | EP backend/modules/o2d/escalation.service.js:100-160; EP backend/modules/o2d/notification.service.js:144; EP backend/server.js:255-260 |

Rules:

- **Who sees it**: Needs 'View O2D'. By default held by Sales, Billing, Accounts, Billing Head, Warehouse User, Management and Import Team. The list only shows stages your role owns or may complete. _(EP backend/config/moduleRegistry.js:628-635; EP backend/config/permissions.js BASELINE_ROLE_PERMISSIONS; EP backend/modules/o2d/task.service.js:1-40)_
- **Completing needs 'Work O2D Stage'**: Held by Sales, Billing, Accounts, Billing Head and Warehouse User. Import Team and Management can view but not complete. _(EP backend/modules/o2d/o2d.routes.js:84,194-199)_
- **Working hours**: Deadlines count working time only (default 10:30 to 18:30, Monday to Saturday), except stage 5 which uses calendar days. _(EP backend/shared/constants/o2d.js:247-293; EP backend/config/seedO2dStages.js:102-111)_

Requires verification:

- Background sweeps (reminders, escalations, daily summary, invoice retry) run only when the Employee Portal server has O2D_CRON=enabled. Production setting not checked.
- WhatsApp and email notifications are off unless O2D_WHATSAPP_ENABLED / O2D_EMAIL_ENABLED are set; in-app is on by default. Production settings not checked.

### Order Tracker (`o2d.orders`)

Routes: `/fms/o2d/orders`, `/fms/o2d/orders/new`, `/fms/o2d/history`, `/fms/o2d/exits`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Customer Portal bookings | one-way | Booking lines grouped by booking number are read; nothing is written back to the booking | Picking a booking on New Order | EP backend/modules/o2d/booking.service.js:1-40; EP backend/modules/o2d/o2d.routes.js:122-135 |
| Work Queue (Checklist / Delegation) | two-way | Task per stage, held/released with the order | Unlock, assign, complete, skip, hold, reopen | EP backend/modules/o2d/stageMirror.service.js:1-40; EP backend/modules/o2d/o2dDelegationSync.service.js:1-25; EP backend/modules/o2d/stage.engine.js:224,461,520,703,870 |
| Zoho Books | two-way | Invoice number and status | Raise invoice button; Zoho webhook; hourly retry of failed invoices | EP backend/modules/o2d/invoicing.service.js:58-67,178,224; EP backend/modules/o2d/o2d.routes.js:79,277; EP backend/server.js:281 |
| Notifications (in-app, email, WhatsApp) | one-way | Order created, stage unlocked / due soon / overdue / escalated, held, resumed, closed, cancelled | Stage engine events and the sweep | EP backend/shared/constants/o2d.js:357-374; EP backend/modules/o2d/notification.service.js; EP backend/modules/o2d/channels/* |
| Delay Analytics | one-way | Stage status and timings | Completing stages | EP backend/modules/o2d/analytics.service.js; EP backend/shared/constants/o2d.js:103-106 |

| Action | Effect | Kind | Evidence |
|---|---|---|---|
| Creating an order | Twelve stage rows are created; stage 1 opens and its owner gets a task and notification. | multi | EP backend/modules/o2d/stage.engine.js:123 |
| Putting an order on hold | Deadlines pause and the order's Work Queue tasks are held. Resuming releases them. | multi | EP backend/modules/o2d/stage.engine.js:804,870,902 |
| Cancelling or voiding | The order leaves the tracker and appears in the Exit Register. The record and its stages are kept. | historical | EP backend/config/moduleRegistry.js:646-647; EP backend/modules/o2d/o2d.routes.js:232-237 |
| Creating an O2D order from a booking | The booking itself is not changed; it stops appearing in the booking picker while a live O2D order uses it. | historical | EP backend/modules/o2d/booking.service.js:13-21,42-44 |

Rules:

- **Create an order**: Needs 'Create O2D Order'. By default only Sales (and admins). _(EP backend/modules/o2d/o2d.routes.js:83,140; EP frontend/src/routes/index.jsx:197-202)_
- **Complete, assign, raise invoice**: Needs 'Work O2D Stage' (Sales, Billing, Accounts, Billing Head, Warehouse User). The server also checks your role against the stage owner. _(EP backend/modules/o2d/o2d.routes.js:84,194-220,277)_
- **Hold and resume**: Needs 'Hold O2D' (Billing Head, Management). _(EP backend/modules/o2d/o2d.routes.js:85,221-222)_
- **Cancel, void, revive**: Needs 'Exit O2D' (Billing Head, Management). _(EP backend/modules/o2d/o2d.routes.js:86,235-237)_
- **Reopen and overrides**: Needs 'Override O2D' (Billing Head, Management). _(EP backend/modules/o2d/o2d.routes.js:87,200-205)_
- **One invoice per order**: The Zoho invoice uses a fixed key per order so retries never create a second invoice. _(EP backend/modules/o2d/invoicing.service.js:1-30,58)_

Requires verification:

- Zoho integration is active only when O2D_ZOHO_ENABLED=enabled on the Employee server; production setting not checked.

### Stages (`o2d.stages`)

Routes: `/fms/o2d/stages`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Order Tracker | one-way | Live orders and stage status | Opening the screen | EP backend/modules/o2d/o2d.routes.js:108-117; EP frontend/src/pages/O2d/StagesTab.jsx |

Rules:

- **Who sees it**: Needs 'View O2D'. What each person sees is narrowed by role on the server. _(EP backend/config/moduleRegistry.js:652-662)_

### Analytics (`o2d.analytics`)

Routes: `/fms/o2d/analytics`

| Connected to | Direction | Exchanged | Trigger | Evidence |
|---|---|---|---|---|
| Order Tracker / My Tasks | one-way | Stage status and timings | Opening the screen | EP backend/modules/o2d/analytics.service.js:94-475; EP backend/shared/constants/o2d.js:103-106 |
| Daily summary email | one-way | Open, overdue and summary counts | Daily scheduled job | EP backend/modules/o2d/escalation.service.js:259,286; EP backend/modules/o2d/notification.service.js:70,104,116; EP backend/server.js:271-278 |

Rules:

- **Who sees it**: Needs 'View O2D Analytics', held by default by Billing Head and Management. The tab is hidden from others. _(EP backend/modules/o2d/o2d.routes.js:91,250-264; EP frontend/src/pages/O2d/O2dPage.jsx:89-91)_
- **Held time excluded**: Time an order spent on hold is not counted as delay. _(EP backend/shared/constants/o2d.js:73-76)_

Requires verification:

- The registry calls this screen 'Delay Analytics'; the tab in the app is labelled 'Analytics'.
