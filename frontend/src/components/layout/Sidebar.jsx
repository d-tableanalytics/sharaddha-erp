import { NavLink, useLocation } from "react-router-dom";
<<<<<<< HEAD
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, Circle, ShieldCheck, Users, Key, Truck, ListChecks, Ban, LineSquiggle, Rows2Icon, BookAIcon, CheckSquare, StepBackIcon, Forward, Table, RefreshCwIcon, Table2, Trash2, BarChart, Trophy, BarChart3 } from "lucide-react";
=======
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, Circle, ShieldCheck, Users, Key, Truck, ListChecks, Ban, LayoutGrid } from "lucide-react";
>>>>>>> d30a7b3eeb113a903fa0600e126499b41491df56
import toast from "react-hot-toast";
import { useUIStore } from "../../store/uiStore";
import { useUserStore } from "../../store/userStore";
import { useHrmsPermissions } from "../../hooks/useHrmsPermissions";
import { canOpenUserManagement, canManageRoles, canUseO2d } from "../../utils/permissions";
import {
  visibleHrmsNavItems,
  groupHrmsNavItems,
  HRMS_SIDEBAR_GROUP_KEY,
  HRMS_SIDEBAR_GROUP_LABEL,
} from "../hrms/navItems";

/**
 * The Employee Portal rail.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Visually and behaviourally the Customer Portal's sidebar — same shell, same
 * active-item rule, same collapse behaviour — with the ERP half removed. The
 * Customer Portal built its menu from `buildNavigation(user)`, a server-driven
 * list of ERP modules, and then APPENDED one HRMS group to it. Here HRMS is
 * the whole menu, so there is no server menu to merge with and no cart badge
 * to carry.
 *
 * What is deliberately identical is the source of truth. Visibility still
 * comes from the HRMS evaluator in `useHrmsPermissions` — never from a portal
 * permission — so the exact same account sees the exact same HRMS items it saw
 * before the split. The portal's Roles & Permissions matrix still decides
 * which HRMS ROLES an account holds (backend/utils/hrmsAccessBridge.js), and
 * the evaluator still decides what those roles can see.
 *
 * The one addition is the Administration group. Both repositories administer
 * the shared `users` and `roles` collections, so an HR or Super Admin can grant
 * an HRMS role from here without going back to the Customer Portal. It is
 * gated on the SAME portal permissions the Customer Portal gates it on, and
 * both screens are re-checked server-side.
 */

const ADMIN_GROUP_KEY = "administration";

