import * as Icons from "lucide-react";
import { Forward, Key, ListTodo, PackagePlus, Truck, UserCog } from "lucide-react";

import { canManageRoles, canOpenUserManagement, PERMISSIONS } from "../../utils/permissions";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";

const H = HRMS_ROUTE_PREFIX;

/**
 * Shortcuts, each behind the permission its destination demands.
 *
 * The HRMS ones are the HR Dashboard's Quick Access catalogue exactly as the
 * server filtered it — never re-decided here.
 */
export function quickActionsFor(user, ctx, widgets) {
  const list = [];

  if (ctx.can("work_queue", "tasks", "view")) {
    list.push({ key: "wq-mywork", label: "My Work", to: "/work-queue", icon: ListTodo, tone: "primary" });
  }
  if (ctx.can("work_queue", "tasks", "create")) {
    list.push({ key: "wq-assign", label: "Assign Task", to: "/wq/delegation", icon: Forward, tone: "primary" });
  }
  if (ctx.has(PERMISSIONS.CREATE_O2D_ORDER)) {
    list.push({ key: "o2d-new", label: "New Order", to: "/fms/o2d/orders/new", icon: PackagePlus, tone: "success" });
  }
  if (ctx.has(PERMISSIONS.VIEW_O2D)) {
    list.push({ key: "o2d-tracker", label: "Order Tracker", to: "/fms/o2d/orders", icon: Truck, tone: "neutral" });
  }

  for (const item of widgets?.quickAccess ?? []) {
    list.push({
      key: `hrms-${item.key}`,
      label: item.label,
      to: `${H}${item.path}`,
      icon: Icons[item.icon] ?? Icons.Circle,
      tone: item.tone,
    });
  }

  if (canOpenUserManagement(user)) {
    list.push({ key: "admin-users", label: "Manage Users", to: "/admin/users", icon: UserCog, tone: "neutral" });
  }
  if (canManageRoles(user)) {
    list.push({ key: "admin-roles", label: "Roles & Permissions", to: "/admin/permissions", icon: Key, tone: "neutral" });
  }

  return list;
}
