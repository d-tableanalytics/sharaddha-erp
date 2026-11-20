/**
 * "About this module" documentation: HRMS.
 *
 * GENERATED from the module audit; edit the text here directly when a screen
 * changes. The code each statement was verified against is listed in
 * docs/module-documentation-map.md, not here, so no source paths ship to the
 * browser. `verified: false` items show as "Requires verification".
 */
export default [
  {
    "key": "hrms.dashboard",
    "portal": "employee",
    "paths": [
      "/hrms",
      "/hrms/dashboard"
    ],
    "title": "Dashboard",
    "overview": {
      "what": "The HRMS home page. It shows quick links, upcoming holidays, announcements, polls and birthdays/anniversaries. Managers and HR also see team or company figures.",
      "why": "One place to see what needs attention today without opening each HR module.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "Payroll Admin",
        "Recruiter",
        "IT / Asset Admin",
        "Auditor",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Quick access",
        "detail": "Shows shortcut tiles such as Clock In / Out, Apply for Leave, My Payslip, Submit Expense, Raise Ticket, Team Approvals, Add Employee and Run Payroll. You only see the tiles your permissions allow."
      },
      {
        "title": "Upcoming holidays",
        "detail": "The next six holidays from the holiday calendar kept in Leave → Holidays."
      },
      {
        "title": "Announcements and active polls",
        "detail": "The latest published announcements and open polls from Engage that are aimed at you."
      },
      {
        "title": "Celebrations",
        "detail": "Birthdays and work anniversaries in the next 14 days, for the whole company."
      },
      {
        "title": "On leave today / Clocked in from mobile",
        "detail": "For managers and HR: who in your team is on approved leave today, and who clocked in from a phone."
      },
      {
        "title": "Key metrics and Pending actions",
        "detail": "For HR and admins who can see all employees: headcount (total, active, probation, notice, not yet registered), pending leave requests and attendance corrections, new hires and exits in the last 30 days."
      },
      {
        "title": "Your team",
        "detail": "For reporting managers: number of direct reports, how many are on leave today, and pending leave requests."
      },
      {
        "title": "Login activity",
        "detail": "Sign-ins per day (7, 14 or 30 days). Only shown to people with HR audit log access."
      }
    ],
    "connections": [
      {
        "module": "Leave",
        "key": "hrms.leave",
        "why": "On-leave-today list, pending leave counts and holiday list.",
        "data": "Approved and pending leave requests; holidays",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "Attendance",
        "key": "hrms.attendance",
        "why": "Mobile clock-ins today and pending corrections count.",
        "data": "Today's attendance records; pending corrections",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Headcount, new hires, exits, celebrations and the greeting name.",
        "data": "Employee status, joining date, birth date",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "Engage",
        "key": "hrms.engage",
        "why": "Announcements and polls widgets reuse Engage's own targeting and expiry rules.",
        "data": "Published announcements, open polls",
        "direction": "one-way",
        "trigger": "Page load",
        "verified": true
      },
      {
        "module": "HR Audit Logs",
        "key": "hrms.audit",
        "why": "Login activity chart counts sign-in audit entries.",
        "data": "Login audit rows",
        "direction": "one-way",
        "trigger": "Page load (audit permission only)",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Opening the dashboard",
        "effect": "Nothing is changed. Every figure is read from the module that owns it.",
        "kind": "historical",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "What you see depends on your scope",
        "detail": "Company figures need 'view all employees'. Team figures need leave approval for your team. Everyone else gets only the personal widgets.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Each widget loads on its own",
        "detail": "If one widget fails, the rest of the page still shows.",
        "kind": "automation",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → HR Dashboard.",
      "Use a Quick access tile to jump to the task you need.",
      "Check Upcoming holidays and Announcements.",
      "If you are a manager, review Your team and the pending leave count.",
      "Click a pending action to open its approval queue in Leave or Attendance."
    ],
    "warnings": [],
    "unverified": []
  },
  {
    "key": "hrms.inbox",
    "portal": "employee",
    "paths": [
      "/hrms/inbox"
    ],
    "title": "Inbox",
    "overview": {
      "what": "Your personal list of HR notifications: things waiting for your approval, decisions on your requests, announcements and updates.",
      "why": "So approvers and employees learn about requests and decisions without checking every module.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "Payroll Admin",
        "Recruiter",
        "IT / Asset Admin",
        "Auditor",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Filter",
        "detail": "Switch between All, Unread and Read, and filter by category (action, decision, announcement, update)."
      },
      {
        "title": "Open an item",
        "detail": "Each item links to the screen where you act on it, for example Leave → Approvals or Expenses → Approval Queue."
      },
      {
        "title": "Mark read / unread",
        "detail": "Mark one item, several, or everything as read. You can mark an item unread again."
      },
      {
        "title": "Archive",
        "detail": "Moves items out of the main list. Archived items stay readable under Archived."
      }
    ],
    "connections": [
      {
        "module": "Leave",
        "key": "hrms.leave",
        "why": "A new request notifies the approver; a decision notifies the requester.",
        "data": "'Leave request' and 'Leave decision' items",
        "direction": "one-way",
        "trigger": "Leave applied / approved / rejected",
        "verified": true
      },
      {
        "module": "Attendance",
        "key": "hrms.attendance",
        "why": "Corrections notify the reporting manager, and the decision notifies the employee.",
        "data": "'Attendance correction' and 'Correction decision' items",
        "direction": "one-way",
        "trigger": "Correction submitted / decided",
        "verified": true
      },
      {
        "module": "Expenses",
        "key": "hrms.expenses",
        "why": "A submitted claim notifies the manager; a decision notifies the claimant.",
        "data": "'Expense claim' and 'Expense decision' items",
        "direction": "one-way",
        "trigger": "Claim submitted / decided",
        "verified": true
      },
      {
        "module": "Exits, Documents, Engage, Helpdesk, Hiring, Onboarding, Assets, Performance, SI Academy",
        "key": null,
        "why": "These modules also file inbox items (exit requests and clearances, policies, announcements, recognition, tickets, interviews, requisitions, offer letters, onboarding tasks, assets, reviews, training).",
        "data": "Inbox items of each type",
        "direction": "one-way",
        "trigger": "Business event in that module",
        "verified": true
      },
      {
        "module": "Work Queue (Delegation / Checklist)",
        "key": null,
        "why": "Buddy System tasks and 'no available assignee' alerts appear here and link out of HRMS to the Work Queue.",
        "data": "'Task assigned to you' and 'No available assignee' items",
        "direction": "one-way",
        "trigger": "Delegation buddy assignment; buddy rotation job",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Any of the events above",
        "effect": "An inbox item is written for each recipient. For seven event types an email is also sent, but only when the server has HR mail switched on.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Mark all read / mark selected read / archive",
        "effect": "The items change only for you. An audit entry records how many items were cleared, without their titles.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Only your own items",
        "detail": "The server always filters by your own employee record. An account without an employee record has an empty inbox.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "No one creates items by hand",
        "detail": "Items come only from business events. There is no screen or API to post one.",
        "kind": "automation",
        "verified": true
      },
      {
        "title": "Emails are off by default",
        "detail": "Emails go out only when the server setting HRMS_MAIL_ENABLED is 'true'. They cover leave requests and decisions, correction requests and decisions, expense requests, exit requests and offer letters.",
        "kind": "automation",
        "verified": true
      },
      {
        "title": "A notification never blocks the action",
        "detail": "If writing a notification fails, the leave, claim or other action still goes through.",
        "kind": "automation",
        "verified": true
      },
      {
        "title": "Old read items may be swept",
        "detail": "The retention sweep can remove or archive old READ items once a window is set. Unread items are never swept. By default they are kept.",
        "kind": "expiry",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → Inbox.",
      "Choose Unread to see what is new.",
      "Click an item to open the screen where you act on it.",
      "Approve or reject there; the requester gets a decision item in their own Inbox.",
      "Mark items read or archive them to keep the list short."
    ],
    "warnings": [
      {
        "title": "Email is not guaranteed",
        "detail": "If HR mail is switched off on the server, or you have no active login, you get the inbox item but no email.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "The 15-second unread badge refresh is described in code comments; the frontend polling interval was not checked."
    ]
  },
  {
    "key": "hrms.me",
    "portal": "employee",
    "paths": [
      "/hrms/me"
    ],
    "title": "My Profile",
    "overview": {
      "what": "A shortcut that opens your own employee record.",
      "why": "So any employee can see and update their own details without searching the directory.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "Payroll Admin",
        "Recruiter",
        "IT / Asset Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Open my record",
        "detail": "Sends you straight to your employee profile (the same page HR sees)."
      },
      {
        "title": "Edit my own details",
        "detail": "The baseline lets every employee edit their own record, within what the server allows."
      },
      {
        "title": "No record message",
        "detail": "If your login has no employee record, the page says so instead of showing an error."
      }
    ],
    "connections": [
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "My Profile is a redirect to your own employee profile.",
        "data": "Your employee id",
        "direction": "one-way",
        "trigger": "Opening the page",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Saving changes to your own profile",
        "effect": "Your employee record is updated and an audit entry is written.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Needs view-own-record permission",
        "detail": "Held by every HRMS role except Auditor (Auditor has no self-service baseline).",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → My Profile.",
      "Review your Job, Contact, Address and Emergency contact sections.",
      "Click Edit to change what you are allowed to change.",
      "Save; the change shows on your profile immediately."
    ],
    "warnings": [],
    "unverified": [
      "Exactly which fields an employee may change on their own record (self edit) was not traced field by field."
    ]
  },
  {
    "key": "hrms.employees",
    "portal": "employee",
    "paths": [
      "/hrms/employees",
      "/hrms/employees/:id",
      "/hrms/employees/:id/edit"
    ],
    "title": "Employees",
    "overview": {
      "what": "The employee master: the people directory with personal details, job details, reporting manager, department, location, and the linked login.",
      "why": "Every other HR module (leave, attendance, payroll, expenses) works from this record and its reporting line.",
      "users": [
        "Reporting Manager (own team)",
        "HR Admin",
        "Recruiter",
        "Auditor (read-only)",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Directory",
        "detail": "Search and filter by status, department and location. Managers see only their own reporting tree."
      },
      {
        "title": "Add employee",
        "detail": "Opens a drawer. Creating an employee also creates their login with a one-time temporary password and the Employee HRMS role."
      },
      {
        "title": "Profile",
        "detail": "Sections for Job, Contact, Probation, Notice period, Family, Address, Emergency contacts, Identifiers & bank details, and Additional fields."
      },
      {
        "title": "Reveal sensitive fields",
        "detail": "PAN, Aadhaar, UAN, bank account and IFSC are masked. Revealing one is logged."
      },
      {
        "title": "Edit",
        "detail": "Full edit page. Changing the reporting manager rebuilds the reporting chain."
      },
      {
        "title": "HRMS roles",
        "detail": "Admins can view and change which HRMS roles the employee's login holds."
      },
      {
        "title": "Reset password",
        "detail": "Issues a new temporary password for the employee's login."
      },
      {
        "title": "Deactivate",
        "detail": "Soft delete: the record stays but is marked exited, and the login is suspended."
      },
      {
        "title": "Delete permanently",
        "detail": "Erases the employee, their login and all HR records about them after you type the employee code to confirm."
      }
    ],
    "connections": [
      {
        "module": "Portal User accounts",
        "key": null,
        "why": "Each employee is linked to a portal login, which is created with the employee.",
        "data": "Email, display name, HRMS roles, status, password",
        "direction": "two-way",
        "trigger": "Create / edit / deactivate / reset password / delete",
        "verified": true
      },
      {
        "module": "Org Structure",
        "key": "hrms.org",
        "why": "Department and location must exist before they can be set on an employee.",
        "data": "Department id, location id",
        "direction": "one-way",
        "trigger": "Create / edit employee",
        "verified": true
      },
      {
        "module": "Leave, Expenses, Attendance approvals",
        "key": "hrms.leave",
        "why": "The reporting manager on this record is the approver for leave, expense claims and attendance corrections.",
        "data": "Reporting manager and reporting chain",
        "direction": "one-way",
        "trigger": "Request submitted",
        "verified": true
      },
      {
        "module": "SI Academy",
        "key": "hrms.academy",
        "why": "Automatic training rules run when a new employee is created.",
        "data": "New employee",
        "direction": "one-way",
        "trigger": "Employee created",
        "verified": true
      },
      {
        "module": "Payroll",
        "key": "hrms.payroll",
        "why": "Payroll pays employees by their compensation entry and pay group.",
        "data": "Employee id, compensation",
        "direction": "one-way",
        "trigger": "Payroll run compute",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Creating an employee",
        "effect": "A login is created with the Employee role (or the roles you pick) and a temporary password shown once. Matching SI Academy training is assigned. An audit entry is written.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Changing the reporting manager",
        "effect": "The reporting chain is recomputed. This changes who approves this person's leave, expenses and corrections, and who sees them under team scope.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Deactivating",
        "effect": "The record is marked exited and hidden. The login is suspended and signed out everywhere.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Delete permanently",
        "effect": "Erases the employee, login, attendance, leave, payslips, documents, exit, claims, tickets, training, goals and inbox. Approvals they gave on other people's records stay. Past payroll run totals stay unchanged.",
        "kind": "multi",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Who can see whom",
        "detail": "View all needs 'employees view all' (HR Admin, Recruiter, Auditor, Super Admin). Managers see their reporting tree. Everyone can see their own record.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Who can create, edit, delete",
        "detail": "Create: HR Admin and Super Admin. Edit: HR Admin, Recruiter, Super Admin. Deactivate and permanent delete: Super Admin only.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Sensitive fields are encrypted",
        "detail": "PAN, Aadhaar, UAN, bank account and IFSC are stored encrypted. Viewing one in full is recorded in the audit log.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "No reporting loops",
        "detail": "A manager change that would create a loop (A reports to B, B reports to A) is refused.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Deactivate refuses managers",
        "detail": "You cannot deactivate someone who still has direct reports. Reassign them first.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Permanent delete refuses",
        "detail": "Refused for yourself, for someone with direct reports, and for the last active Super Admin. Assets still issued do not block it.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Customers cannot hold HRMS roles",
        "detail": "A customer-portal-only login can never be given an HRMS role.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → Employees.",
      "Click Add employee and fill in name, email, department, location and reporting manager.",
      "Save, and hand the one-time temporary password to the employee.",
      "Open the employee's profile to check details; use Edit to change them.",
      "Leave, expense and attendance requests from this employee now go to the reporting manager you set."
    ],
    "warnings": [
      {
        "title": "Permanent delete cannot be undone",
        "detail": "It erases the login and every HR record about the person. Use Deactivate when someone leaves.",
        "severity": "irreversible"
      },
      {
        "title": "Temporary password is shown once",
        "detail": "It is not stored in readable form. If lost, use Reset password.",
        "severity": "warning"
      },
      {
        "title": "Manager changes move approvals",
        "detail": "Changing a reporting manager changes who approves this person's requests from then on.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Whether existing pending leave or expense requests are re-routed when a manager changes was not traced (approval steps store the approver at submit time)."
    ]
  },
  {
    "key": "hrms.org",
    "portal": "employee",
    "paths": [
      "/hrms/org",
      "/hrms/org/:tab"
    ],
    "title": "Org Structure",
    "overview": {
      "what": "Departments, locations, custom employee fields, and the org chart.",
      "why": "Gives every employee a department, a work location and a place in the reporting tree.",
      "users": [
        "Reporting Manager (org chart)",
        "HR Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Departments",
        "detail": "Create, edit and delete departments (code, name, parent department)."
      },
      {
        "title": "Locations",
        "detail": "Create, edit and delete work locations (code, name, address, city, country, timezone)."
      },
      {
        "title": "Custom Fields",
        "detail": "Add extra fields that appear on employee profiles under Additional fields."
      },
      {
        "title": "Org Chart",
        "detail": "Tree built from each employee's reporting manager. HR sees the whole company; a manager sees their own team."
      }
    ],
    "connections": [
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Employees pick their department and location from here; the org chart is drawn from employees' reporting managers.",
        "data": "Department, location, reporting manager",
        "direction": "two-way",
        "trigger": "Employee create / edit",
        "verified": true
      },
      {
        "module": "Dashboard, Hiring, Planning, Engage, SI Academy, Payroll, Leave",
        "key": null,
        "why": "These modules read department or location to label, target or group records.",
        "data": "Department and location ids",
        "direction": "one-way",
        "trigger": "Their own screens",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Create / edit / delete a department or location",
        "effect": "Saved and recorded in the HR audit log.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Renaming a department",
        "effect": "Every employee, dashboard and report shows the new name, because records point to the department, not its name.",
        "kind": "multi",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Cannot delete what is in use",
        "detail": "A department or location that still has active employees cannot be deleted.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Who can edit",
        "detail": "Editing needs 'org structure edit' (HR Admin and Super Admin). Other users only see the Org Chart tab.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Org chart scope",
        "detail": "The whole chart needs 'view all employees' or 'org structure edit'; others see only their own subtree.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → Org Structure.",
      "On Departments, add or edit a department.",
      "On Locations, add or edit a work location.",
      "Assign them to people in Employees → Edit.",
      "Open Org Chart to check the reporting tree."
    ],
    "warnings": [],
    "unverified": [
      "There is no designations list: designation is a free-text field on each employee.",
      "Reporting lines are set on each employee in Employees, not on this screen."
    ]
  },
  {
    "key": "hrms.attendance",
    "portal": "employee",
    "paths": [
      "/hrms/attendance",
      "/hrms/attendance/:tab"
    ],
    "title": "Attendance",
    "overview": {
      "what": "Clock in and out each day, see your attendance history, ask for corrections, and (for managers and HR) see the team grid.",
      "why": "Keeps a daily record of who worked and for how long.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "Recruiter",
        "Auditor (read-only)",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "My Attendance",
        "detail": "Clock In / Clock Out once per day, with an optional selfie and location. Shows your history and each day's status (Absent, On the clock, Full day, etc.)."
      },
      {
        "title": "Consent",
        "detail": "You choose whether to allow selfie capture and location capture. Without consent you can still punch; a selfie or location sent without consent is refused."
      },
      {
        "title": "Team",
        "detail": "A grid of your team's (or everyone's) attendance. Needs team or company view."
      },
      {
        "title": "Corrections",
        "detail": "Ask to fix a wrong or missing punch. Approvers see 'Corrections (approvals)'."
      },
      {
        "title": "Biometric devices",
        "detail": "A punch clock can send punches to the server through a signed webhook, when a secret is configured."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "A correction notifies the reporting manager; the decision notifies the employee.",
        "data": "Correction pending / decided items (and email if enabled)",
        "direction": "one-way",
        "trigger": "Correction submitted / decided",
        "verified": true
      },
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Only active employees can punch; team scope uses the reporting chain.",
        "data": "Employee status, reporting chain",
        "direction": "one-way",
        "trigger": "Punch / list",
        "verified": true
      },
      {
        "module": "Dashboard",
        "key": "hrms.dashboard",
        "why": "Shows mobile clock-ins today and pending corrections.",
        "data": "Attendance records, corrections",
        "direction": "one-way",
        "trigger": "Dashboard load",
        "verified": true
      },
      {
        "module": "Payroll",
        "key": "hrms.payroll",
        "why": "Not connected: payroll does not read attendance. Loss of pay comes from unpaid leave only.",
        "data": "None",
        "direction": "one-way",
        "trigger": "—",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Clock in / clock out",
        "effect": "Today's attendance record is written and an audit entry is made. The location name is looked up afterwards (OpenStreetMap), so the punch never waits for it.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Approving a correction",
        "effect": "The attendance record for that day is created or changed to the corrected times, and the employee is notified.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Selfie retention sweep",
        "effect": "Old selfie photos are deleted after the configured window. The attendance record itself is kept.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "One punch in and out per day",
        "detail": "A second clock-in, or clock-out without clock-in, is refused.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Cannot decide your own correction",
        "detail": "Corrections are decided by someone with attendance approval for the team (reporting manager) or for the company (HR Admin, Recruiter, Super Admin).",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "Selfie and location need consent",
        "detail": "Consent is recorded per purpose and can be changed by the employee.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Status is calculated",
        "detail": "No clock-in = Absent; clocked in only = On the clock; a full day depends on hours worked.",
        "kind": "automation",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → Attendance → My Attendance.",
      "Set your selfie and location consent if you want to use them.",
      "Click Clock In at the start of the day and Clock Out at the end.",
      "If a day is wrong, raise a correction from My Attendance.",
      "Your manager approves it under Corrections; the fixed day shows in your history."
    ],
    "warnings": [
      {
        "title": "Selfie photos are deleted later",
        "detail": "Photos are removed after the retention window. The punch times remain.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "The exact retention window for selfies is configured in HR settings, not in code (code comment states 90 days).",
      "The retention sweep cron is off in this portal by default (HRMS_RETENTION_CRON); code says the Customer Portal still runs it."
    ]
  },
  {
    "key": "hrms.leave",
    "portal": "employee",
    "paths": [
      "/hrms/leave",
      "/hrms/leave/:tab"
    ],
    "title": "Leave",
    "overview": {
      "what": "Apply for leave, see your balance, approve your team's requests, see who is away, and keep the holiday calendar.",
      "why": "Records time off with a manager's approval and feeds unpaid leave into payroll.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "Auditor (read-only)",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "My Leave",
        "detail": "Apply for leave (full day, half day, hours, or mixed), see balances and cancel a pending request."
      },
      {
        "title": "Approvals",
        "detail": "Approve or reject requests waiting for you."
      },
      {
        "title": "Team Calendar",
        "detail": "Who is on leave in your team or the company."
      },
      {
        "title": "Holidays",
        "detail": "The holiday calendar by year. HR can add, edit and delete holidays."
      },
      {
        "title": "Leave types",
        "detail": "HR can create leave types, mark them paid or unpaid, and mark some as HR-only."
      }
    ],
    "connections": [
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "The employee's direct reporting manager is the approver.",
        "data": "Reporting manager",
        "direction": "one-way",
        "trigger": "Leave applied",
        "verified": true
      },
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Approver is told about a new request; requester is told the decision.",
        "data": "Leave request / Leave decision items (and email if enabled)",
        "direction": "one-way",
        "trigger": "Apply / decide",
        "verified": true
      },
      {
        "module": "Payroll",
        "key": "hrms.payroll",
        "why": "Approved leave of an unpaid type becomes loss-of-pay days in the payroll run. Holidays inside the leave are not docked.",
        "data": "Approved leave requests, leave type paid flag, holidays",
        "direction": "one-way",
        "trigger": "Payroll run compute",
        "verified": true
      },
      {
        "module": "Exits",
        "key": "hrms.exits",
        "why": "Final settlement reads leave balances.",
        "data": "Leave balances",
        "direction": "one-way",
        "trigger": "Full & final computation",
        "verified": true
      },
      {
        "module": "Dashboard",
        "key": "hrms.dashboard",
        "why": "On leave today, pending leave counts and upcoming holidays.",
        "data": "Leave requests, holidays",
        "direction": "one-way",
        "trigger": "Dashboard load",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Applying for leave",
        "effect": "A pending request is created, the days are held as 'pending' on the balance, the manager gets an inbox item, and an audit entry is written.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Approving leave",
        "effect": "The request becomes approved, the balance moves from pending to used, and the employee is notified. If the type is unpaid, the next payroll run docks those days.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Cancelling a pending request",
        "effect": "The request becomes cancelled and the pending days are released.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Adding or removing a holiday",
        "effect": "Changes leave day counts for new requests and the loss-of-pay count in the next payroll compute.",
        "kind": "multi",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Only the direct manager or HR decides",
        "detail": "A skip-level manager can see but not decide. HR Admin and Super Admin can decide any request. Nobody can decide their own.",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "No manager means auto-approved",
        "detail": "If the employee has no reporting manager, or the manager's record was deleted, the request is approved at once.",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "Balance is not enforced",
        "detail": "A request is never refused for low balance. Balances only move if a balance row exists.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "No overlaps",
        "detail": "A request that overlaps one of your live requests is refused.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "HR-only types",
        "detail": "Some leave types can only be granted by people with leave admin rights.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Only pending requests can be cancelled",
        "detail": "Only the requester can cancel, and only while it is pending.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → Leave → My Leave.",
      "Click Apply, choose the leave type and dates, and add a reason.",
      "Submit; your manager gets it in their Inbox.",
      "Your manager approves or rejects it under Leave → Approvals.",
      "You see the decision in your Inbox and in My Leave; unpaid leave appears as loss of pay on that month's payslip."
    ],
    "warnings": [
      {
        "title": "Missing manager skips approval",
        "detail": "Employees without a reporting manager get every leave approved automatically. Set a manager in Employees.",
        "severity": "warning"
      },
      {
        "title": "Approved leave cannot be cancelled here",
        "detail": "Only pending requests can be cancelled.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "No leave accrual job exists in code: balance rows are created only by the employee import. There is no monthly accrual cron.",
      "A code comment says a deleted manager 'falls to the HR override', but the code auto-approves in that case. Requires confirmation of intended behaviour."
    ]
  },
  {
    "key": "hrms.payroll",
    "portal": "employee",
    "paths": [
      "/hrms/payroll",
      "/hrms/payroll/:tab"
    ],
    "title": "Payroll",
    "overview": {
      "what": "Monthly salary runs, payslips, salary structures, pay groups and statutory settings (PF, ESI, PT, LWF, TDS).",
      "why": "Calculates each employee's monthly pay and deductions the same way every time and publishes payslips.",
      "users": [
        "Employee (own payslips)",
        "Payroll Admin",
        "HR Admin (view)",
        "Recruiter (advance decisions)",
        "Auditor (read-only)",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Overview and Payslips",
        "detail": "Everyone sees their own payslips. People with company payroll view see all."
      },
      {
        "title": "Runs",
        "detail": "Create a run for a pay group and month, compute it, review, lock, then mark disbursed. A run can be rolled back to draft before locking. Manual adjustments can be added to a run."
      },
      {
        "title": "Structures and components",
        "detail": "Salary structures made of earning and deduction components."
      },
      {
        "title": "Pay Groups",
        "detail": "Groups of employees paid together in one run."
      },
      {
        "title": "Statutory",
        "detail": "PF, ESI, PT, LWF and TDS settings with effective dates."
      },
      {
        "title": "Compensation (employee salary)",
        "detail": "Each employee's salary entry (structure, pay group, annual CTC) with effective dates. Super Admin only. The default is Rs 10,000 a month (Rs 1,20,000 annual CTC). No screen of its own; maintained through the payroll API under 'employee compensation'."
      }
    ],
    "connections": [
      {
        "module": "Leave",
        "key": "hrms.leave",
        "why": "Approved leave of unpaid types becomes loss-of-pay days; holidays inside the leave are not docked.",
        "data": "Approved leave, leave type paid flag, holiday calendar",
        "direction": "one-way",
        "trigger": "Compute run",
        "verified": true
      },
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Who is paid and how much comes from each employee's compensation entry in the pay group.",
        "data": "Compensation, state for PT/LWF",
        "direction": "one-way",
        "trigger": "Compute run",
        "verified": true
      },
      {
        "module": "Attendance",
        "key": "hrms.attendance",
        "why": "Not connected: payroll does not read attendance punches.",
        "data": "None",
        "direction": "one-way",
        "trigger": "—",
        "verified": true
      },
      {
        "module": "Expenses",
        "key": "hrms.expenses",
        "why": "Not connected: reimbursed claims are not added to payslips.",
        "data": "None",
        "direction": "one-way",
        "trigger": "—",
        "verified": true
      },
      {
        "module": "Exits",
        "key": "hrms.exits",
        "why": "Final settlement reads the employee's compensation.",
        "data": "Compensation",
        "direction": "one-way",
        "trigger": "Full & final computation",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Compute a run",
        "effect": "Payslips are calculated for everyone in the pay group from compensation, structure, statutory settings, adjustments and unpaid leave. The run moves to review.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Lock a run",
        "effect": "Payslips become visible to employees and can no longer change.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Disburse a run",
        "effect": "The run is marked paid. Nothing can change after this.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Every run step, compensation and statutory change",
        "effect": "Recorded in the HR audit log.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Run order",
        "detail": "Draft → compute → review → lock → disbursed. Rollback is only possible before locking.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Who runs payroll",
        "detail": "Only Payroll Admin and Super Admin can create, compute, lock, disburse or roll back runs. HR Admin can view but not run.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Who edits structures",
        "detail": "Structures, components, pay groups and statutory settings need 'payroll structure edit' (Payroll Admin, Super Admin).",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Who edits salary",
        "detail": "Employee compensation is Super Admin only — viewing and editing. No other role reaches it, including Payroll Admin and HR, and ticking the permission for another role has no effect. The same restriction covers anyone else's payslip and a final-settlement amount, because each one is an individual's salary. An employee still sees their own payslip.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Employees see only locked runs",
        "detail": "A payslip appears to an employee only once its run is locked or disbursed.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Payroll does not read the clock",
        "detail": "The month being run decides the dates, so recomputing gives the same result.",
        "kind": "automation",
        "verified": true
      }
    ],
    "steps": [
      "Set up components, structures, pay groups and statutory settings (Payroll Admin).",
      "Make sure each employee has a compensation entry in a pay group.",
      "Open Payroll → Runs, create a run for the pay group and month.",
      "Click Compute and check the payslips; add adjustments and recompute if needed.",
      "Lock the run; employees now see their payslip under Payroll → Payslips.",
      "After paying, mark the run Disbursed."
    ],
    "warnings": [
      {
        "title": "Locking is final",
        "detail": "After a run is locked, its payslips cannot be changed or rolled back.",
        "severity": "irreversible"
      },
      {
        "title": "Approve leave before computing",
        "detail": "Leave approved after the run is computed is not counted unless the run is rolled back and recomputed before locking.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "No email or inbox notification is sent when payslips are published (no notify call in payroll was found).",
      "Payslip PDF generation (pdfKey field) was not traced."
    ]
  },
  {
    "key": "hrms.expenses",
    "portal": "employee",
    "paths": [
      "/hrms/expenses",
      "/hrms/expenses/:tab"
    ],
    "title": "Expenses",
    "overview": {
      "what": "File expense claims with receipts, get them approved by your manager and finance, and track reimbursement.",
      "why": "Gives every work expense a two-step approval and a record of when it was repaid.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "Payroll Admin (finance)",
        "Auditor (read-only)",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "My Claims",
        "detail": "Create a draft claim with one or more lines, attach a receipt to each line, edit the draft, then submit."
      },
      {
        "title": "Approval Queue",
        "detail": "Approvers see claims waiting for them and approve or reject with a comment."
      },
      {
        "title": "Reimburse",
        "detail": "Finance marks a finance-approved claim as reimbursed."
      },
      {
        "title": "Categories",
        "detail": "Company-level approvers manage expense categories and their policy (daily and monthly limits, auto-approve amount, receipt required)."
      }
    ],
    "connections": [
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "The claimant's reporting manager is the first approver.",
        "data": "Reporting manager",
        "direction": "one-way",
        "trigger": "Claim submitted",
        "verified": true
      },
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Manager is told about a new claim; claimant is told each decision.",
        "data": "Expense claim / Expense decision items (email for new claims if enabled)",
        "direction": "one-way",
        "trigger": "Submit / decide",
        "verified": true
      },
      {
        "module": "Payroll",
        "key": "hrms.payroll",
        "why": "Not connected: 'reimbursed' is a status only; nothing is added to a payslip.",
        "data": "None",
        "direction": "one-way",
        "trigger": "—",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Submitting a claim",
        "effect": "The claim gets a two-step approval chain (manager, then finance), the manager is notified, and an audit entry is written.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Approving or rejecting",
        "effect": "One rejection ends the claim. Manager approval moves it to finance; finance approval makes it ready to reimburse. The claimant is notified each time.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Marking reimbursed",
        "effect": "The claim is closed as reimbursed with the date. Audit entry written.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Two-step approval",
        "detail": "Step 1: the direct reporting manager (or a company-level approver). Step 2: finance — anyone with company-level expense approval (HR Admin, Payroll Admin, Super Admin).",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "No manager skips step 1",
        "detail": "If the claimant has no reporting manager, the manager step is marked approved automatically and the claim goes straight to finance.",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "No self-approval",
        "detail": "You cannot approve or reimburse your own claim at any step.",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "Drafts only are editable",
        "detail": "Only the claimant can edit, and only while it is a draft. A claim needs at least one line to submit.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Reimburse only finance-approved claims",
        "detail": "A claim must be finance approved before it can be marked reimbursed.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Receipts are checked",
        "detail": "Uploaded receipts are checked to be real files; only the claimant can attach them.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS → Expenses → My Claims.",
      "Create a claim, add a line for each expense and attach the receipt.",
      "Submit; your manager gets it in their Inbox.",
      "Your manager approves under Approval Queue, then finance approves.",
      "Finance pays you outside the system and marks the claim Reimbursed; you see the status in My Claims."
    ],
    "warnings": [
      {
        "title": "Reimbursement is not paid through payroll",
        "detail": "Marking a claim reimbursed only records it. The money must be paid separately.",
        "severity": "warning"
      },
      {
        "title": "One rejection ends the claim",
        "detail": "A rejected claim cannot be resubmitted; create a new one.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Category policy limits (daily/monthly limit, auto-approve below, receipt required) are stored, but no check of them was found in the claim submit or approve flow.",
      "Whether a rejected claim can be resubmitted was inferred from the status flow, not from a test."
    ]
  },
  {
    "key": "hrms.performance",
    "portal": "employee",
    "paths": [
      "/hrms/performance",
      "/hrms/performance/:tab"
    ],
    "title": "Performance",
    "overview": {
      "what": "Goals, review cycles, continuous feedback and 1:1 meeting notes. Tabs: My goals, Reviews, Feedback, 1:1s, Cycles & calibration.",
      "why": "Gives employees and managers one place to set goals, run reviews and keep a record of feedback.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "HRMS Super Admin",
        "Auditor (read-only)"
      ]
    },
    "functions": [
      {
        "title": "My goals",
        "detail": "Create, update and delete your own goals and track progress."
      },
      {
        "title": "Reviews",
        "detail": "See reviews you must write and reviews about you; submit ratings while the cycle phase allows it."
      },
      {
        "title": "Feedback",
        "detail": "Give feedback to a colleague and read feedback you received or gave."
      },
      {
        "title": "1:1s",
        "detail": "Managers schedule 1:1s with reports; both sides keep shared notes."
      },
      {
        "title": "Cycles & calibration",
        "detail": "HR creates review cycles, moves them through phases and sees the calibration view."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Reviewers are told about new review assignments.",
        "data": "Review-assigned notice",
        "direction": "one-way",
        "trigger": "Assigning a review",
        "verified": true
      },
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Reporting lines decide who is your team and who can review whom.",
        "data": "Employee and manager records",
        "direction": "one-way",
        "trigger": "Every read",
        "verified": true
      },
      {
        "module": "Audit Logs",
        "key": "hrms.audit",
        "why": "Goal, cycle, review, feedback and 1:1 changes are logged.",
        "data": "Audit entries",
        "direction": "one-way",
        "trigger": "Each write",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Assigning a review",
        "effect": "The reviewer gets an inbox item.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Advancing a cycle phase",
        "effect": "Controls when review responses can be written (open phases only).",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Who can run cycles",
        "detail": "Creating cycles, changing phase and calibration need 'Performance approve (whole company)': HR Admin and HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Who can schedule 1:1s",
        "detail": "Managers (team approval) and HR/Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Ratings range",
        "detail": "Ratings must fall within the fixed minimum and maximum.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Goal status changes",
        "detail": "Goals can only move along allowed status transitions.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > Performance.",
      "On My goals, add a goal and set its target.",
      "Update progress as work moves.",
      "When a review is assigned, open Reviews and submit your ratings.",
      "Use Feedback to thank or coach a colleague.",
      "Your manager sees progress in the same screen for their team."
    ],
    "warnings": [
      {
        "title": "Phase controls writing",
        "detail": "Once HR moves a cycle past the review phase, responses can no longer be submitted.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Whether the HR Dashboard / home dashboard goal widget reads the same goals list (memory says a scope bug there was fixed) — not re-traced here."
    ]
  },
  {
    "key": "hrms.documents",
    "portal": "employee",
    "paths": [
      "/hrms/documents",
      "/hrms/documents/:tab"
    ],
    "title": "Documents",
    "overview": {
      "what": "The company library, policies to acknowledge, your own records and the folder tree. Tabs: Company Library, Policies, My Documents, Folders.",
      "why": "Keeps company documents and personal employment records in one controlled place, with proof that staff read key policies.",
      "users": [
        "Employee",
        "HR Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Company Library",
        "detail": "Browse and open company documents."
      },
      {
        "title": "Policies",
        "detail": "HR publishes a document as a policy; employees acknowledge it; HR sees who has and has not."
      },
      {
        "title": "My Documents",
        "detail": "Upload and manage files in your own record (for example ID or certificates)."
      },
      {
        "title": "Folders",
        "detail": "HR creates, renames and deletes folders."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Staff are told when a policy needs acknowledging.",
        "data": "Policy-published notice",
        "direction": "one-way",
        "trigger": "Publishing a policy",
        "verified": true
      },
      {
        "module": "File storage",
        "key": null,
        "why": "Files are opened through short-lived links that are checked and logged.",
        "data": "Signed read links",
        "direction": "one-way",
        "trigger": "Opening a document",
        "verified": true
      },
      {
        "module": "Data retention sweep",
        "key": null,
        "why": "Employee document files can be purged by the retention policy (default: keep forever).",
        "data": "Stored file bytes (record kept)",
        "direction": "one-way",
        "trigger": "Retention cron",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Publishing a policy",
        "effect": "Every targeted employee gets an inbox item and the policy shows as pending for them.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Opening a file",
        "effect": "A 'document viewed' audit entry is written.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "HR-only actions",
        "detail": "Folders, publishing policies and the acknowledgement report need 'Documents edit (whole company)': HR Admin and HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Upload checks",
        "detail": "Uploads have a size limit and the file content is checked against its type.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > Documents.",
      "Check Policies for anything awaiting your acknowledgement.",
      "Open the policy and click acknowledge.",
      "Use My Documents to upload your own records.",
      "HR sees acknowledgement status per policy."
    ],
    "warnings": [
      {
        "title": "Retention",
        "detail": "If HR sets a retention window, old employee files are deleted from storage; the record stays.",
        "severity": "irreversible"
      }
    ],
    "unverified": []
  },
  {
    "key": "hrms.engage",
    "portal": "employee",
    "paths": [
      "/hrms/engage",
      "/hrms/engage/:tab"
    ],
    "title": "Engage",
    "overview": {
      "what": "Announcements, polls and surveys, peer recognition and eNPS surveys. Tabs: Announcements, Polls & Surveys, Recognition, eNPS.",
      "why": "Lets HR communicate with staff and measure how they feel, and lets colleagues thank each other.",
      "users": [
        "Employee",
        "HR Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Announcements",
        "detail": "HR drafts, publishes and deletes announcements; everyone reads them."
      },
      {
        "title": "Polls & Surveys",
        "detail": "HR creates and launches polls; employees respond; only HR sees results."
      },
      {
        "title": "Recognition",
        "detail": "Any employee gives kudos with a badge; HR maintains the badge list."
      },
      {
        "title": "eNPS",
        "detail": "HR runs an employee Net Promoter Score survey; staff answer; HR sees the score."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Announcements and recognitions are pushed to people.",
        "data": "Announcement and recognition notices",
        "direction": "one-way",
        "trigger": "Publishing an announcement / giving recognition",
        "verified": true
      },
      {
        "module": "HR Dashboard",
        "key": "hrms.dashboard",
        "why": "The dashboard shows latest announcements and open polls.",
        "data": "Announcement and poll lists",
        "direction": "one-way",
        "trigger": "Opening the dashboard",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Publishing an announcement",
        "effect": "Recipients get an inbox item; it appears on the HR Dashboard.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Giving recognition",
        "effect": "The receiver gets an inbox item and it appears on the wall.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "HR controls content",
        "detail": "Creating announcements, polls, badges and eNPS surveys, and seeing results, needs 'Engage edit (whole company)': HR Admin and HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Results are HR-only",
        "detail": "A respondent sees the question, never everyone's answers.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > Engage.",
      "Read Announcements.",
      "Answer any open poll or eNPS survey.",
      "On Recognition, pick a colleague and a badge and send kudos.",
      "HR reviews results on the poll or eNPS card."
    ],
    "warnings": [],
    "unverified": [
      "Whether poll/eNPS responses are stored anonymously — not traced."
    ]
  },
  {
    "key": "hrms.helpdesk",
    "portal": "employee",
    "paths": [
      "/hrms/helpdesk",
      "/hrms/helpdesk/:tab"
    ],
    "title": "Helpdesk",
    "overview": {
      "what": "Raise a ticket with HR, Payroll or IT and follow it to resolution. Tabs: My Tickets, Resolver Queue, Knowledge Base, Categories.",
      "why": "Replaces ad-hoc requests with tracked tickets that have an owner and a deadline (SLA).",
      "users": [
        "Employee",
        "HR Admin",
        "Payroll Admin",
        "IT / Asset Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "My Tickets",
        "detail": "Raise a ticket in a category, comment on it, close it."
      },
      {
        "title": "Resolver Queue",
        "detail": "Resolvers see tickets for the areas they handle, assign them and change status."
      },
      {
        "title": "Knowledge Base",
        "detail": "Resolvers write articles; everyone can search them."
      },
      {
        "title": "Categories",
        "detail": "Super Admin maintains categories and their SLA hours."
      },
      {
        "title": "SLA",
        "detail": "Each ticket gets a due time from its category's SLA hours at creation; the screen shows overdue (breached) tickets."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "The assignee is told about a ticket assigned to them.",
        "data": "Ticket-assigned notice",
        "direction": "one-way",
        "trigger": "Assigning a ticket",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Changing a category's SLA",
        "effect": "Only new tickets use the new hours; existing tickets keep the SLA they were created with.",
        "kind": "historical",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Resolver areas",
        "detail": "HR Admin resolves HR tickets, Payroll Admin payroll tickets, IT / Asset Admin IT tickets; HRMS Super Admin resolves all.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Categories are Super Admin only",
        "detail": "Managing categories needs 'Helpdesk resolve (whole company)', held only by HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "SLA snapshot",
        "detail": "SLA hours are copied onto the ticket at creation.",
        "kind": "automation",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > Helpdesk.",
      "Search the Knowledge Base first.",
      "If not answered, go to My Tickets and raise a ticket in the right category.",
      "A resolver picks it up from the Resolver Queue.",
      "Follow comments and status on the ticket until it is resolved."
    ],
    "warnings": [],
    "unverified": [
      "No scheduled SLA escalation job was found; breach is only shown on screen."
    ]
  },
  {
    "key": "hrms.academy",
    "portal": "employee",
    "paths": [
      "/hrms/academy",
      "/hrms/academy/:tab"
    ],
    "title": "SI Academy",
    "overview": {
      "what": "Internal training: learning paths made of courses and lessons, assigned to staff, with assessments and certificates. Tabs: My Learning, Certificates, Dashboard, Learning Paths, Content Library, Assessments, Assignments, Rules, Reports.",
      "why": "Makes sure every employee completes required training and gives HR proof of completion.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "HRMS Super Admin",
        "Auditor (read-only)"
      ]
    },
    "functions": [
      {
        "title": "My Learning / Certificates",
        "detail": "Your assigned paths, progress and earned certificates."
      },
      {
        "title": "Dashboard / Reports",
        "detail": "Managers see their team's progress; HR and Auditor see everyone."
      },
      {
        "title": "Learning Paths",
        "detail": "HR builds paths from courses and lessons (opens the path builder)."
      },
      {
        "title": "Content Library",
        "detail": "HR uploads videos and files used by lessons."
      },
      {
        "title": "Assessments",
        "detail": "HR builds quizzes attached to lessons."
      },
      {
        "title": "Assignments",
        "detail": "HR assigns a path to employees with a due date, or cancels one."
      },
      {
        "title": "Rules",
        "detail": "HR defines auto-assign rules (for example by department), previews who matches, and runs them."
      }
    ],
    "connections": [
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Creating a new employee runs the auto-assign rules for them.",
        "data": "New employee -> learning assignments",
        "direction": "one-way",
        "trigger": "Employee created",
        "verified": true
      },
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Learners hear about assignments, completions, certificates and due dates.",
        "data": "Assigned, completed, certificate, due-soon and overdue notices",
        "direction": "one-way",
        "trigger": "Assigning, completing, certificate issue, daily reminder job",
        "verified": true
      },
      {
        "module": "Daily reminder job",
        "key": null,
        "why": "Sends due-soon and overdue reminders at 08:00 IST.",
        "data": "Reminder inbox items",
        "direction": "one-way",
        "trigger": "Cron, only when ACADEMY_REMINDER_CRON=enabled (off by default)",
        "verified": true
      },
      {
        "module": "Org Structure",
        "key": "hrms.org",
        "why": "Rules can target departments.",
        "data": "Department list",
        "direction": "one-way",
        "trigger": "Rule run",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Creating an employee in HRMS",
        "effect": "Matching rules assign training automatically; a rule failure does not block employee creation.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Completing all lessons of a path",
        "effect": "A certificate is issued and the learner is notified.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Revoking a certificate",
        "effect": "The certificate is marked revoked.",
        "kind": "manual",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Authoring",
        "detail": "Paths, courses, content and assessments need 'Academy edit (whole company)': HR Admin and HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Assigning and rules",
        "detail": "Need 'Academy assign (whole company)': HR Admin and HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Progress is personal",
        "detail": "Only the learner can complete their own lessons; managers and auditors read only.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > SI Academy.",
      "On My Learning, open an assigned path.",
      "Work through lessons in order.",
      "Pass any assessment.",
      "When finished, find your certificate under Certificates.",
      "HR sees completion on Dashboard and Reports."
    ],
    "warnings": [
      {
        "title": "Reminders may be off",
        "detail": "Due-soon/overdue reminders only run if the reminder job is enabled on the server.",
        "severity": "warning"
      }
    ],
    "unverified": []
  },
  {
    "key": "hrms.academy.learn",
    "portal": "employee",
    "paths": [
      "/hrms/academy/learn/:assignmentId"
    ],
    "title": "Learning path",
    "overview": {
      "what": "One assigned learning path: its courses, lessons, progress and due date.",
      "why": "Shows a learner exactly what is left to complete.",
      "users": [
        "Employee"
      ]
    },
    "functions": [
      {
        "title": "Open a lesson",
        "detail": "Pick the next lesson to open the player."
      }
    ],
    "connections": [
      {
        "module": "SI Academy",
        "key": "hrms.academy",
        "why": "Detail page of an assignment from My Learning.",
        "data": "Assignment and progress",
        "direction": "two-way",
        "trigger": "Opening an assignment",
        "verified": true
      }
    ],
    "impacts": [],
    "rules": [
      {
        "title": "Own assignments",
        "detail": "Needs 'Academy view (self)', which every employee has.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open SI Academy > My Learning.",
      "Click an assigned path.",
      "Check progress and due date.",
      "Open the next lesson."
    ],
    "warnings": [],
    "unverified": []
  },
  {
    "key": "hrms.academy.lesson",
    "portal": "employee",
    "paths": [
      "/hrms/academy/learn/:assignmentId/lesson/:lessonId"
    ],
    "title": "Lesson player",
    "overview": {
      "what": "Plays one lesson (video, file or assessment) and records completion.",
      "why": "Lets the learner complete training and have it counted.",
      "users": [
        "Employee"
      ]
    },
    "functions": [
      {
        "title": "Watch and track",
        "detail": "Video progress is saved as you watch."
      },
      {
        "title": "Mark complete / attempt",
        "detail": "Mark a lesson complete or submit an assessment attempt."
      }
    ],
    "connections": [
      {
        "module": "Audit Logs",
        "key": "hrms.audit",
        "why": "Opening lesson content is logged.",
        "data": "Content-viewed audit entry",
        "direction": "one-way",
        "trigger": "Opening content",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Completing the last lesson",
        "effect": "The path completes and a certificate is issued.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Submit permission",
        "detail": "Completing lessons needs 'Academy submit (self)', which every employee has.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open a path from My Learning.",
      "Open a lesson.",
      "Watch or read it.",
      "Mark complete or submit the assessment.",
      "Return to the path to see progress."
    ],
    "warnings": [],
    "unverified": [
      "Pass mark and retry limits for assessments not traced."
    ]
  },
  {
    "key": "hrms.academy.builder",
    "portal": "employee",
    "paths": [
      "/hrms/academy/paths/:pathId"
    ],
    "title": "Path builder",
    "overview": {
      "what": "HR's editor for one learning path: courses, lessons and their order.",
      "why": "Builds the training content employees are assigned.",
      "users": [
        "HR Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Edit structure",
        "detail": "Add, reorder and remove courses and lessons; attach content and assessments."
      }
    ],
    "connections": [
      {
        "module": "Content Library",
        "key": "hrms.academy",
        "why": "Lessons point to uploaded content.",
        "data": "Content items",
        "direction": "one-way",
        "trigger": "Adding a lesson",
        "verified": true
      }
    ],
    "impacts": [],
    "rules": [
      {
        "title": "HR only",
        "detail": "Needs 'Academy edit (whole company)'.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open SI Academy > Learning Paths.",
      "Open a path.",
      "Add courses and lessons.",
      "Reorder them.",
      "Save; assign the path from Assignments or Rules."
    ],
    "warnings": [],
    "unverified": [
      "Whether editing a path changes assignments already in progress — not traced."
    ]
  },
  {
    "key": "hrms.onboarding",
    "portal": "employee",
    "paths": [
      "/hrms/onboarding",
      "/hrms/onboarding/:tab"
    ],
    "title": "Onboarding",
    "overview": {
      "what": "Task checklists for new hires built from templates, plus in-app offer letters. Tabs: My onboarding, Checklists, Templates, Offer letters.",
      "why": "Makes sure every joiner's tasks (accounts, documents, kit) are done and tracked.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "My onboarding",
        "detail": "The new hire's own checklist, tasks and offer letters."
      },
      {
        "title": "Checklists",
        "detail": "HR starts a checklist for an employee from a template, tracks it, or cancels it."
      },
      {
        "title": "Templates",
        "detail": "HR defines reusable task lists."
      },
      {
        "title": "Offer letters",
        "detail": "HR creates an offer letter for an employee record and sends it; the employee signs or rejects in-app."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Task owners and employees are told about tasks and offer letters.",
        "data": "Onboarding-task and offer-letter-ready notices (offer letter can also email)",
        "direction": "one-way",
        "trigger": "Starting a checklist / sending an offer letter",
        "verified": true
      },
      {
        "module": "Hiring",
        "key": "hrms.hiring",
        "why": "No automatic link: accepting a Hiring offer does not create an employee or start onboarding.",
        "data": "None",
        "direction": "one-way",
        "trigger": "Manual — HR creates the employee, then starts a checklist",
        "verified": true
      },
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Checklists and offer letters hang off an employee record.",
        "data": "Employee id, department",
        "direction": "one-way",
        "trigger": "Starting a checklist",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Starting a checklist",
        "effect": "Assignees get inbox items for their tasks.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Editing a template",
        "effect": "Checklists already started are not changed.",
        "kind": "historical",
        "verified": false
      }
    ],
    "rules": [
      {
        "title": "HR controls",
        "detail": "Templates, starting/cancelling checklists and offer letters need 'Onboarding edit (whole company)': HR Admin and HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Two different offers",
        "detail": "This offer letter is for an existing employee and is signed after login. The Hiring offer is for a candidate via a public link.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "HR creates the employee in Employees.",
      "HR opens Onboarding > Checklists and starts one from a template.",
      "Task owners complete their tasks.",
      "The new hire opens My onboarding to see and sign offer letters.",
      "HR tracks progress on Checklists."
    ],
    "warnings": [],
    "unverified": [
      "Whether template edits affect running checklists."
    ]
  },
  {
    "key": "hrms.exits",
    "portal": "employee",
    "paths": [
      "/hrms/exits",
      "/hrms/exits/:tab"
    ],
    "title": "Exits",
    "overview": {
      "what": "Resignation and offboarding: approval chain, per-area clearances, full and final settlement, relieving letter. Tabs: My Exit, Exit Requests, Clearance Queue.",
      "why": "Makes sure a leaver is approved, cleared by every department and paid correctly before their record is closed.",
      "users": [
        "Employee",
        "Reporting Manager",
        "HR Admin",
        "IT / Asset Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "My Exit",
        "detail": "Resign, track status, withdraw (cancel)."
      },
      {
        "title": "Exit Requests",
        "detail": "Manager approves, then HR approves and opens clearances."
      },
      {
        "title": "Clearance Queue",
        "detail": "IT, Finance (Payroll Admin), HR/Admin and the manager each sign off their clearance."
      },
      {
        "title": "Full and final",
        "detail": "HR previews and saves the settlement (salary and leave encashment), then marks it disbursed."
      },
      {
        "title": "Relieving letter",
        "detail": "HR generates the letter once the exit is closed."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Approvers and clearance owners are told what is waiting.",
        "data": "Exit-initiated (can also email) and clearance notices",
        "direction": "one-way",
        "trigger": "Initiating an exit / opening clearances",
        "verified": true
      },
      {
        "module": "Leave",
        "key": "hrms.leave",
        "why": "Unused leave balance is used in the settlement.",
        "data": "Leave balances",
        "direction": "one-way",
        "trigger": "Settlement preview",
        "verified": true
      },
      {
        "module": "Payroll",
        "key": "hrms.payroll",
        "why": "Salary on the compensation record feeds the settlement. The settlement is NOT added to a payroll run.",
        "data": "Compensation",
        "direction": "one-way",
        "trigger": "Settlement preview",
        "verified": true
      },
      {
        "module": "Assets",
        "key": "hrms.assets",
        "why": "IT's clearance is a manual sign-off; no code checks or returns the leaver's assets.",
        "data": "None",
        "direction": "one-way",
        "trigger": "Manual",
        "verified": true
      },
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Disbursing the settlement marks the employee as exited.",
        "data": "Employee status, notice end date",
        "direction": "one-way",
        "trigger": "Disburse",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Disbursing the settlement",
        "effect": "Exit closes and the employee's status becomes exited; assets can no longer be assigned to them.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Opening clearances",
        "effect": "Clearances are routed to the first active IT Admin, Payroll Admin and HR Admin/Super Admin found, plus the manager.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Approval chain",
        "detail": "Manager approval ('Exits approve (team)': Reporting Manager), then HR approval ('Exits edit (whole company)': HR Admin, Super Admin).",
        "kind": "approval",
        "verified": true
      },
      {
        "title": "Order of steps",
        "detail": "Clearances only while awaiting clearance; disbursing only while settlement is pending; relieving letter only after close.",
        "kind": "validation",
        "verified": true
      }
    ],
    "steps": [
      "Employee opens Exits > My Exit and submits a resignation.",
      "Manager approves on Exit Requests.",
      "HR approves and opens clearances.",
      "Each area signs off in the Clearance Queue.",
      "HR saves and disburses the full and final.",
      "HR generates the relieving letter."
    ],
    "warnings": [
      {
        "title": "Disburse closes the employee",
        "detail": "Disbursing sets the employee to exited. There is no undo button.",
        "severity": "irreversible"
      },
      {
        "title": "No asset or payroll automation",
        "detail": "Collect assets and pay the settlement outside this screen.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Whether the portal login is disabled when the employee is marked exited."
    ]
  },
  {
    "key": "hrms.assets",
    "portal": "employee",
    "paths": [
      "/hrms/assets",
      "/hrms/assets/:tab"
    ],
    "title": "Assets",
    "overview": {
      "what": "Company equipment issued to staff (laptops, phones, etc.). Tabs: My Assets, Requests, Inventory, Categories. This is NOT the product stock Inventory of the Customer Portal — it never touches stock, bookings or SKUs.",
      "why": "Tracks who holds which company item and handles requests for new kit.",
      "users": [
        "Employee",
        "IT / Asset Admin",
        "HR Admin",
        "HRMS Super Admin",
        "Auditor (read-only)"
      ]
    },
    "functions": [
      {
        "title": "My Assets",
        "detail": "Items currently issued to you."
      },
      {
        "title": "Requests",
        "detail": "Request an item; IT/HR approve or reject, then fulfil by issuing an item."
      },
      {
        "title": "Inventory",
        "detail": "Add items, assign to employees, change status, take back (return)."
      },
      {
        "title": "Categories",
        "detail": "Maintain asset types."
      }
    ],
    "connections": [
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Requester, admins and holders are told about requests and assignments.",
        "data": "Request raised, request decided, asset assigned",
        "direction": "one-way",
        "trigger": "Raising/deciding a request, assigning an item",
        "verified": true
      },
      {
        "module": "Customer Portal Inventory",
        "key": null,
        "why": "No connection. Separate collections; no stock model is imported.",
        "data": "None",
        "direction": "one-way",
        "trigger": "None",
        "verified": true
      },
      {
        "module": "Exits",
        "key": "hrms.exits",
        "why": "Exited or inactive employees cannot be assigned items; exit clearance does not auto-return assets.",
        "data": "Employee status",
        "direction": "one-way",
        "trigger": "Assigning an item",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Assigning an item",
        "effect": "Item becomes 'assigned' and appears in the holder's My Assets.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Admin actions",
        "detail": "Inventory changes, categories and request decisions need 'Assets assign (whole company)': IT / Asset Admin, HR Admin, HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Inventory view",
        "detail": "Auditor can view the inventory but not change it.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > Assets.",
      "Check My Assets.",
      "On Requests, request an item.",
      "IT approves and fulfils it from Inventory.",
      "The item then shows under your My Assets."
    ],
    "warnings": [],
    "unverified": []
  },
  {
    "key": "hrms.hiring",
    "portal": "employee",
    "paths": [
      "/hrms/hiring",
      "/hrms/hiring/:tab"
    ],
    "title": "Hiring",
    "overview": {
      "what": "Recruitment: requisitions, candidates, pipeline, interviews, job postings on the public careers site, and offers. Tabs: Requisitions, Candidates, Pipeline, My interviews, Postings, Offers.",
      "why": "Runs hiring from an approved vacancy to a signed offer.",
      "users": [
        "Recruiter",
        "HR Admin",
        "HRMS Super Admin",
        "Reporting Manager (interviewer view)",
        "Auditor (read-only)"
      ]
    },
    "functions": [
      {
        "title": "Requisitions",
        "detail": "Raise a vacancy, approve it, change status (draft, approved, open, filled, cancelled)."
      },
      {
        "title": "Postings",
        "detail": "Publish a requisition to the public Careers page or close it. A JD drafting helper fills a template (no AI call)."
      },
      {
        "title": "Candidates / Pipeline",
        "detail": "Add candidates, upload resumes, move applications through stages."
      },
      {
        "title": "My interviews",
        "detail": "Schedule interviews and collect panel feedback."
      },
      {
        "title": "Offers",
        "detail": "Create an offer and send it; sending creates a one-time link shown once for HR to copy to the candidate."
      }
    ],
    "connections": [
      {
        "module": "Careers site (public)",
        "key": null,
        "why": "Published postings appear at /careers and /careers/:slug; candidates apply there; offers are read and accepted at /careers/offer/:token.",
        "data": "Postings, applications, offer decisions",
        "direction": "two-way",
        "trigger": "Publish posting / candidate applies / candidate accepts",
        "verified": true
      },
      {
        "module": "Inbox",
        "key": "hrms.inbox",
        "why": "Interviewers and requisition owners are notified.",
        "data": "Interview-scheduled, requisition-approved notices",
        "direction": "one-way",
        "trigger": "Scheduling / approving",
        "verified": true
      },
      {
        "module": "Planning",
        "key": "hrms.planning",
        "why": "Hiring plans link to requisitions.",
        "data": "Requisition reference",
        "direction": "one-way",
        "trigger": "Creating a hiring plan",
        "verified": true
      },
      {
        "module": "Onboarding",
        "key": "hrms.onboarding",
        "why": "No automatic hand-off. Acceptance only records the signature and audit entry.",
        "data": "None",
        "direction": "one-way",
        "trigger": "Manual",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Publishing a posting",
        "effect": "Role appears on the public Careers page; an approved requisition becomes open.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Candidate accepts an offer",
        "effect": "Offer is stamped accepted with signature, IP and browser; the link stops working. Requisition is not set to filled and no employee is created.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Who edits",
        "detail": "All writes need 'Hiring edit (whole company)': Recruiter, HR Admin, HRMS Super Admin. Managers only view as interviewers.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Postable requisitions",
        "detail": "Only approved or open requisitions can be published; a closed posting cannot be republished.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Offer link",
        "detail": "Link is shown once, expires after a fixed number of days, and works for one decision only.",
        "kind": "expiry",
        "verified": true
      }
    ],
    "steps": [
      "Raise and approve a requisition.",
      "Create a posting and publish it to Careers.",
      "Candidates apply; review them in Candidates and Pipeline.",
      "Schedule interviews and collect feedback.",
      "Create and send an offer; copy the link to the candidate.",
      "After acceptance, create the employee and start onboarding by hand."
    ],
    "warnings": [
      {
        "title": "Copy the offer link",
        "detail": "No email is sent to the candidate. The link is shown once; if lost, it cannot be shown again.",
        "severity": "irreversible"
      },
      {
        "title": "Requisition not auto-closed",
        "detail": "Mark the requisition filled yourself after a hire.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Memory's 'undelivered candidate email / early requisition close / unstamped retention' findings belong to a different project (Sparsh HRMS). Here: no candidate email is sent (by design, link copied manually); no early close found; no retention handler is registered for candidate resumes (bootstrap registers only audit, selfies, employee documents, inbox) — so resumes are kept indefinitely.",
      "A code comment says the offer link is mailed to the candidate, but no email is sent. HR has to copy the link and send it."
    ]
  },
  {
    "key": "hrms.planning",
    "portal": "employee",
    "paths": [
      "/hrms/planning",
      "/hrms/planning/:tab"
    ],
    "title": "Planning",
    "overview": {
      "what": "Headcount forecast and budget per department per financial year, and hiring plans compared to the pipeline. Tabs: Headcount, Hiring Plan.",
      "why": "Lets HR plan how many people each department should have and track hiring against it.",
      "users": [
        "HR Admin",
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Headcount",
        "detail": "Planned vs actual headcount per department and year; actuals counted from live employee records."
      },
      {
        "title": "Hiring Plan",
        "detail": "Plans linked to requisitions, with status and a summary."
      }
    ],
    "connections": [
      {
        "module": "Employees",
        "key": "hrms.employees",
        "why": "Actual headcount is counted from employee records.",
        "data": "Active employee counts by department",
        "direction": "one-way",
        "trigger": "Opening Headcount",
        "verified": true
      },
      {
        "module": "Hiring",
        "key": "hrms.hiring",
        "why": "Hiring plans point to a requisition.",
        "data": "Requisition",
        "direction": "one-way",
        "trigger": "Creating a hiring plan",
        "verified": true
      }
    ],
    "impacts": [],
    "rules": [
      {
        "title": "Org scope only",
        "detail": "View and edit need Planning (whole company): HR Admin and HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > Planning.",
      "Pick a financial year on Headcount.",
      "Enter planned headcount and budget per department.",
      "Compare with actual headcount.",
      "Add hiring plans on Hiring Plan and link requisitions."
    ],
    "warnings": [],
    "unverified": []
  },
  {
    "key": "hrms.reports",
    "portal": "employee",
    "paths": [
      "/hrms/reports",
      "/hrms/reports/:key"
    ],
    "title": "Reports",
    "overview": {
      "what": "Built-in HR reports with CSV export. The catalogue is built per viewer from each report's data module.",
      "why": "Gives HR quick lists without database access.",
      "users": [
        "HR Admin",
        "HRMS Super Admin",
        "Auditor (read-only)",
        "Payroll Admin",
        "Recruiter",
        "IT / Asset Admin",
        "Reporting Manager"
      ]
    },
    "functions": [
      {
        "title": "Employee directory",
        "detail": "Active employees with contact and department (needs employee access)."
      },
      {
        "title": "Monthly attendance",
        "detail": "Present, absent and leave days per employee (needs attendance access)."
      },
      {
        "title": "Leave balances",
        "detail": "Balance per leave type per employee (needs leave access)."
      },
      {
        "title": "Export CSV",
        "detail": "Download the open report."
      }
    ],
    "connections": [
      {
        "module": "Employees / Attendance / Leave",
        "key": null,
        "why": "The three reports read these records.",
        "data": "Employees, attendance records, leave balances",
        "direction": "one-way",
        "trigger": "Running a report",
        "verified": true
      },
      {
        "module": "Audit Logs",
        "key": "hrms.audit",
        "why": "Running/exporting is logged.",
        "data": "Audit entry",
        "direction": "one-way",
        "trigger": "Run/export",
        "verified": false
      }
    ],
    "impacts": [],
    "rules": [
      {
        "title": "Entry",
        "detail": "Opens for anyone with HR Reports, payroll reports, hiring reports, asset reports or team reports; each report is then hidden unless you can read its data module.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > HR Reports.",
      "Pick a report from the catalogue.",
      "Set filters.",
      "Read the table or click Export CSV."
    ],
    "warnings": [],
    "unverified": [
      "Only three reports exist; a Payroll Admin, Recruiter or IT Admin may see an empty catalogue — requires verification in the UI."
    ]
  },
  {
    "key": "hrms.settings",
    "portal": "employee",
    "paths": [
      "/hrms/settings",
      "/hrms/settings/:tab"
    ],
    "title": "Settings",
    "overview": {
      "what": "Company profile and logo, HRMS roles and custom roles, single sign-on providers and integrations. Tabs: Company Profile, Roles & Permissions, Single Sign-On, Integrations.",
      "why": "Holds HRMS-wide configuration in one place.",
      "users": [
        "HRMS Super Admin"
      ]
    },
    "functions": [
      {
        "title": "Company Profile",
        "detail": "Name, details and logo."
      },
      {
        "title": "Roles & Permissions",
        "detail": "View the HRMS role matrix; create, edit and delete custom HRMS roles."
      },
      {
        "title": "Single Sign-On / Integrations",
        "detail": "Store provider settings; secrets are encrypted."
      }
    ],
    "connections": [
      {
        "module": "Portal Roles & Permissions",
        "key": null,
        "why": "Separate from this tab. Portal grants like 'Administer HRMS' or 'Manage people' give users the matching HRMS roles automatically.",
        "data": "Implied HRMS roles",
        "direction": "one-way",
        "trigger": "Each sign-in / permission check",
        "verified": true
      },
      {
        "module": "Audit Logs",
        "key": "hrms.audit",
        "why": "Settings changes are logged with secrets redacted.",
        "data": "Audit entries",
        "direction": "one-way",
        "trigger": "Each save",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Editing a custom role",
        "effect": "Changes access for every user holding it.",
        "kind": "multi",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Super Admin only",
        "detail": "View and edit need Settings (whole company), held only by HRMS Super Admin.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Super Admin cannot be locked out",
        "detail": "The HRMS Super Admin role cannot be deleted or stripped of its settings access.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > HR Settings.",
      "Update the Company Profile and logo.",
      "Review roles on Roles & Permissions.",
      "Create a custom role if needed.",
      "Assign it to employees from their profile."
    ],
    "warnings": [
      {
        "title": "SSO and integrations are stored only",
        "detail": "No sign-in or other code reads these settings yet.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Earlier critical 'HR takeover via HRMS reset': the employee password reset (Employees screen, not this one) is limited to HRMS Super Admin, but it does not check whether the target is a portal Admin. Anyone given the portal 'Administer HRMS' grant becomes HRMS Super Admin and can reset any employee-linked login."
    ]
  },
  {
    "key": "hrms.audit",
    "portal": "employee",
    "paths": [
      "/hrms/audit-logs"
    ],
    "title": "Audit Logs",
    "overview": {
      "what": "A read-only, paged trail of recorded changes, filterable by action, user and date. Secrets are redacted.",
      "why": "Lets HR and auditors see who changed what and when.",
      "users": [
        "HRMS Super Admin",
        "HR Admin",
        "Auditor (read-only)"
      ]
    },
    "functions": [
      {
        "title": "Filter",
        "detail": "By action text, user and date range."
      },
      {
        "title": "Read details",
        "detail": "Each entry shows the person, action, time and redacted details."
      }
    ],
    "connections": [
      {
        "module": "All HRMS modules",
        "key": null,
        "why": "Every HRMS write and file view writes to the shared audit log.",
        "data": "Audit entries",
        "direction": "one-way",
        "trigger": "User actions",
        "verified": true
      },
      {
        "module": "Portal modules (Work Queue, O2D, login)",
        "key": null,
        "why": "They write to the same audit collection and the list has no HRMS-only filter, so their entries also show here.",
        "data": "Audit entries",
        "direction": "one-way",
        "trigger": "User actions",
        "verified": true
      },
      {
        "module": "Retention sweep",
        "key": null,
        "why": "Old audit rows can be deleted by the retention policy.",
        "data": "Audit rows",
        "direction": "one-way",
        "trigger": "Retention cron (HRMS_RETENTION_CRON, off by default here; Customer Portal cron runs it)",
        "verified": true
      }
    ],
    "impacts": [],
    "rules": [
      {
        "title": "Read only",
        "detail": "Needs 'Audit logs view (whole company)': HRMS Super Admin, HR Admin, Auditor.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open HRMS > HR Audit Logs.",
      "Set a date range.",
      "Filter by action or user.",
      "Open an entry to read its details."
    ],
    "warnings": [
      {
        "title": "Retention",
        "detail": "Entries older than the configured window may be deleted by the nightly sweep.",
        "severity": "irreversible"
      }
    ],
    "unverified": [
      "Configured audit retention window — stored in data, not traced."
    ]
  }
];
