/**
 * "About this module" documentation: Administration.
 *
 * GENERATED from the module audit; edit the text here directly when a screen
 * changes. The code each statement was verified against is listed in
 * docs/module-documentation-map.md, not here, so no source paths ship to the
 * browser. `verified: false` items show as "Requires verification".
 */
export default [
  {
    "key": "administration.users",
    "portal": "both",
    "paths": [
      "/admin/users"
    ],
    "title": "Internal User Management",
    "overview": {
      "what": "The list of staff accounts (Sales, Billing, Warehouse, HR, Admin and other internal roles). The same screen exists in both portals and edits the same accounts.",
      "why": "Staff need one account that works in both portals, with the right role.",
      "users": [
        "Super Admin",
        "Admin"
      ]
    },
    "functions": [
      {
        "title": "Add a staff account",
        "detail": "Email, password, name, company and role."
      },
      {
        "title": "Change role",
        "detail": "Moves the person to another role. Their access changes on their next request."
      },
      {
        "title": "Suspend / restore",
        "detail": "Suspended accounts move to an archive and cannot sign in; restoring recreates them."
      },
      {
        "title": "Reset password",
        "detail": "Sets a new password. Rate-limited."
      },
      {
        "title": "Access (extra grants)",
        "detail": "Gives one account a few permissions beyond its role. Only adds, never removes."
      }
    ],
    "connections": [
      {
        "module": "Roles & Permissions",
        "key": "administration.roles",
        "why": "The role chosen here decides what the person can do",
        "data": "Role name on the account",
        "direction": "one-way",
        "trigger": "Saving a role change",
        "verified": true
      },
      {
        "module": "HRMS employee records",
        "key": null,
        "why": "HRMS roles held by the account limit which portal role it may take",
        "data": "HRMS roles on the account",
        "direction": "one-way",
        "trigger": "Changing an account's role",
        "verified": true
      },
      {
        "module": "Other portal",
        "key": null,
        "why": "Both portals read and write the same users collection",
        "data": "Staff accounts",
        "direction": "two-way",
        "trigger": "Any save in either portal",
        "verified": true
      },
      {
        "module": "Audit log",
        "key": null,
        "why": "Changes are logged",
        "data": "Create, update, role, password, access actions",
        "direction": "one-way",
        "trigger": "Saving",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Changing a person's role",
        "effect": "Their menus and allowed actions change on their next page load in both portals. No re-login is needed because access is worked out on each request.",
        "kind": "automatic",
        "verified": true
      },
      {
        "action": "Suspending a staff account",
        "effect": "They are refused on the next request in both portals. Work assigned to them (Work Queue tasks, O2D stages) is not reassigned automatically.",
        "kind": "manual",
        "verified": false
      }
    ],
    "rules": [
      {
        "title": "Who can use it",
        "detail": "Opening needs 'Manage Users'. Creating needs 'Create Users', editing needs 'Edit Users'. Super Admin and Admin hold all of these; Sales does not.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Customer Portal checks per target",
        "detail": "In the Customer Portal, which accounts you may create or edit is checked against the account type: Customer accounts need the Customer Management permission, staff accounts need the Internal User Management permission.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Extra access: admins only",
        "detail": "Only full administrators who can also manage roles see the Access button.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Each portal edits only its own extra grants",
        "detail": "In the Customer Portal, extra grants for Employee Portal modules are kept as stored and cannot be changed from there.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open Internal User Management from the sidebar (Administration).",
      "Search for the person, or click Add User.",
      "Enter email, password, name and role, then save.",
      "Use the pencil icon to change role or status, the key icon to reset a password.",
      "The person signs in to either portal and sees the screens their role allows."
    ],
    "warnings": [
      {
        "title": "Role changes take effect immediately",
        "detail": "Giving someone an admin role gives them full access to both portals on their next click.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Permanent erase of an employee is done in HRMS (employee record), not on this screen. Its effect on the login account requires verification.",
      "Whether open Work Queue or O2D work moves when a staff account is suspended was not traced."
    ]
  },
  {
    "key": "administration.roles",
    "portal": "employee",
    "paths": [
      "/admin/permissions"
    ],
    "title": "Roles & Permissions",
    "overview": {
      "what": "The permission matrix for the Employee Portal: for each role, tick which screens it may view, create, edit, delete or approve. A second view shows the eight HRMS roles, read-only.",
      "why": "Decides what every staff role can see and do, without code changes.",
      "users": [
        "Super Admin",
        "Admin"
      ]
    },
    "functions": [
      {
        "title": "Edit a role's matrix",
        "detail": "Tick or untick View / Create / Edit / Delete / Approve per screen, then save."
      },
      {
        "title": "Create a role",
        "detail": "Add a custom role with a name, description and ticks."
      },
      {
        "title": "Copy from role",
        "detail": "Loads another role's effective permissions into the draft. Nothing is saved until you click Save."
      },
      {
        "title": "Delete a role",
        "detail": "Only custom roles with no accounts on them."
      },
      {
        "title": "HRMS roles view",
        "detail": "Shows the eight code-defined HRMS roles and how many people hold each. Membership is changed in HRMS, not here."
      }
    ],
    "connections": [
      {
        "module": "Every Employee Portal screen",
        "key": null,
        "why": "Ticks here are what the server enforces and what builds the sidebar",
        "data": "Role grants",
        "direction": "one-way",
        "trigger": "Saving a role",
        "verified": true
      },
      {
        "module": "Customer Portal",
        "key": null,
        "why": "Both portals share one roles collection; the Customer Portal re-reads it every 60 seconds",
        "data": "Role grants",
        "direction": "two-way",
        "trigger": "Save here; periodic reload there",
        "verified": true
      },
      {
        "module": "HRMS Settings",
        "key": null,
        "why": "The HRMS roles view uses the same data as the HRMS settings screen",
        "data": "HRMS role matrix",
        "direction": "one-way",
        "trigger": "Opening the HRMS roles view",
        "verified": true
      },
      {
        "module": "Audit log",
        "key": null,
        "why": "Role creates, updates and deletes are logged",
        "data": "Actor and action",
        "direction": "one-way",
        "trigger": "Saving",
        "verified": true
      }
    ],
    "impacts": [
      {
        "action": "Saving a role",
        "effect": "This portal's in-memory role list is refreshed before the save returns, so holders get the new access on their next request. The Customer Portal picks it up within about a minute.",
        "kind": "multi",
        "verified": true
      },
      {
        "action": "Unticking a cell",
        "effect": "Removes the permission. A role that has a saved row gets only what the row says; the built-in defaults apply only to a role with no row.",
        "kind": "automatic",
        "verified": true
      }
    ],
    "rules": [
      {
        "title": "Who can use it",
        "detail": "Opening needs 'Manage Roles'. Creating, editing and deleting need 'Create Roles', 'Edit Roles' and 'Delete Roles'. By default only Super Admin and Admin hold these.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Full-access flag",
        "detail": "Only a Super Admin can create a full-access role or change that flag. The built-in Super Admin and Admin roles can never lose full access.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Built-in roles",
        "detail": "Built-in roles cannot be renamed or deleted; their ticks can be changed.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Role in use",
        "detail": "A role still held by any account cannot be deleted.",
        "kind": "validation",
        "verified": true
      },
      {
        "title": "Customer fence",
        "detail": "The Customer role is always limited to Customer Portal screens, whatever is ticked.",
        "kind": "permission",
        "verified": true
      },
      {
        "title": "Only this portal's modules",
        "detail": "The matrix lists only Employee Portal modules.",
        "kind": "permission",
        "verified": true
      }
    ],
    "steps": [
      "Open Roles & Permissions from Administration.",
      "Select a role on the left (or create a new one).",
      "Tick or untick the actions for each screen.",
      "Click Save.",
      "People in that role see the change on their next click; the Customer Portal follows within about a minute."
    ],
    "warnings": [
      {
        "title": "Unticking removes access straight away",
        "detail": "Saved changes apply to everyone in the role on their next request.",
        "severity": "warning"
      },
      {
        "title": "After a server restart, roles fall back to defaults here",
        "detail": "The Employee Portal server does not load saved roles when it starts; it uses built-in defaults until any role is saved. Customised roles may see different menus after a restart.",
        "severity": "warning"
      }
    ],
    "unverified": [
      "Employee Portal save replaces the whole grants list with what the screen sends (no per-portal merge on the server). The screen is believed to send every stored cell back; requires verification that Customer Portal cells are never lost."
    ]
  }
];
