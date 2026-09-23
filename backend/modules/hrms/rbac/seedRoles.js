/**
 * Seed the eight HRMS roles as editable database rows, if they do not already
 * exist.
 *
 * Its own file, separate from `hrms.bootstrap.js`, so a caller that needs
 * only the seed - the test helper that resets the database between every
 * test, chiefly - does not pull in every OTHER registration
 * `hrms.bootstrap.js` performs (retention handlers, file access rules,
 * reference providers) just to import one function.
 *
 * See `customRole.service.js`'s file header for why this exists at all: every
 * HRMS role, these eight included, is now an ordinary editable database row,
 * and an actor's permissions resolve from here rather than from
 * `shared/permissions/matrix.js` at request time.
 *
 * NEVER OVERWRITES. `findOne`-then-`create`, per key, not an upsert - an
 * administrator's edit from yesterday must survive today's restart (or the
 * next test's `beforeEach`), or "editable" would not mean anything.
 */

import { HrmsRole } from '../../../models/hrms/RoleModels.js';
import { HRMS_ROLE_LIST, HRMS_ROLE_LABELS } from '../../../shared/permissions/constants.js';
import { HRMS_PERMISSION_MATRIX } from '../../../shared/permissions/matrix.js';

export async function seedHrmsRoles() {
  for (const key of HRMS_ROLE_LIST) {
    // eslint-disable-next-line no-await-in-loop -- eight rows; a bulk upsert
    // would risk exactly the overwrite this function exists to avoid if it
    // were ever changed to `upsert: true` by mistake.
    const exists = await HrmsRole.exists({ key });
    if (exists) continue;

    // eslint-disable-next-line no-await-in-loop
    await HrmsRole.create({
      key,
      label: HRMS_ROLE_LABELS[key] ?? key,
      permissions: HRMS_PERMISSION_MATRIX[key] ?? [],
    });
  }
}

export default seedHrmsRoles;
