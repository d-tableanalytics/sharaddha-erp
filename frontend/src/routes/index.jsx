import { createBrowserRouter, Navigate } from "react-router-dom";
import { lazy } from "react";

import MainLayout from "../components/layout/MainLayout";
import { ProtectedRoute } from "../components/layout/ProtectedRoute";
import { HomeRoute } from "../components/layout/HomeRoute";
import { HrmsProtectedRoute } from "../components/hrms/HrmsProtectedRoute";
import { O2dProtectedRoute } from "../components/o2d/O2dProtectedRoute";
import { REPORTS_ENTRY_GRANTS } from "../components/hrms/navItems";

/**
 * The Employee Portal router.
 *
 * ---------------------------------------------------------------------------
 * THE /hrms PREFIX IS KEPT ON PURPOSE
 * ---------------------------------------------------------------------------
 * It would have been tempting to drop it — this app is nothing but HRMS, so
 * every path could have lost a segment. It is kept because the prefix is not a
 * decoration: `HRMS_ROUTE_PREFIX` in @shared/constants/hrms.js is what every
 * nav item, every in-app link and every inbox deep link is built from, and it
 * is compiled into rows already sitting in the shared database. Renaming the
 * routes would mean editing ~150 HRMS files and invalidating links people have
 * already been sent.
 *
 * So the route tree below is the Customer Portal's `/hrms` subtree, moved
 * across unchanged, and every HRMS page is byte-identical to the one it
 * replaced. What is new is only the shell around it: "/" now resolves the
 * actor instead of rendering a booking dashboard, and Administration is
 * reachable directly rather than through the ERP menu.
 */

const AuthLayout = lazy(() => import("../pages/Auth/AuthLayout").then(m => ({ default: m.AuthLayout })));
const Login = lazy(() => import("../pages/Auth/Login").then(m => ({ default: m.Login })));

// ── Administration (the shared users/roles collections) ───────────────────
const UserManagement = lazy(() => import("../pages/Admin/Settings/UserManagement").then(m => ({ default: m.UserManagement })));
const PermissionMatrix = lazy(() => import("../pages/Admin/Settings/PermissionMatrix").then(m => ({ default: m.PermissionMatrix })));

// ── HRMS ──────────────────────────────────────────────────────────────────
const HrmsDashboard = lazy(() => import("../pages/Hrms/HrmsDashboard").then(m => ({ default: m.HrmsDashboard })));
const HrmsMyProfilePage = lazy(() => import("../pages/Hrms/MyProfilePage").then(m => ({ default: m.MyProfilePage })));
const HrmsOrgStructurePage = lazy(() => import("../pages/Hrms/org/OrgStructurePage").then(m => ({ default: m.OrgStructurePage })));
const HrmsLeavePage = lazy(() => import("../pages/Hrms/leave/LeavePage").then(m => ({ default: m.LeavePage })));
const HrmsAttendancePage = lazy(() => import("../pages/Hrms/attendance/AttendancePage").then(m => ({ default: m.AttendancePage })));
const HrmsExpensesPage = lazy(() => import("../pages/Hrms/expenses/ExpensesPage").then(m => ({ default: m.ExpensesPage })));
const HrmsExitsPage = lazy(() => import("../pages/Hrms/exits/ExitsPage").then(m => ({ default: m.ExitsPage })));
const HrmsAssetsPage = lazy(() => import("../pages/Hrms/assets/AssetsPage").then(m => ({ default: m.AssetsPage })));
const HrmsDocumentsPage = lazy(() => import("../pages/Hrms/documents/DocumentsPage").then(m => ({ default: m.DocumentsPage })));
const HrmsHelpdeskPage = lazy(() => import("../pages/Hrms/helpdesk/HelpdeskPage").then(m => ({ default: m.HelpdeskPage })));
const HrmsPayrollPage = lazy(() => import("../pages/Hrms/payroll/PayrollPage").then(m => ({ default: m.PayrollPage })));
const HrmsEmployeesPage = lazy(() => import("../pages/Hrms/employees/EmployeesPage").then(m => ({ default: m.EmployeesPage })));
const HrmsEmployeeProfilePage = lazy(() => import("../pages/Hrms/employees/EmployeeProfilePage").then(m => ({ default: m.EmployeeProfilePage })));
const HrmsEmployeeEditPage = lazy(() => import("../pages/Hrms/employees/EmployeeEditPage").then(m => ({ default: m.EmployeeEditPage })));
const HrmsHiringPage = lazy(() => import("../pages/Hrms/hiring/HiringPage").then(m => ({ default: m.HiringPage })));
const HrmsOnboardingPage = lazy(() => import("../pages/Hrms/onboarding/OnboardingPage").then(m => ({ default: m.OnboardingPage })));
const HrmsPerformancePage = lazy(() => import("../pages/Hrms/performance/PerformancePage").then(m => ({ default: m.PerformancePage })));
const HrmsEngagePage = lazy(() => import("../pages/Hrms/engage/EngagePage").then(m => ({ default: m.EngagePage })));
const HrmsPlanningPage = lazy(() => import("../pages/Hrms/planning/PlanningPage").then(m => ({ default: m.PlanningPage })));
const HrmsReportsPage = lazy(() => import("../pages/Hrms/reports/ReportsPage").then(m => ({ default: m.ReportsPage })));
const HrmsSettingsPage = lazy(() => import("../pages/Hrms/settings/SettingsPage").then(m => ({ default: m.SettingsPage })));
const HrmsAuditLogsPage = lazy(() => import("../pages/Hrms/audit/AuditLogsPage").then(m => ({ default: m.AuditLogsPage })));
const HrmsInboxPage = lazy(() => import("../pages/Hrms/inbox/InboxPage").then(m => ({ default: m.InboxPage })));

