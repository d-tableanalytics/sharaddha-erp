import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";

import { HrmsPageLayout } from "../../../components/hrms/HrmsPageLayout";
import { Button } from "../../../components/ui/Button";
import { EmployeeFormFields } from "./EmployeeFormFields";
import {
  employeesApi,
  employeeCustomFieldsApi,
  departmentsApi,
  locationsApi,
  HrmsApiError,
} from "../../../services/hrms";
import { useHrmsPermissions } from "../../../hooks/useHrmsPermissions";
import { updateEmployeeSchema, changeWorkEmailSchema } from "@shared/schemas/employee.js";
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from "@shared/permissions/constants.js";

/**
 * Edit an employee — a FULL PAGE, matching the reference, which uses a drawer
 * for creation and a page for editing.
 *
 * ---------------------------------------------------------------------------
 * canEditJobDetails
 * ---------------------------------------------------------------------------
 * An employee editing their own record may change personal details only.
 * `employees:edit:self` is in the baseline every HRMS role carries, so without
 * this an employee could change their own designation, department or reporting
 * manager — the last of which would rewrite who can approve their leave.
 *
 * The gate is a convenience: the server refuses those fields on a self-edit
 * regardless, and returns the reason.
 */
export function EmployeeEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, actor } = useHrmsPermissions();

  const [employee, setEmployee] = useState(null);
  const [customFields, setCustomFields] = useState([]);
  const [managerOptions, setManagerOptions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  /**
   * The work email, held OUTSIDE react-hook-form on purpose.
   *
   * `updateEmployeeSchema` is `.strict()` and omits `email`, so a registered
   * value would fail the resolver with `unrecognized_keys` and block every
   * save — including saves that never touched the email. It also travels to a
   * different endpoint (see `submit`), so it is not part of that payload in
   * any case.
   */
  const [workEmail, setWorkEmail] = useState("");
  const [workEmailError, setWorkEmailError] = useState(null);

  const methods = useForm({
    resolver: zodResolver(updateEmployeeSchema),
    mode: "onBlur",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [emp, fields, managers, depts, locs] = await Promise.all([
        employeesApi.get(id),
        employeeCustomFieldsApi.list().catch(() => []),
        employeesApi.list({ status: "active", pageSize: 200 }).catch(() => ({ data: [] })),
        departmentsApi.list().catch(() => []),
        locationsApi.list().catch(() => []),
      ]);

      setEmployee(emp);
      // Prepopulated from the record, and reset on every (re)load so a failed
      // save followed by a retry does not start from a stale draft.
      setWorkEmail(emp.email ?? "");
      setWorkEmailError(null);
      setCustomFields(fields);
      setDepartments(depts);
      setLocations(locs);
      setManagerOptions(
        (managers.data ?? [])
          .filter((e) => e.id !== id)
          .map((e) => ({
            value: e.id,
            label: e.displayName,
            hint: `${e.employeeCode}${e.designation ? ` · ${e.designation}` : ""}`,
          })),
      );

      methods.reset({
        firstName: emp.firstName,
        lastName: emp.lastName,
        // `email` and `employeeCode` are deliberately absent: the update
        // schema omits both and is `.strict()`, so holding them in form state
        // would fail the resolver on every save. They are displayed from
        // `identity` instead.
        personalEmail: emp.personalEmail,
        phone: emp.phone,
        phone2: emp.phone2,
        dateOfBirth: emp.dateOfBirth,
        dateOfJoining: emp.dateOfJoining,
        employmentType: emp.employmentType,
        designation: emp.designation,
        status: emp.status,
        departmentId: emp.departmentId,
        locationId: emp.locationId,
        reportingManagerId: emp.reportingManagerId,
        probationMonths: emp.probationMonths,
        probationStartDate: emp.probationStartDate,
        probationEndDate: emp.probationEndDate,
        noticeStartDate: emp.noticeStartDate,
        noticeMonths: emp.noticeMonths,
        noticeEndDate: emp.noticeEndDate,
        fatherName: emp.fatherName,
        motherName: emp.motherName,
        permanentAddress: emp.permanentAddress,
        temporaryAddress: emp.temporaryAddress,
        emergencyContacts: emp.emergencyContacts ?? [],
        dependents: emp.dependents ?? [],
        customFieldValues: emp.customFieldValues ?? {},
        // Sensitive values are NOT loaded — the API returns presence only, and
        // pre-filling a form with a decrypted PAN would put it back on the wire
        // on every edit. Leaving a field blank leaves the stored value alone;
        // typing a new one replaces it.
      });
    } catch (err) {
      setError(err instanceof HrmsApiError ? err : new HrmsApiError(err.message));
    } finally {
      setLoading(false);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const isSelf = employee && actor?.employeeId === employee.id;
  const hasOrgEdit = can(M.EMPLOYEES, A.EDIT, S.ORG);
  const canEditJobDetails = hasOrgEdit || !isSelf;

  /**
   * Who may change the work email here: HR and administrators only
   * (`employees:edit:org`), and only where there is a login to re-point.
   *
   * The same gate the profile page's Edit link uses, and the same one the
   * server enforces in `changeWorkEmail` — so an employee cannot change their
   * own sign-in address by editing their own record, which `employees:edit:self`
   * would otherwise let them reach.
   */
  const canEditWorkEmail = hasOrgEdit && Boolean(employee?.userId);

  const submit = methods.handleSubmit(async (values) => {
    // Only what actually changed. `email` and `employeeCode` are not in form
    // state at all, so there is nothing to strip here.
    const dirty = methods.formState.dirtyFields;
    const payload = Object.fromEntries(
      Object.entries(values).filter(([k]) => dirty[k] !== undefined),
    );

    const typed = workEmail.trim();
    const emailChanged =
      canEditWorkEmail && typed.toLowerCase() !== (employee.email ?? "").toLowerCase();

    /*
     * Format is checked against the SHARED schema — the one the server
     * validates with — so the two cannot drift apart. Whether the address is
     * already taken can only be answered by the server, and comes back below.
     */
    let nextEmail = null;
    if (emailChanged) {
      const parsed = changeWorkEmailSchema.safeParse({ email: typed });
      if (!parsed.success) {
        setWorkEmailError("Enter a valid email address, e.g. name@company.com.");
        return;
      }
      nextEmail = parsed.data.email;
    }

    if (!emailChanged && Object.keys(payload).length === 0) {
      toast("Nothing changed.");
      return;
    }

    setSaving(true);
    setWorkEmailError(null);
    try {
      /*
       * THE EMAIL GOES FIRST, AND ON ITS OWN ENDPOINT.
       *
       * Its own endpoint because the work email IS the login identity: it
       * carries its own permission, its own duplicate check across live AND
       * archived accounts, its own guard against re-pointing a full-access
       * account, and its own audit entry. Folding it into the profile payload
       * would mean either duplicating all of that or losing it.
       *
       * First because it is the only part of this form that can be rejected
       * for a reason the page could not know in advance — the address is
       * taken, or the account is one this actor may not touch. Running it
       * before the profile update means that the common rejection leaves the
       * record completely unchanged, rather than half-saved.
       */
      if (nextEmail) {
        try {
          await employeesApi.changeWorkEmail(id, nextEmail);
          // Kept in step so that if the profile update below fails and the
          // user saves again, the address is not resubmitted as a fresh
          // change — and so the form stops offering to save what is saved.
          setEmployee((prev) => (prev ? { ...prev, email: nextEmail } : prev));
          setWorkEmail(nextEmail);
        } catch (err) {
          const message = err.message ?? "Could not change the work email.";
          setWorkEmailError(message);
          toast.error(message);
          return;
        }
      }

      if (Object.keys(payload).length > 0) {
        try {
          await employeesApi.update(id, payload);
        } catch (err) {
          // The email is already saved at this point, so say so: otherwise a
          // failure here reads as "nothing was saved" and the next attempt
          // would be made against a record that has in fact already moved.
          toast.error(
            nextEmail
              ? `The work email was updated, but the rest could not be saved: ${err.message ?? "unknown error"}`
              : (err.message ?? "Could not save."),
          );
          return;
        }
      }

      toast.success(
        nextEmail
          ? "Employee updated. They now sign in with the new work email and the same password."
          : "Employee updated.",
      );
      navigate(`/hrms/employees/${id}`);
    } finally {
      setSaving(false);
    }
  });

  return (
    <HrmsPageLayout
      title={employee ? `Edit ${employee.displayName}` : "Edit employee"}
      subtitle={employee?.employeeCode}
      breadcrumbs={[
        { label: "HRMS", to: "/hrms/dashboard" },
        { label: "Employees", to: "/hrms/employees" },
        { label: employee?.displayName ?? "…", to: `/hrms/employees/${id}` },
        { label: "Edit" },
      ]}
      loading={loading}
      error={error}
      onRetry={load}
      actions={
        employee && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => navigate(`/hrms/employees/${id}`)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              Save changes
            </Button>
          </div>
        )
      }
    >
      {employee && (
        <FormProvider {...methods}>
          <form onSubmit={submit} noValidate>
            {isSelf && !hasOrgEdit && (
              <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                You are editing your own record, so job details are read-only. Ask HR to change
                your designation, department or reporting manager.
              </div>
            )}

            <EmployeeFormFields
              mode="edit"
              canEditJobDetails={canEditJobDetails}
              customFields={customFields}
              managerOptions={managerOptions}
              identity={{ email: employee.email, employeeCode: employee.employeeCode }}
              workEmail={
                canEditWorkEmail
                  ? {
                    value: workEmail,
                    onChange: (v) => {
                      setWorkEmail(v);
                      setWorkEmailError(null);
                    },
                    error: workEmailError,
                  }
                  : null
              }
              departments={departments}
              locations={locations}
              current={employee}
            />

            <div className="flex justify-end gap-3 mt-8 pt-5 border-t border-slate-100">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(`/hrms/employees/${id}`)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
            </div>
          </form>
        </FormProvider>
      )}
    </HrmsPageLayout>
  );
}

export default EmployeeEditPage;
