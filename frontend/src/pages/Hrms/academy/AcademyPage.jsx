import { useMemo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { HrmsPageLayout } from "../../../components/hrms/HrmsPageLayout";
import { TabNav } from "../../../components/hrms/TabNav";
import { useHrmsPermissions } from "../../../hooks/useHrmsPermissions";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from "@shared/permissions/constants.js";

import { MyLearningTab } from "./MyLearningTab";
import { CertificatesTab } from "./CertificatesTab";
import { AcademyDashboardTab } from "./AcademyDashboardTab";
import { CatalogueTab } from "./CatalogueTab";
import { ContentLibraryTab } from "./ContentLibraryTab";
import { AssessmentsTab } from "./AssessmentsTab";
import { AssignmentsTab } from "./AssignmentsTab";
import { RulesTab } from "./RulesTab";
import { AcademyReportsTab } from "./AcademyReportsTab";

/**
 * SI Academy.
 *
 * ---------------------------------------------------------------------------
 * ONE MODULE WITH TABS, NOT A SECOND APPLICATION
 * ---------------------------------------------------------------------------
 * The brief sketches a nav tree with a nested "Admin" branch under the module.
 * Every other module in this ERP is a single nav entry whose tabs are
 * role-scoped — Onboarding, Exits, Assets, Documents, Helpdesk and Payroll all
 * do exactly this — and a second-level nav branch for one module would be the
 * one visible thing that made SI Academy not look like the rest of the portal.
 *
 * So the ADMIN screens are tabs behind `academy:edit:org` rather than a
 * sub-menu. The information architecture the brief asks for is preserved
 * completely; only its presentation follows the house style.
 *
 * ---------------------------------------------------------------------------
 * The default is MY LEARNING
 * ---------------------------------------------------------------------------
 * As Onboarding defaults to the new hire's portal and Exits to "My exit":
 * almost everyone who opens this module is the learner, not the administrator
 * who built the course.
 *
 * The tab lives in the URL (`/academy/:tab`), as every other multi-tab HRMS
 * module here does, so a tab is linkable and survives a refresh.
 */
const TAB_KEYS = [
  "my-learning",
  "certificates",
  "dashboard",
  "catalogue",
  "content",
  "assessments",
  "assignments",
  "rules",
  "reports",
];

export function AcademyPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { can } = useHrmsPermissions();

  const isAdmin = can(M.ACADEMY, A.EDIT, S.ORG);
  const canAssign = can(M.ACADEMY, A.ASSIGN, S.ORG);
  const canViewOthers = can(M.ACADEMY, A.VIEW, S.TEAM) || can(M.ACADEMY, A.VIEW, S.ORG);
  /**
   * An auditor holds `academy:view:org` and NOT the self baseline, so they have
   * no learning of their own. Showing them an empty "My Learning" as the
   * landing page would be a poor first impression of a working module.
   */
  const isLearner = can(M.ACADEMY, A.VIEW, S.SELF);

  const tabs = useMemo(() => {
    const items = [];
    if (isLearner) {
      items.push(
        { key: "my-learning", label: "My Learning" },
        { key: "certificates", label: "Certificates" },
      );
    }
    if (canViewOthers) items.push({ key: "dashboard", label: "Dashboard" });
    if (isAdmin) {
      items.push(
        { key: "catalogue", label: "Learning Paths" },
        { key: "content", label: "Content Library" },
        { key: "assessments", label: "Assessments" },
      );
    }
    if (canAssign) items.push({ key: "assignments", label: "Assignments" });
    if (canAssign) items.push({ key: "rules", label: "Rules" });
    if (canViewOthers) items.push({ key: "reports", label: "Reports" });
    return items;
  }, [isLearner, isAdmin, canAssign, canViewOthers]);

  /** Where somebody with no learning of their own should land. */
  const fallback = tabs[0]?.key ?? "my-learning";
  const active = TAB_KEYS.includes(tab) ? tab : fallback;

  if (!tab) return <Navigate to={`${HRMS_ROUTE_PREFIX}/academy/${fallback}`} replace />;

  /**
   * A tab reached by URL without the grant for it.
   *
   * Redirected rather than rendered as a refusal — and, the point of guarding
   * here rather than only in the tab strip, without the component having
   * mounted and fired its request first. The same pattern `OnboardingPage`
   * uses, for the same reason.
   */
  const guard = (allowed, element) =>
    allowed ? element : <Navigate to={`${HRMS_ROUTE_PREFIX}/academy/${fallback}`} replace />;

  return (
    <HrmsPageLayout
      title="SI Academy"
      subtitle="Learn. Grow. Achieve."
      breadcrumbs={[
        { label: "HRMS", to: `${HRMS_ROUTE_PREFIX}/dashboard` },
        { label: "SI Academy" },
      ]}
    >
      <TabNav
        tabs={tabs}
        activeKey={active}
        onChange={(key) => navigate(`${HRMS_ROUTE_PREFIX}/academy/${key}`)}
        className="mb-4"
      />

      {active === "my-learning" && guard(isLearner, <MyLearningTab />)}
      {active === "certificates" && guard(isLearner, <CertificatesTab />)}
      {active === "dashboard" && guard(canViewOthers, <AcademyDashboardTab />)}
      {active === "catalogue" && guard(isAdmin, <CatalogueTab />)}
      {active === "content" && guard(isAdmin, <ContentLibraryTab />)}
      {active === "assessments" && guard(isAdmin, <AssessmentsTab />)}
      {active === "assignments" && guard(canAssign, <AssignmentsTab />)}
      {active === "rules" && guard(canAssign, <RulesTab />)}
      {active === "reports" && guard(canViewOthers, <AcademyReportsTab />)}
    </HrmsPageLayout>
  );
}

export default AcademyPage;