// Order to Dispatch. A PORTAL module, not an HRMS one - see O2dProtectedRoute.
const O2dPage = lazy(() => import("../pages/O2d/O2dPage").then(m => ({ default: m.O2dPage })));
const O2dNewOrderPage = lazy(() => import("../pages/O2d/NewOrderPage").then(m => ({ default: m.NewOrderPage })));

// ── Public careers (no session: an applicant has no account) ──────────────
const CareersLayout = lazy(() => import("../pages/Careers/CareersLayout").then(m => ({ default: m.CareersLayout })));
const CareersHome = lazy(() => import("../pages/Careers/CareersHome").then(m => ({ default: m.CareersHome })));
const CareersRolePage = lazy(() => import("../pages/Careers/CareersRolePage").then(m => ({ default: m.CareersRolePage })));
const CareersOfferPage = lazy(() => import("../pages/Careers/OfferPage").then(m => ({ default: m.OfferPage })));

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: "/login", element: <Login /> },
    ]
  },
  {
    /*
     * The public careers surface.
     *
     * Sits OUTSIDE ProtectedRoute deliberately, and is the only part of this
     * app that does. A job applicant has no account, and a candidate deciding
     * on an offer is not an employee yet; putting these behind the session
     * guard would make the careers page unreachable by the only people it is
     * for.
     *
     * The offer route is addressed by a single-use access token, never by an
     * offer id — the token is the credential, and the server holds only its
     * hash.
     */
    path: "/careers",
    element: <CareersLayout />,
    children: [
      { index: true, element: <CareersHome /> },
      { path: "offer/:token", element: <CareersOfferPage /> },
      { path: ":slug", element: <CareersRolePage /> },
    ],
  },
  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      {
        path: "/",
        element: <MainLayout />,
        children: [
          {
            // Resolves the HRMS actor and routes on the answer. NOT a plain
            // redirect to /hrms/dashboard — see HomeRoute.jsx for why that
            // would loop.
            path: "",
            element: <HomeRoute />,
          },
          {
            // Administration of the SHARED users and roles collections. Both
            // repositories carry these screens and both write the same
            // documents; each page re-checks its permission itself, and every
            // underlying API is guarded server-side.
            path: "admin/users",
            // Internal User Management. The employee domain has no Customer
            // Management route at all — customers are a customer-domain concern,
            // and the module registry says so.
            element: <UserManagement audience="internal" />,
          },
          {
            path: "admin/permissions",
            element: <PermissionMatrix />,
          },
          {
            /**
             * Order to Dispatch.
             *
             * Guarded by the PORTAL permission `view_o2d`, not by the HRMS
             * guard: Billing and Accounts hold no HRMS grant at all and are
             * exactly who this module is for.
             *
             * `/o2d/orders/new` is declared BEFORE `/o2d/:tab`, or "orders"
             * would be read as a tab name and the intake form would never
             * render.
             */
            path: "o2d",
            element: <O2dProtectedRoute />,
            children: [
              { index: true, element: <Navigate to="/o2d/tasks" replace /> },
              { path: "orders/new", element: <O2dNewOrderPage /> },
              { path: ":tab", element: <O2dPage /> },
            ],
          },
          {
            // HRMS. The tree below is unchanged from the Customer Portal, down
            // to the comments — every path, guard and tab behaves exactly as it
            // did before the split.
            //
            // HrmsProtectedRoute adds the AD-4 check on top of authentication:
            // being signed in is not being an HRMS user, so an account without
            // an HRMS role typing /hrms/... is sent to "/", where HomeRoute
            // tells it so.
            path: "hrms",
            element: <HrmsProtectedRoute />,
            children: [
              { index: true, element: <Navigate to="/hrms/dashboard" replace /> },
              { path: "dashboard", element: <HrmsDashboard /> },
              {
                // "My Profile". A redirect to the actor's own employee record.
                // Behind the employees module because that is where it lands,
                // and because the nav item declares the same requirement — a
                // link the router would then refuse is exactly the dead end the
                // nav gate exists to prevent.
                path: "me",
                element: <HrmsProtectedRoute module="employees" />,
                children: [{ index: true, element: <HrmsMyProfilePage /> }],
              },
              {
                // Employee Master. There is NO /employees/new — creation
                // happens in a drawer over the directory, and only editing gets
                // its own page.
                path: "employees",
                element: <HrmsProtectedRoute module="employees" />,
                children: [
                  { index: true, element: <HrmsEmployeesPage /> },
                  { path: ":id", element: <HrmsEmployeeProfilePage /> },
                  { path: ":id/edit", element: <HrmsEmployeeEditPage /> },
                ],
              },
              {
                // Org Structure. The tab lives in the URL, so a tab is linkable
                // and the Departments employee-count link can point at one.
                path: "org",
                element: <HrmsProtectedRoute module="org-structure" />,
                children: [
                  { index: true, element: <HrmsOrgStructurePage /> },
                  { path: ":tab", element: <HrmsOrgStructurePage /> },
                ],
              },
              {
                // Leave, with Holidays as one of its tabs — which is why there
                // is no separate holidays module.
                path: "leave",
                element: <HrmsProtectedRoute module="leave" />,
                children: [
                  { index: true, element: <HrmsLeavePage /> },
                  { path: ":tab", element: <HrmsLeavePage /> },
                ],
              },
              {
                // Helpdesk: my tickets, the resolver queue for the categories
                // my team answers for, the knowledge base, and the catalogue.
                path: "helpdesk",
                element: <HrmsProtectedRoute module="helpdesk" />,
                children: [
                  { index: true, element: <HrmsHelpdeskPage /> },
                  { path: ":tab", element: <HrmsHelpdeskPage /> },
                ],
              },
              {
                // Documents: the company library, policies with
                // acknowledgment, my own records, and the folder tree.
                path: "documents",
                element: <HrmsProtectedRoute module="documents" />,
                children: [
                  { index: true, element: <HrmsDocumentsPage /> },
                  { path: ":tab", element: <HrmsDocumentsPage /> },
                ],
              },
              {
                // Assets: my kit, the request queue, the inventory and the
                // category catalogue.
                path: "assets",
                element: <HrmsProtectedRoute module="assets" />,
                children: [
                  { index: true, element: <HrmsAssetsPage /> },
                  { path: ":tab", element: <HrmsAssetsPage /> },
                ],
              },
              {
                // Exits: the offboarding workflow — my exit, the HR/manager
                // queue, and the clearances assigned to me.
                path: "exits",
                element: <HrmsProtectedRoute module="exits" />,
                children: [
                  { index: true, element: <HrmsExitsPage /> },
                  { path: ":tab", element: <HrmsExitsPage /> },
                ],
              },
              {
                // Expenses: claims, the approver queue, and the category
                // catalogue.
                path: "expenses",
                element: <HrmsProtectedRoute module="expenses" />,
                children: [
                  { index: true, element: <HrmsExpensesPage /> },
                  { path: ":tab", element: <HrmsExpensesPage /> },
                ],
              },
              {
                // Attendance: punches, history, team view and corrections.
                path: "attendance",
                element: <HrmsProtectedRoute module="attendance" />,
                children: [
                  { index: true, element: <HrmsAttendancePage /> },
                  { path: ":tab", element: <HrmsAttendancePage /> },
                ],
              },
              {
                // Payroll.
                path: "payroll",
                element: <HrmsProtectedRoute module="payroll" />,
                children: [
                  { index: true, element: <HrmsPayrollPage /> },
                  { path: ":tab", element: <HrmsPayrollPage /> },
                ],
              },
              {
                // Hiring. The candidate-facing half of this module is NOT
                // here: it is the /careers tree above, outside the session
                // guard.
                path: "hiring",
                element: <HrmsProtectedRoute module="hiring" />,
                children: [
                  { index: true, element: <HrmsHiringPage /> },
                  { path: ":tab", element: <HrmsHiringPage /> },
                ],
              },
              {
                // Onboarding. Defaults to the new hire's own portal rather
                // than to an HR screen.
                path: "onboarding",
                element: <HrmsProtectedRoute module="onboarding" />,
                children: [
                  { index: true, element: <HrmsOnboardingPage /> },
                  { path: ":tab", element: <HrmsOnboardingPage /> },
                ],
              },
              {
                // Performance. Defaults to the employee's own goals rather
                // than to an HR screen.
                path: "performance",
                element: <HrmsProtectedRoute module="performance" />,
                children: [
                  { index: true, element: <HrmsPerformancePage /> },
                  { path: ":tab", element: <HrmsPerformancePage /> },
                ],
              },
              {
                // Engage. Every tab is visible to everyone — Engage has no
                // team scope; what HR alone gets is the write controls inside.
                path: "engage",
                element: <HrmsProtectedRoute module="engage" />,
                children: [
                  { index: true, element: <HrmsEngagePage /> },
                  { path: ":tab", element: <HrmsEngagePage /> },
                ],
              },
              {
                // Planning. Org scope only: planning the company's headcount
                // and budget has no self or team view. `view:org` reads;
                // `edit:org` adds the write controls, which the server enforces
                // regardless of what renders.
                path: "planning",
                element: <HrmsProtectedRoute module="planning" />,
                children: [
                  { index: true, element: <HrmsPlanningPage /> },
                  { path: ":tab", element: <HrmsPlanningPage /> },
                ],
              },
              {
                // Reports: the catalogue, and one report open at a time. The
                // report key lives in the URL so a report is linkable and
                // survives a refresh.
                //
                // The `module` gate is `reports`, matching the sidebar. Which
                // reports exist for this viewer is decided by the server, on
                // every request, from each report's own data module.
                path: "reports",
                element: <HrmsProtectedRoute module="reports" anyOf={REPORTS_ENTRY_GRANTS} />,
                children: [
                  { index: true, element: <HrmsReportsPage /> },
                  { path: ":key", element: <HrmsReportsPage /> },
                ],
              },
              {
                // Audit logs: read by super_admin, hr_admin and auditor — two
                // roles that cannot open Settings, which is exactly why the
                // server redacts credentials out of the trail.
                path: "audit-logs",
                element: <HrmsProtectedRoute module="audit-logs" />,
                children: [{ index: true, element: <HrmsAuditLogsPage /> }],
              },
              {
                // Settings: company profile and branding, the read-only role
                // matrix, SSO providers and integrations.
                path: "settings",
                element: <HrmsProtectedRoute module="settings" />,
                children: [
                  { index: true, element: <HrmsSettingsPage /> },
                  { path: ":tab", element: <HrmsSettingsPage /> },
                ],
              },
              {
                // Inbox. `self` scope only. The grant is in the baseline, so
                // every HRMS role reaches it; what they see is their own items,
                // which the server enforces by putting the actor's own employee
                // id in every filter.
                path: "inbox",
                element: <HrmsProtectedRoute module="inbox" />,
                children: [{ index: true, element: <HrmsInboxPage /> }],
              },
            ],
          },
        ],
      }
    ]
  },
]);
export default router;
