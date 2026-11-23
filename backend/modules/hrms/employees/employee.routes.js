/**
 * Employee Master routes, mounted at /api/v1/hrms/employees.
 *
 * The parent HRMS router has already applied protect -> attachHrmsActor ->
 * requireHrmsAccess, so everything here is authenticated and holds some HRMS
 * grant. What each route adds is its own permission, at its own scope.
 *
 * Two things are deliberate about the ordering below:
 *
 *   1. `/custom-fields` is declared BEFORE `/:id`. Express matches in order, so
 *      the reverse would make "custom-fields" look like an employee id.
 *   2. Read routes list several specs. `requirePermission` is ANY-OF, so one
 *      route serves an employee reading their own record, a manager reading a
 *      report, and HR reading anyone - which is how the reference does it.
 *      `resourceParam` is what makes the narrow scopes evaluate against the
 *      actual row rather than waving through.
 */

import express from 'express';

import { requirePermission } from '../../../middlewares/hrmsAuth.js';
import { validate } from '../../../middlewares/validate.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from '../../../shared/permissions/constants.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeListQuerySchema,
  assignRolesSchema,
  revealSensitiveSchema,
  eraseEmployeeSchema,
  changeWorkEmailSchema,
  createCustomFieldSchema,
  updateCustomFieldSchema,
} from '../../../shared/schemas/employee.js';
import * as controller from './employee.controller.js';

const router = express.Router();

const canRead = requirePermission(
  { module: M.EMPLOYEES, action: A.VIEW, scope: S.ORG },
  { module: M.EMPLOYEES, action: A.VIEW, scope: S.TEAM, resourceParam: 'id' },
  { module: M.EMPLOYEES, action: A.VIEW, scope: S.SELF, resourceParam: 'id' },
);

const canEdit = requirePermission(
  { module: M.EMPLOYEES, action: A.EDIT, scope: S.ORG },
  { module: M.EMPLOYEES, action: A.EDIT, scope: S.SELF, resourceParam: 'id' },
);

const canEditOrg = requirePermission({ module: M.EMPLOYEES, action: A.EDIT, scope: S.ORG });

// ---------------------------------------------------------------------------
// Custom field definitions - before /:id, see the note above
// ---------------------------------------------------------------------------

router.get(
  '/custom-fields',
  requirePermission(
    { module: M.EMPLOYEES, action: A.VIEW, scope: S.ORG },
    { module: M.EMPLOYEES, action: A.VIEW, scope: S.TEAM },
    // An employee filling in their own profile still needs the definitions to
    // render the form.
    { module: M.EMPLOYEES, action: A.VIEW, scope: S.SELF },
  ),
  controller.listCustomFields,
);

router.post(
  '/custom-fields',
  canEditOrg,
  validate({ body: createCustomFieldSchema }),
  controller.createCustomField,
);

router.patch(
  '/custom-fields/:id',
  canEditOrg,
  validate({ body: updateCustomFieldSchema }),
  controller.updateCustomField,
);

router.delete('/custom-fields/:id', canEditOrg, controller.deleteCustomField);

// ---------------------------------------------------------------------------
// Portal -> HRMS synchronisation - before /:id, see the note at the top
// ---------------------------------------------------------------------------

/**
 * Reading the backlog is an HR question ("who is missing a record"), so it
 * sits on `employees:edit:org` rather than on the read grant an employee holds
 * for their own profile: the rows name other people's accounts and the errors
 * behind them.
 *
 * RUNNING the sweep creates employee records, so it is gated on exactly the
 * permission that creating one by hand needs. Anything looser would make this
 * a way to create employees without `employees:create:org`.
 */
router.get('/sync/status', canEditOrg, controller.getSyncStatus);

router.post(
  '/sync/run',
  requirePermission({ module: M.EMPLOYEES, action: A.CREATE, scope: S.ORG }),
  controller.runSync,
);

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

router.get(
  '/',
  // No resourceParam: this is a collection read, and the SERVICE narrows the
  // query by scope. Checking a resource here would be meaningless, and
  // filtering after the fetch would make the pagination total wrong.
  requirePermission(
    { module: M.EMPLOYEES, action: A.VIEW, scope: S.ORG },
    { module: M.EMPLOYEES, action: A.VIEW, scope: S.TEAM },
    { module: M.EMPLOYEES, action: A.VIEW, scope: S.SELF },
  ),
  validate({ query: employeeListQuerySchema }),
  controller.listEmployees,
);

router.post(
  '/',
  requirePermission({ module: M.EMPLOYEES, action: A.CREATE, scope: S.ORG }),
  validate({ body: createEmployeeSchema }),
  controller.createEmployee,
);

// ---------------------------------------------------------------------------
// One employee
// ---------------------------------------------------------------------------

router.get('/:id', canRead, controller.getEmployee);

router.patch('/:id', canEdit, validate({ body: updateEmployeeSchema }), controller.updateEmployee);

/**
 * Soft delete. `employees:delete:org` is held by super_admin alone in the
 * matrix, which matches the reference: deactivating someone is not an ordinary
 * HR edit.
 */
router.delete(
  '/:id',
  requirePermission({ module: M.EMPLOYEES, action: A.DELETE, scope: S.ORG }),
  controller.deactivateEmployee,
);

/**
 * Permanent delete — the employee, their login and their HRMS records; see
 * employeeErasure.js. The same grant as deactivating. A POST with the typed
 * employee code rather than a DELETE, because the confirmation is part of the
 * request and a DELETE body is not something every client and proxy passes on.
 */
router.get(
  '/:id/erasure-preview',
  requirePermission({ module: M.EMPLOYEES, action: A.DELETE, scope: S.ORG }),
  controller.previewEmployeeErasure,
);

router.post(
  '/:id/erase',
  requirePermission({ module: M.EMPLOYEES, action: A.DELETE, scope: S.ORG }),
  validate({ body: eraseEmployeeSchema }),
  controller.eraseEmployee,
);

/**
 * Reveal one sensitive value.
 *
 * Gated on compensation access, not employee access: someone who may edit a
 * profile has no business reading its bank account. The service re-checks.
 */
router.post(
  '/:id/reveal',
  requirePermission({ module: M.EMPLOYEES_COMPENSATION, action: A.VIEW, scope: S.ORG }),
  validate({ body: revealSensitiveSchema }),
  controller.revealSensitiveField,
);

router.get('/:id/roles', canEditOrg, controller.getEmployeeRoles);

router.patch(
  '/:id/roles',
  canEditOrg,
  validate({ body: assignRolesSchema }),
  controller.assignEmployeeRoles,
);

/**
 * Change the work email - the login identity - after creation. Org-level edit
 * only (HR / admin): `employees:edit:self` does NOT reach this, so an employee
 * cannot re-point their own sign-in address. The service re-checks.
 */
router.patch(
  '/:id/email',
  canEditOrg,
  validate({ body: changeWorkEmailSchema }),
  controller.changeWorkEmail,
);

/** Super admin only; the service enforces that, not this gate. */
router.post('/:id/reset-password', canEditOrg, controller.resetEmployeePassword);

export default router;