export const Sidebar = () => {
  const { sidebarOpen, toggleSidebar, collapsedNavGroups, toggleNavGroup } = useUIStore();
  const { user, logout } = useUserStore();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    toast.success("Successfully logged out.");
  };

  const subtitle =
    [user?.role && user.role !== "Customer" ? user.role : null, user?.company || user?.email]
      .filter(Boolean)
      .join(" · ") || "System Account";

  const { can, implementedModules, hasAccess: hasHrmsAccess } = useHrmsPermissions();

  const hrmsSections = hasHrmsAccess
    ? groupHrmsNavItems(visibleHrmsNavItems(can, implementedModules)).map((section) => ({
      key: section.group,
      // The first section is the module's own core links (Dashboard, Inbox,
      // My Profile). They sit directly under the HRMS heading with no label
      // of their own — a heading above three links that are already under
      // "HRMS" would be a label for the thing you just read.
      label: section.group === "core" ? null : section.label,
      items: section.items.map((item) => ({
        id: `hrms:${item.key}`,
        key: item.key,
        label: item.label,
        path: item.path,
        icon: item.icon,
      })),
    }))
    : [];

  const hrmsGroups =
    hrmsSections.length > 0
      ? [
        {
          key: HRMS_SIDEBAR_GROUP_KEY,
          label: HRMS_SIDEBAR_GROUP_LABEL,
          icon: Users,
          alwaysGrouped: true,
          sections: hrmsSections,
          items: hrmsSections.flatMap((s) => s.items),
        },
      ]
      : [];

  /**
   * Administration — the shared identity surface, gated exactly as the
   * Customer Portal gates it.
   *
   * `canOpenUserManagement` is MANAGE_USERS or MANAGE_CUSTOMER_USERS;
   * `canManageRoles` is MANAGE_ROLES. Neither is an HRMS grant, and that is
   * correct: who may edit an account is a portal question, and the answer must
   * be the same in both repositories or the two screens would disagree about
   * the same document.
   */
  const adminItems = [
    ...(canOpenUserManagement(user)
      ? [{ id: "admin:users", key: "users", label: "User Management", path: "/admin/users", icon: Users }]
      : []),
    ...(canManageRoles(user)
      ? [{ id: "admin:roles", key: "roles", label: "Roles & Permissions", path: "/admin/permissions", icon: Key }]
      : []),
  ];

  const adminGroups =
    adminItems.length > 0
      ? [{ key: ADMIN_GROUP_KEY, label: "Administration", icon: ShieldCheck, items: adminItems }]
      : [];

  /**
   * FMS — Fulfilment Management System (§1).
   *
   * The group the user reads is FMS; the screens under it are O2D's, which is
   * why every path is `/fms/o2d/...` rather than `/fms/...`. FMS is the section,
   * O2D is its first workflow, and a second one later slots in beside these
   * without moving them.
   *
   * The permission is still `view_o2d`, and the item ids are still `o2d:*`.
   * Neither is a naming oversight: the permission is written into live role
   * rows in the shared database, and the ids are what the nav-order preference
   * is keyed by. §1 renames a section, which is a label and a URL — it is not a
   * licence to invalidate stored data.
   *
   * One permission decides the whole group. What each role can DO inside it
   * varies enormously - Imports reads, Billing works eight stages - but that is
   * decided per screen and per stage by the server, not by which links are
   * visible. Gating individual links on `work_o2d_stage` would hide My Tasks
   * from Management, who need to see the queue they are accountable for even
   * though they close nothing in it.
   */
  const o2dGroups = canUseO2d(user)
    ? [{
<<<<<<< HEAD
      key: "o2d",
      label: "Order to Dispatch",
      icon: Truck,
      items: [
        { id: "o2d:tasks", key: "tasks", label: "My Tasks", path: "/o2d/tasks", icon: ListChecks },
        { id: "o2d:orders", key: "orders", label: "Order Tracker", path: "/o2d/orders", icon: Truck },
        { id: "o2d:exits", key: "exits", label: "Exit Register", path: "/o2d/exits", icon: Ban },
      ],
    }]
=======
        key: "o2d",
        label: "FMS",
        icon: Truck,
        items: [
          { id: "o2d:tasks", key: "tasks", label: "O2D — My Tasks", path: "/fms/o2d/tasks", icon: ListChecks },
          { id: "o2d:orders", key: "orders", label: "O2D — Order Tracker", path: "/fms/o2d/orders", icon: Truck },
          { id: "o2d:stages", key: "stages", label: "O2D — Stages", path: "/fms/o2d/stages", icon: LayoutGrid },
          { id: "o2d:exits", key: "exits", label: "O2D — Exit Register", path: "/fms/o2d/exits", icon: Ban },
        ],
      }]
