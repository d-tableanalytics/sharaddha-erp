/**
 * "About this module" documentation: Home and Work Queue.
 *
 * GENERATED from the module audit; edit the text here directly when a screen
 * changes. The code each statement was verified against is listed in
 * docs/module-documentation-map.md, not here, so no source paths ship to the
 * browser. `verified: false` items show as "Requires verification".
 */
export default [
  {
    "key": "work_queue.home",
    "portal": "employee",
    "paths": [
      "/",
      "/dashboard"
    ],
    "title": "Home dashboard",
    "overview": {
      "what": "The first page after sign-in. It collects your open tasks, checklist items, order stages and HR items into one view, showing only the cards your access allows.",
      "why": "Staff work across several modules. This page shows in one place what is late, what is due today and what is waiting for you.",
      "users": [
        "Every signed-in employee account (cards differ by role)"
      ]
    },
    "functions": [
      {
        "title": "Needs your attention",
        "detail": "A ranked list of things waiting on you: overdue tasks, tasks due today, tasks waiting for your verification, overdue checklist items, overdue order stages, HR approvals, inbox actions, learning due and a 'not clocked in' reminder. Red items come first. A zero never shows."
      },
      {
        "title": "My Work card",
        "detail": "Counts of your open, overdue, due-today and to-verify tasks, plus your next five tasks."
      },
      {
        "title": "Checklist card",
        "detail": "Your checklist items due today, overdue items and your compliance percentage."
      },
      {
        "title": "Scoreboard card",
        "detail": "This week's average score and the top three people."
      },
      {
        "title": "Recent activity",
        "detail": "The six latest Work Queue activity entries (only for people who may read the Activity Log)."
      },
      {
        "title": "FMS cards",
        "detail": "My Order Stages (open, overdue, due soon) and, for analytics holders, the order pipeline and on-time percentage."
      },
      {
        "title": "HR cards",
        "detail": "Holidays, announcements, workforce or team figures, inbox, today's attendance, leave balances, learning, goals and hiring, each shown only when HRMS allows it."
      },
      {
        "title": "Quick actions",
        "detail": "Shortcuts: My Work, Assign Task, New Order, Order Tracker, HR quick links, Manage Users and Roles & Permissions — each shown only with the matching permission."
      }
    ],
    "connections": [
      {
        "module": "Tasks (My Work / Delegation)",
        "key": "work_queue.tasks",
        "why": "My Work card and attention items",
        "data": "Your own open tasks, and tasks you assigned that wait for verification",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "Checklist & Routines",
        "key": "work_queue.checklist",
        "why": "Checklist card",
        "data": "Due-today, overdue and compliance counts",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "Executive Scoreboard",
        "key": "work_queue.scoreboard",
        "why": "Scoreboard card",
        "data": "This week's rows, average final score, top 3",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "Activity Log",
        "key": "work_queue.activity",
        "why": "Recent activity card",
        "data": "Latest 6 activity entries",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "FMS / O2D (My Order Stages, Order Tracker)",
        "key": null,
        "why": "Order stage counts and pipeline",
        "data": "Task counts, analytics summary, SLA on-time %",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "HRMS (Dashboard, Inbox, Attendance, Leave, Academy, Performance, Hiring)",
        "key": null,
        "why": "HR cards and attention items",
        "data": "Widgets, summary, unread inbox, today's punch, leave balances, learning, goals/reviews, requisitions/interviews",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Opening the Home page",
        "effect": "Nothing is changed. The page only reads from each module; every module still checks access on its own.",
        "kind": "historical",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Cards follow your access",
        "detail": "A card is requested only if you could open the matching screen. Hiding a card is display only; the server still checks every request.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "No access at all",
        "detail": "If no card or admin shortcut applies, the page says 'No Employee Portal access'. Administrators still see a Roles & Permissions link.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Clock-in reminder",
        "detail": "Shown only if you can clock in, have not, and today is not a Sunday or a listed company holiday.",
        "kind": "automation",
        "verified": true
      },
      {
        "title": "Overdue means the same everywhere",
        "detail": "Overdue tasks use the same rule as the task lists, so Home never calls a task late when the list does not.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Sign in to the Employee portal.",
      "Read 'Needs your attention' from the top: red items are late.",
      "Click an item to jump to the screen that holds it.",
      "Use Quick actions to start common work, such as Assign Task.",
      "Check the My Work and Checklist cards for today's load."
    ],
    "warnings": [
      {
        "title": "A missing card is not an error",
        "detail": "Cards appear only for modules your role holds. Ask an administrator if you expected one.",
        "severity": "warning"
      }
    ],
    "unverified": []
  },
  {
    "key": "work_queue.tasks",
    "portal": "employee",
    "paths": [
      "/work-queue",
      "/work-queue/:taskId",
      "/my-work",
      "/my-work/:taskId",
      "/my-tasks/:taskId"
    ],
    "title": "My Work",
    "overview": {
      "what": "Your personal day: every task you must do, from delegated tasks, checklist items and order-stage tasks, grouped as Late, Today, Upcoming and Done. The heading greets you by first name ('Hi …').",
      "why": "So each person has one list of what they owe today.",
      "users": [
        "Super Admin",
        "Admin",
        "Sales",
        "Billing",
        "Accounts",
        "Billing Head",
        "Warehouse User",
        "Management"
      ]
    },
    "functions": [
      {
        "title": "My Work tabs",
        "detail": "Tabs Delegation, Checklist, Loop and Group, each with Late / Today / Upcoming / Done sections. The Checklist tab shows a 'new' count for items that arrived since your last visit."
      },
      {
        "title": "Start and submit work",
        "detail": "Move your task to In Progress, then submit it for verification (or complete it if verification is off). Attach evidence when the task requires it."
      },
      {
        "title": "Order-stage tasks",
        "detail": "Tasks linked to an order stage open the real order stage. Completing one completes the stage in Order Tracker too."
      },
      {
        "title": "Task Assignment (capability)",
        "detail": "Choosing or changing who does a task happens inside the create/edit dialogs and the buddy override. Needs the 'Task Assignment' permission."
      },
      {
        "title": "Task Completion (capability)",
        "detail": "Verify & Complete, or marking a task Completed. Needs the 'Task Completion' permission."
      },
      {
        "title": "Work Queue Administration (capability)",
        "detail": "Delete a task (moves it to Deleted Tasks), bulk status change and bulk delete. Needs the 'Work Queue Administration' permission."
      },
      {
        "title": "Subtasks, remarks, reminders, follow-ups",
        "detail": "Add subtasks and tick them off, post remarks, set reminders and log follow-up calls."
      }
    ],
    "connections": [
      {
        "module": "Checklist & Routines",
        "key": "work_queue.checklist",
        "why": "My Work's Checklist tab shows your checklist items",
        "data": "Your occurrences plus open order-stage team tasks for your role",
        "direction": "two-way",
        "trigger": "Page load; completing an item from My Work",
        "verified": true
      },
      {
        "module": "FMS / O2D Order Tracker",
        "key": null,
        "why": "Order stages appear as tasks for the named person",
        "data": "Stage task (order, stage number, PO number, deadline); completion runs the real stage completion",
        "direction": "two-way",
        "trigger": "Stage becomes active/assigned/completed/held in O2D; completing the task here",
        "verified": true
      },
      {
        "module": "Executive Scoreboard",
        "key": "work_queue.scoreboard",
        "why": "Every task with a due date counts toward the doer's score",
        "data": "Due date, status, completion date",
        "direction": "one-way",
        "trigger": "Scoreboard reads tasks when opened",
        "verified": true
      },
      {
        "module": "Activity Log",
        "key": "work_queue.activity",
        "why": "Task changes are recorded",
        "data": "Created, status change, subtask, remark, date revision, deleted, restored",
        "direction": "one-way",
        "trigger": "Each task action",
        "verified": true
      },
      {
        "module": "HRMS Leave & Attendance",
        "key": null,
        "why": "Buddy chains decide who is available today",
        "data": "Approved full-day leave, attendance marks, employee status, holidays",
        "direction": "one-way",
        "trigger": "Buddy rotation job every 15 minutes",
        "verified": true
      },
      {
        "module": "HRMS Inbox",
        "key": null,
        "why": "Buddy hand-overs and manual overrides notify people",
        "data": "Inbox notification",
        "direction": "one-way",
        "trigger": "Buddy rotation or manual override",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Submitting a task for verification",
        "effect": "Status becomes Awaiting Verification; it appears in the assigner's 'To verify' count on Home and on Delegation.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Completing an order-stage task",
        "effect": "The O2D stage is completed with its evidence and SLA, and Order Tracker shows it done.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Deleting a task",
        "effect": "The task is hidden from all lists and moved to Deleted Tasks. It can be restored.",
        "kind": "manual",
        "verified": true
      },
      {
        "action": "Order put on hold or cancelled in O2D",
        "effect": "Its stage task is parked and drops out of My Work, keeping its status.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Statuses",
        "detail": "Pending → In Progress → Awaiting Verification → Completed, or Need Revision. 'Reassigned' is set only by the system when an order stage moves to someone else.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "No self-verification",
        "detail": "If a task needs verification, the doer cannot mark it Completed; the assigner or a manager verifies it.",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "Evidence required",
        "detail": "A task marked 'evidence required' cannot be submitted or completed without a link or notes.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Who may act on a task",
        "detail": "The assigner or a manager (Super Admin, Admin, Management, HR) may edit, verify, move the due date or delete. The doer only moves the work forward. In-loop people and buddy backups can read and remark.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Permissions",
        "detail": "View, create, edit, assign, complete and delete are separate permissions. All are held by Sales, Billing, Accounts, Billing Head, Warehouse User and Management; Admin and Super Admin hold everything.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Order-stage tasks are locked",
        "detail": "Their title and due date come from the order stage. They cannot be deleted here, cannot use a buddy chain and are skipped by bulk actions. Unassign the stage in Order Tracker instead.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Buddy rotation",
        "detail": "A buddy task goes each office day to the first person in its chain who is available. A job runs every 15 minutes (on by default) and at server start. Company holidays are skipped.",
        "kind": "automation",
        "verified": true
      },
      {
        "title": "Held order stages are hidden",
        "detail": "Tasks for orders on hold, cancelled or voided drop out of My Work until the order resumes.",
        "kind": "automation",
        "verified": true
      }
    ],
    "steps": [
      "Open My Work from the sidebar (or Home → My Work).",
      "Pick a tab: Delegation, Checklist, Loop or Group.",
      "Start with the Late section, then Today.",
      "Open a task and move it to In Progress.",
      "Add evidence if asked, then submit for verification.",
      "The task moves to Done once the assigner verifies it; it also counts on the Executive Scoreboard."
    ],
    "warnings": [
      {
        "title": "Late work lowers your score",
        "detail": "Tasks completed after the due day count as not on time on the Executive Scoreboard.",
        "severity": "warning"
      },
      {
        "title": "Completing an order-stage task completes the real order stage",
        "detail": "It cannot be undone from here.",
        "severity": "irreversible"
      }
    ],
    "unverified": [
      "The 'Group' tab filters tasks that carry a group id, but the task record has no group field; requires verification whether this tab ever shows anything.",
      "Tasks have a 'recurrence' setting, but no code was found that creates the next occurrence; requires verification whether recurring delegated tasks repeat.",
      "No email, WhatsApp or inbox message is sent to the doer when a normal task is created; only buddy hand-overs and manual overrides send inbox notifications. Confirm this is intended."
    ]
  },
  {
    "key": "work_queue.tasks.delegation",
    "portal": "employee",
    "paths": [
      "/wq/delegation",
      "/wq/delegation/:taskId"
    ],
    "title": "Delegation",
    "overview": {
      "what": "Create tasks for other people and track the tasks you assigned until you verify them.",
      "why": "So work handed to someone has an owner, a due date and a sign-off.",
      "users": [
        "Super Admin",
        "Admin",
        "Sales",
        "Billing",
        "Accounts",
        "Billing Head",
        "Warehouse User",
        "Management"
      ]
    },
    "functions": [
      {
        "title": "Create a task",
        "detail": "Title, description, doer, people in loop, priority, category, tags, due date, subtasks, and whether verification and evidence are required."
      },
      {
        "title": "Buddy chain",
        "detail": "Instead of one doer, set a primary and 1–5 backups in order. The task goes each day to the first available person."
      },
      {
        "title": "Manual override and resume",
        "detail": "Pick the doer by hand. This pins the task: the automatic rotation stops until a manager resumes it."
      },
      {
        "title": "Verify & Complete",
        "detail": "Sign off a task the doer submitted, with optional notes."
      },
      {
        "title": "Revise due date",
        "detail": "Move the due date with a reason. Every change is kept in the task's history."
      },
      {
        "title": "Views and export",
        "detail": "List, Kanban and Calendar views, filters and CSV export."
      }
    ],
    "connections": [
      {
        "module": "My Work",
        "key": "work_queue.tasks",
        "why": "The doer sees the task in My Work",
        "data": "The task",
        "direction": "two-way",
        "trigger": "Task creation and status changes",
        "verified": true
      },
      {
        "module": "HRMS Leave & Attendance",
        "key": null,
        "why": "Decides buddy availability",
        "data": "Approved leave, attendance marks, employee status, holidays",
        "direction": "one-way",
        "trigger": "Buddy job every 15 min; right after creation",
        "verified": true
      },
      {
        "module": "HRMS Inbox",
        "key": null,
        "why": "Tells people about hand-overs",
        "data": "'You have been automatically assigned…', 'No one is available…' (to the assigner)",
        "direction": "one-way",
        "trigger": "Buddy job or manual override",
        "verified": true
      },
      {
        "module": "Audit Log (system)",
        "key": null,
        "why": "Records buddy events",
        "data": "Backup activated, primary restored, no assignee, manual override, rotation resumed",
        "direction": "one-way",
        "trigger": "Buddy job or override",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Creating a task",
        "effect": "It appears in the doer's My Work and in the Activity Log as 'task created'.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Primary in a buddy chain is on full-day leave",
        "effect": "Within 15 minutes the next available backup gets the task and an inbox message. Next office day it returns to the primary if available.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Nobody in the chain is available",
        "effect": "The task stays with its last doer, is flagged, and the assigner gets one inbox message.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Creating needs two permissions",
        "detail": "Create and Task Assignment, since creating also picks the doer.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Who counts as available",
        "detail": "Active login, employee in a working status, no approved full-day leave, and no absent / on leave / weekly off / holiday mark. Half-day leave still counts as available. 'Not checked in' counts as away only if a cut-off time is configured.",
        "kind": "automation",
        "verified": true
      },
      {
        "title": "Within a day the holder keeps it",
        "detail": "If the primary comes back mid-day, the backup keeps the task until the next day.",
        "kind": "automation",
        "verified": true
      },
      {
        "title": "Chain size",
        "detail": "Primary plus 1 to 5 backups.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Default list",
        "detail": "Shows tasks you assigned. Managers can view all.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open Delegation and click to create a task.",
      "Fill the title, due date and doer (or a buddy chain).",
      "Add people in loop who should follow it.",
      "Turn on verification or evidence if needed, then save.",
      "Wait for the doer to submit; the task then shows as awaiting verification.",
      "Click Verify & Complete. The task moves to Done and counts on the Scoreboard."
    ],
    "warnings": [
      {
        "title": "A manual override stops the rotation",
        "detail": "The pinned person keeps the task until a manager resumes the rotation.",
        "severity": "warning"
      }
    ],
    "unverified": []
  },
  {
    "key": "work_queue.tasks.in_loop",
    "portal": "employee",
    "paths": [
      "/in-loop-tasks",
      "/in-loop-tasks/:taskId",
      "/wq/looptasks",
      "/wq/looptasks/:taskId"
    ],
    "title": "Loop Tasks",
    "overview": {
      "what": "Tasks where you were added 'in loop' — you follow them but do not own or do them.",
      "why": "So people who need to know about a task can watch its progress without being responsible for it.",
      "users": [
        "Super Admin",
        "Admin",
        "Sales",
        "Billing",
        "Accounts",
        "Billing Head",
        "Warehouse User",
        "Management"
      ]
    },
    "functions": [
      {
        "title": "Follow tasks",
        "detail": "See status, due date and history of tasks you are in loop on."
      },
      {
        "title": "Remark",
        "detail": "Post remarks on a task you follow."
      },
      {
        "title": "Views and export",
        "detail": "List, Kanban and Calendar views, filters and CSV export."
      }
    ],
    "connections": [
      {
        "module": "Delegation",
        "key": "work_queue.tasks.delegation",
        "why": "The assigner adds you in loop",
        "data": "In-loop people list on the task",
        "direction": "one-way",
        "trigger": "Task create/edit",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Posting a remark",
        "effect": "The remark is added to the task and to the Activity Log.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Read and remark only",
        "detail": "Being in loop lets you read and remark. You cannot change, verify or complete the task.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Managers can look at another person's loop list",
        "detail": "Managers may pass another user to see that person's in-loop tasks.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open Loop Tasks from the sidebar.",
      "Filter or switch view to find a task.",
      "Open it to read status and remarks.",
      "Add a remark if you need to say something; the doer and assigner see it on the task."
    ],
    "warnings": [],
    "unverified": []
  },
  {
    "key": "work_queue.tasks.all",
    "portal": "employee",
    "paths": [
      "/all-tasks",
      "/all-tasks/:taskId",
      "/wq/alltasks",
      "/wq/alltasks/:taskId"
    ],
    "title": "All Tasks",
    "overview": {
      "what": "One list of delegated tasks. Admin, Super Admin and Management see every task in the company; everyone else sees the tasks they assigned, do or are in loop on.",
      "why": "So managers can see all delegated work in one place, and staff can see all tasks they are involved in.",
      "users": [
        "Super Admin",
        "Admin",
        "Sales",
        "Billing",
        "Accounts",
        "Billing Head",
        "Warehouse User",
        "Management"
      ]
    },
    "functions": [
      {
        "title": "Views",
        "detail": "List, Kanban and Calendar views with filters and a reset button."
      },
      {
        "title": "Task drawer",
        "detail": "Open a task to see its details, subtasks, remarks and history."
      },
      {
        "title": "Export to Excel",
        "detail": "Advanced export of the filtered tasks."
      },
      {
        "title": "Row actions",
        "detail": "Edit, delete (moves to Deleted Tasks) and bulk status change, each needing its own permission."
      }
    ],
    "connections": [
      {
        "module": "Delegation",
        "key": "work_queue.tasks.delegation",
        "why": "Shows the same delegated tasks",
        "data": "Delegated tasks",
        "direction": "two-way",
        "trigger": "Page load; edits",
        "verified": true
      },
      {
        "module": "Deleted Tasks",
        "key": "work_queue.trash",
        "why": "Deleting a task here moves it to the bin",
        "data": "Deleted flag, who and when",
        "direction": "one-way",
        "trigger": "Delete / bulk delete",
        "verified": true
      },
      {
        "module": "Activity Log",
        "key": "work_queue.activity",
        "why": "Changes are logged",
        "data": "Status changes, deletes",
        "direction": "one-way",
        "trigger": "Task actions",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Bulk status change",
        "effect": "Changes status on the selected tasks you own. Order-stage tasks are skipped and reported.",
        "kind": "manual",
        "verified": true
      },
      {
        "action": "Bulk delete",
        "effect": "Selected tasks you own move to Deleted Tasks. Order-stage tasks are skipped.",
        "kind": "manual",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Who sees what",
        "detail": "Admin, Super Admin and Management see all tasks. Others see tasks they assigned, do or are in loop on.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Bulk actions need administration rights",
        "detail": "Bulk status and bulk delete need the 'Work Queue Administration' permission.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Reassigned tasks stay visible",
        "detail": "A task taken off someone because its order stage moved shows here as 'Reassigned', with where it went.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Open All Tasks.",
      "Pick List, Kanban or Calendar view.",
      "Filter by status, priority, category or person.",
      "Open a task to see its details.",
      "Export to Excel if you need a report."
    ],
    "warnings": [
      {
        "title": "HR is a manager on the server but not here",
        "detail": "HR users act as managers on task actions, but this page shows them only their own tasks.",
        "severity": "warning"
      }
    ],
    "unverified": []
  },
  {
    "key": "work_queue.checklist",
    "portal": "employee",
    "paths": [
      "/wq/checklist"
    ],
    "title": "Checklist",
    "overview": {
      "what": "Recurring routines (daily, weekly, monthly…) and the dated items they create. It also holds order-stage tasks that need evidence, such as invoice or dispatch details.",
      "why": "So repeat compliance work is planned ahead and every occurrence is tracked to completion.",
      "users": [
        "Super Admin",
        "Admin",
        "Sales",
        "Billing",
        "Accounts",
        "Billing Head",
        "Warehouse User",
        "Management"
      ]
    },
    "functions": [
      {
        "title": "Tasks view",
        "detail": "Dated items with status pending, completed, overdue, non-functional or reassigned. Filter by date, person, site and department."
      },
      {
        "title": "Routines view",
        "detail": "The master rules: task name, unique code, frequency, doer, site, department, start and end date, proof required."
      },
      {
        "title": "Department scoreboard",
        "detail": "Completion figures per department (managers)."
      },
      {
        "title": "Complete an item",
        "detail": "Mark done, with a proof file when the routine requires it."
      },
      {
        "title": "Non-functional",
        "detail": "Mark that an item did not need doing, with a reason."
      },
      {
        "title": "Reassign",
        "detail": "Managers move one item to another person."
      },
      {
        "title": "Stop a routine",
        "detail": "Ends the routine and removes its future items."
      },
      {
        "title": "Buddy chain on routines",
        "detail": "Managers can give a routine a primary and backups; each day's item goes to the first available person."
      }
    ],
    "connections": [
      {
        "module": "FMS / O2D Order Tracker",
        "key": null,
        "why": "Active order stages that require evidence appear here — for the named person, or as a team task for the whole responsible role",
        "data": "Stage task with order, stage, PO number, deadline",
        "direction": "two-way",
        "trigger": "Stage activated/assigned/completed/held in O2D; completing it here",
        "verified": true
      },
      {
        "module": "My Work",
        "key": "work_queue.tasks",
        "why": "Your items show in the Checklist tab",
        "data": "Your items and open team tasks",
        "direction": "two-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "Executive Scoreboard",
        "key": "work_queue.scoreboard",
        "why": "Items count toward the doer's score",
        "data": "Planned date, status, completed date",
        "direction": "one-way",
        "trigger": "Scoreboard load",
        "verified": true
      },
      {
        "module": "Home dashboard",
        "key": "work_queue.home",
        "why": "Checklist card and attention items",
        "data": "Due today, overdue, compliance %",
        "direction": "one-way",
        "trigger": "Home load",
        "verified": true
      },
      {
        "module": "HRMS Leave & Attendance / Inbox",
        "key": null,
        "why": "Buddy routines use availability and notify",
        "data": "Availability; inbox notices",
        "direction": "one-way",
        "trigger": "Buddy job every 15 min",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Creating a routine",
        "effect": "All its dated items between start and end date are created at once (up to 1000). No nightly job is needed.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Editing a routine's dates or frequency",
        "effect": "Future unworked items are deleted and regenerated. Past and worked items stay as they were.",
        "kind": "historical",
        "verified": true
      },
      {
        "action": "Stopping a routine",
        "effect": "Pending items from tomorrow onward are deleted. Past items stay.",
        "kind": "manual",
        "verified": true
      },
      {
        "action": "Completing an order-stage item",
        "effect": "The real O2D stage is completed with its evidence rules; Order Tracker shows it done and the next stage opens.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Manual reassign",
        "effect": "The item moves to the new person and is written to the audit log.",
        "kind": "manual",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Overdue",
        "detail": "A pending item becomes overdue once its day has passed. Order stages with no deadline yet are never overdue.",
        "kind": "expiry",
        "verified": true
      },
      {
        "title": "Compliance %",
        "detail": "Completed ÷ items due up to today (plus any done early). Non-functional items are left out.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Proof",
        "detail": "If the routine requires proof, an item cannot be completed without it.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Non-managers",
        "detail": "May only create routines for themselves and only complete their own items. Managers (Super Admin, Admin, Management, HR) edit, stop and reassign routines and set buddy chains.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Team tasks",
        "detail": "An order stage with nobody named is visible to every person whose role completes it; whoever completes it becomes its doer. Senior roles that cover a stage and admins also see it.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Permissions",
        "detail": "View, create, edit, stop (delete) and complete are separate cells. Stopping uses the Work Queue administration key; reassigning uses Task Assignment.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open Checklist from the sidebar.",
      "Managers: open Routines and create a routine with code, frequency, doer and dates.",
      "Items for every date appear in the Tasks view straight away.",
      "Doers: filter to today and complete each item, adding proof if asked.",
      "Late items show as overdue.",
      "Results feed My Work, the Home Checklist card and the Executive Scoreboard."
    ],
    "warnings": [
      {
        "title": "Stopping a routine deletes its future items",
        "detail": "Pending items from tomorrow on are removed, not archived.",
        "severity": "irreversible"
      },
      {
        "title": "Editing dates regenerates future items",
        "detail": "Unworked future items are deleted and created again.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "A code comment mentions a nightly job that marks items overdue, but no such scheduled job exists. Overdue is worked out when the list is read."
    ]
  },
  {
    "key": "work_queue.scoreboard",
    "portal": "employee",
    "paths": [
      "/wq/executivescoreboard",
      "/scoreboard",
      "/executive-scoreboard"
    ],
    "title": "Executive Scoreboard",
    "overview": {
      "what": "A score for every active person, built from their delegated tasks and checklist items for the week, month or year.",
      "why": "To show who finishes their planned work, and who finishes it on time.",
      "users": [
        "Super Admin",
        "Admin",
        "Sales",
        "Billing",
        "Accounts",
        "Billing Head",
        "Warehouse User",
        "Management"
      ]
    },
    "functions": [
      {
        "title": "Period and site",
        "detail": "Switch between week, month and year, and between all sites, HO and Bhandup."
      },
      {
        "title": "Two KRAs",
        "detail": "KRA 1: % of planned work not done. KRA 2: % of planned work not done on time. Each shown with last period's figure."
      },
      {
        "title": "Score",
        "detail": "Baseline = average of (100 − KRA 1 miss %) and (100 − KRA 2 miss %). Final = baseline + MD adjustment."
      },
      {
        "title": "Next goal and MD adjustment",
        "detail": "Authorised people set a next-period goal (0–100) and an MD tie-breaker (−10 to +10) per person."
      },
      {
        "title": "Ranking",
        "detail": "People with work ranked by final score; top three highlighted."
      }
    ],
    "connections": [
      {
        "module": "Tasks / Delegation",
        "key": "work_queue.tasks",
        "why": "Delegated tasks are counted by due date",
        "data": "Doer, due date, status, completed date",
        "direction": "one-way",
        "trigger": "Scoreboard load",
        "verified": true
      },
      {
        "module": "Checklist & Routines",
        "key": "work_queue.checklist",
        "why": "Checklist items are counted by planned date",
        "data": "Doer, planned date, status, completed date",
        "direction": "one-way",
        "trigger": "Scoreboard load",
        "verified": true
      },
      {
        "module": "FMS / O2D",
        "key": null,
        "why": "Order-stage tasks count like any other task",
        "data": "Stage tasks; deadline is the exact stage deadline, not end of day",
        "direction": "one-way",
        "trigger": "Scoreboard load",
        "verified": true
      },
      {
        "module": "HRMS Employee records",
        "key": null,
        "why": "A CEO or MD designation allows editing goals",
        "data": "Designation",
        "direction": "one-way",
        "trigger": "Opening or saving the scoreboard",
        "verified": true
      },
      {
        "module": "Home dashboard",
        "key": "work_queue.home",
        "why": "Scoreboard card",
        "data": "Average and top 3",
        "direction": "one-way",
        "trigger": "Home load",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Saving a goal or MD adjustment",
        "effect": "Stored for that person and period; the final score changes at once.",
        "kind": "manual",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "What counts as done",
        "detail": "Completed or Awaiting Verification (delegated), or completed (checklist).",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "On time",
        "detail": "Done by the end of the due day (exact deadline for order stages).",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Left out",
        "detail": "Deleted tasks, tasks reassigned away, and unclaimed team tasks.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Who may set goals",
        "detail": "Needs the Work Queue administration permission AND must be Super Admin, Admin, Management, or have a CEO / MD designation.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Everyone's scores are visible",
        "detail": "Anyone who can view the scoreboard sees every person's row.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open Executive Scoreboard.",
      "Choose week, month or year and a site.",
      "Read each person's KRA 1 and KRA 2 miss % and score.",
      "Authorised users set Next Goal and MD adjustment inline.",
      "The Home Scoreboard card shows the same week's figures."
    ],
    "warnings": [
      {
        "title": "Scores are recalculated each time",
        "detail": "Changing a task's status or due date later changes past scores.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Non-functional checklist items: requires verification whether they are excluded from the scoreboard's planned count."
    ]
  },
  {
    "key": "work_queue.activity",
    "portal": "employee",
    "paths": [
      "/wq/activities",
      "/activities"
    ],
    "title": "Activities",
    "overview": {
      "what": "A timeline of changes to delegated tasks: created, status changed, subtasks, remarks, due-date revisions, deletes, restores and buddy hand-overs.",
      "why": "So managers can see who changed what and when.",
      "users": [
        "Super Admin",
        "Admin",
        "Management"
      ]
    },
    "functions": [
      {
        "title": "Filter",
        "detail": "By date range, person, type and search text."
      },
      {
        "title": "Open task",
        "detail": "Open the related task's detail drawer."
      }
    ],
    "connections": [
      {
        "module": "Tasks / Delegation",
        "key": "work_queue.tasks",
        "why": "Source of entries",
        "data": "Activity entries written by task actions",
        "direction": "one-way",
        "trigger": "Task actions",
        "verified": true
      },
      {
        "module": "Buddy rotation job",
        "key": null,
        "why": "Hand-overs of delegated tasks are logged",
        "data": "'Automatically assigned to…' / 'Returned to…'",
        "direction": "one-way",
        "trigger": "Job every 15 min",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Viewing",
        "effect": "Read-only. Nothing is changed.",
        "kind": "historical",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Separate permission",
        "detail": "Needs 'view Work Queue activity', held by Management; Admin and Super Admin hold it through full access. Task doers do not.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Checklist changes are not here",
        "detail": "Only delegated-task actions write to this log. Checklist reassigns and buddy events go to the system audit log.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Open Activities.",
      "Pick a date range (default: this month).",
      "Filter by person or type.",
      "Click an entry to open the task."
    ],
    "warnings": [],
    "unverified": []
  },
  {
    "key": "work_queue.trash",
    "portal": "employee",
    "paths": [
      "/wq/deletedtasks",
      "/deleted-tasks"
    ],
    "title": "Deleted Tasks",
    "overview": {
      "what": "Every deleted delegated task in the company, with who deleted it and when. Tasks can be restored from here.",
      "why": "Deleting is reversible; this is where mistakes are undone.",
      "users": [
        "Super Admin",
        "Admin"
      ]
    },
    "functions": [
      {
        "title": "Browse and filter",
        "detail": "Search, status, priority, category, assigned by, tag and date range."
      },
      {
        "title": "Restore",
        "detail": "Put a task back into the active lists."
      }
    ],
    "connections": [
      {
        "module": "Tasks / Delegation",
        "key": "work_queue.tasks",
        "why": "Deleted tasks come from there and go back there",
        "data": "The task's deleted flag",
        "direction": "two-way",
        "trigger": "Delete or Restore",
        "verified": true
      },
      {
        "module": "Activity Log",
        "key": "work_queue.activity",
        "why": "Deletes and restores are logged",
        "data": "'Task Deleted' / 'Task Restored'",
        "direction": "one-way",
        "trigger": "Delete or Restore",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Restoring a task",
        "effect": "It reappears in My Work, Delegation and All Tasks, and counts on the Scoreboard again.",
        "kind": "multi",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Separate permission",
        "detail": "Needs 'manage Work Queue trash'. Only Admin and Super Admin hold it by default; other roles need it ticked in Roles & Permissions.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Restore also needs ownership",
        "detail": "Only the task's assigner or a manager can restore it.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "No permanent delete",
        "detail": "Tasks stay in the bin; there is no purge.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Only delegated tasks",
        "detail": "Checklist items are not soft-deleted and never appear here. Order-stage tasks cannot be deleted.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Open Deleted Tasks.",
      "Search or filter for the task.",
      "Check who deleted it and when.",
      "Click Restore. The task returns to the active lists."
    ],
    "warnings": [
      {
        "title": "Shows everyone's deleted work",
        "detail": "Grant this only to administrators.",
        "severity": "warning"
      }
    ],
    "unverified": []
  }
];