>>>>>>> d30a7b3eeb113a903fa0600e126499b41491df56
    : [];


  /*
  The menu item “Work Queue” should show up if user has either of the following permissions:

assign_any_task

assign_own_task

When that menu item is clicked, it should go to /work-queue, NOT to /wq/tasks.

Inside /work-queue:

If the user only has assign_own_task, the UI must show ONLY their own tasks.

If the user has assign_any_task, the UI must show ALL tasks, with columns for “Assignee”, “Delegate To”, etc.

No “Delegation” submenu. No separate “Checklist” page. Just one single work-queue page with the behavior above.
  */

  const workQueue = canUseO2d(user)
    ? [{
      key: "workQueue",
      label: "Work Queue",
      icon: BookAIcon,
      items: [
        { id: "wq:mywork", key: "mywork", label: "My Work", path: "/work-queue", icon: Table },
        { id: "wq:delegation", key: "delegation", label: "Delegation", path: "/wq/delegation", icon: Forward },
        { id: "wq:looptasks", key: "looptasks", label: "Loop Tasks", path: "/wq/looptasks", icon: RefreshCwIcon },
        { id: "wq:alltasks", key: "alltasks", label: "All Tasks", path: "/wq/alltasks", icon: Table2 },
        { id: "wq:deletedtasks", key: "deletedtasks", label: "Deleted Tasks", path: "/wq/deletedtasks", icon: Trash2 },
        { id: "wq:checklist", key: "checklist", label: "Checklist", path: "/wq/checklist", icon: CheckSquare },
        { id: "wq:executivescoreboard", key: "executivescoreboard", label: "Executive Scoreboard", path: "/wq/executivescoreboard", icon: Trophy },
        { id: "wq:activities", key: "activities", label: "Activities", path: "/wq/activities", icon: BarChart3 },
      ],
    }]
    : [];


  // Administration sits at the BOTTOM of the rail, under everything it
  // administers — the same order the Customer Portal settled on.
  const groups = [...hrmsGroups, ...o2dGroups, ...workQueue, ...adminGroups];

  /**
   * Exactly ONE item is highlighted, and it is the most specific match.
   *
   * Each item deciding for itself with `pathname.startsWith(basePath)` lights
   * up two rows at once wherever one nav path is a prefix of another —
   * "/hrms/leave" and "/hrms/leave/holidays". Choosing a single winner by
   * longest matching path is what makes that impossible rather than merely
   * unlikely. The match is on a SEGMENT boundary, so "/hrms/org" claims
   * "/hrms/org/departments" but never "/hrms/organisation".
   */
  const matches = (item) => {
    const [basePath, searchStr] = item.path.split("?");
    if (searchStr) return location.pathname === basePath && location.search.includes(searchStr);
    return location.pathname === basePath || location.pathname.startsWith(`${basePath}/`);
  };

  const allItems = groups.flatMap((g) => g.items);
  const activeItem = allItems.reduce((best, item) => {
    if (!matches(item)) return best;
    const len = item.path.split("?")[0].length;
    return !best || len > best.len ? { id: item.id, len } : best;
  }, null);
  const activeItemId = activeItem?.id ?? null;

  const activeGroupKey = groups.find((g) => g.items.some((i) => i.id === activeItemId))?.key;

  const iconFor = (icon) => icon || Circle;

  const linkClass = (isActive) =>
    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${isActive
      ? "nav-active bg-white/10 text-white font-semibold"
      : "text-primary-100/90 font-medium hover:bg-white/[0.07] hover:text-white"
    }`;

  const renderItem = (item) => {
    const Icon = iconFor(item.icon);
    const isActive = item.id === activeItemId;

    return (
      <NavLink
        key={item.id}
        to={item.path}
        title={sidebarOpen ? undefined : item.label}
        className={() => linkClass(isActive)}
      >
        {() => (
          <>
            {/* The accent sits INSIDE the row's left edge, so it reads as a
                border on the item rather than a marker floating in the gutter. */}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary-300"
              />
            )}
            <Icon size={18} className="shrink-0" />
            {sidebarOpen && <span className="flex-1 truncate">{item.label}</span>}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <aside
      className={`bg-linear-to-bl from-slate-800 via-primary-900 to-slate-900 h-screen flex flex-col transition-all duration-300 relative z-30 select-none shadow-xl shadow-primary-950/20 ${sidebarOpen ? "w-64" : "w-20"
        }`}
    >
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-6 bg-white text-primary-700 hover:text-primary-900 w-6 h-6 rounded-full flex items-center justify-center shadow-enterprise-md hover:scale-110 transition-all focus:outline-none ring-1 ring-primary-100"
      >
        {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      <div
        className={`py-4 flex flex-col items-center overflow-hidden border-b border-white/10 ${sidebarOpen ? "px-4" : "justify-center"
          }`}
      >
        <NavLink
          to="/hrms/dashboard"
          className={`bg-white rounded-xl flex items-center justify-center transition-all duration-300 ${sidebarOpen ? "w-44 h-14 p-2" : "w-11 h-11 p-1"
            }`}
        >
          <img
            src="/logo.avif"
            alt="Shraddha Impex"
            className="object-contain w-full h-full"
          />
        </NavLink>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/30 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent]">
        {groups.map((group) => {
          // A module with a single destination is rendered as a plain link. A
          // disclosure triangle that opens to reveal one row is a control that
          // costs a click and tells the user nothing.
          if (group.items.length === 1 && !group.alwaysGrouped) {
            return renderItem({ ...group.items[0], label: group.label, icon: group.icon });
          }

          const GroupIcon = iconFor(group.icon);
          const holdsActive = group.key === activeGroupKey;
          const collapsed = collapsedNavGroups.includes(group.key);

          // Collapsed rail: the group header has nowhere to put a label and its
          // children have no room to indent, so the items are shown flat.
          if (!sidebarOpen) {
            return (
              <div key={group.key} className="space-y-1">
                <div className="h-px bg-white/10 my-2" />
                {group.items.map((item) => renderItem(item))}
              </div>
            );
          }

          return (
            <div key={group.key} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggleNavGroup(group.key)}
                aria-expanded={!collapsed}
                className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors duration-150 focus:outline-none ${holdsActive
                  ? "text-white"
                  : "text-primary-100 hover:bg-white/[0.07] hover:text-white"
                  }`}
              >
                {/* Shut, but this is where you are. The accent says so, so
                    collapsing the group never costs you your place. */}
                {holdsActive && collapsed && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary-300"
                  />
                )}
                <GroupIcon size={18} className="shrink-0" />
                <span className="flex-1 truncate text-left">{group.label}</span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 opacity-70 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
                />
              </button>

              {!collapsed &&
                (group.sections
                  ? group.sections.map((section) => (
                    <div key={section.key} className="space-y-0.5 pt-2 first:pt-0.5">
                      {section.label && (
                        <p className="px-3 pt-1 pb-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-primary-200/55">
                          {section.label}
                        </p>
                      )}
                      {section.items.map((item) => renderItem(item))}
                    </div>
                  ))
                  : (
                    <div className="space-y-0.5">
                      {group.items.map((item) => renderItem(item))}
                    </div>
                  ))}
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10">
        <div
          className={`flex items-center rounded-lg border border-white/10 bg-white/5 ${sidebarOpen ? "gap-2 p-2.5" : "flex-col gap-2 p-2"
            }`}
        >
          <NavLink
            to="/hrms/me"
            title={sidebarOpen ? "View your profile" : user?.user || user?.name || "Profile"}
            className="flex items-center gap-3 min-w-0 flex-1 rounded-md hover:opacity-80 transition-opacity"
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="w-9 h-9 rounded-full object-cover border border-white/20 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {(user?.user || user?.name || "US").slice(0, 2).toUpperCase()}
              </div>
            )}

            {sidebarOpen && (
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white truncate leading-tight">
                  {user?.user || user?.name || "Loading..."}
                </p>
                <p className="text-[11px] text-primary-200/80 font-medium truncate">
                  {subtitle}
                </p>
              </div>
            )}
          </NavLink>

          <button
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="p-1.5 rounded-md text-primary-200 hover:text-white hover:bg-red-500/80 transition-colors shrink-0 focus:outline-none"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
};
export default Sidebar;
