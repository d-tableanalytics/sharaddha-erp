/**
 * Write every built-in role's compiled-in baseline into its database row.
 *
 *   node scripts/seed-role-baselines.js            # report only
 *   node scripts/seed-role-baselines.js --apply    # write
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT MUST RUN BEFORE THE NEXT DEPLOY
 * ---------------------------------------------------------------------------
 *
 * `resolveRolePermissions` used to answer `baseline(role) UNION grants`. It now
 * answers `grants` alone whenever the role has a row, so that unticking a cell
 * in the permission matrix actually takes the permission away — see the header
 * on that function for the full argument.
 *
 * The switch is only safe if every built-in role's row already SAYS what the
 * baseline used to say for it. Otherwise the first resolve after deploying
 * returns whatever half-populated row happens to be in Mongo, and a Sales user
 * signs in to an empty sidebar.
 *
 * So this script is the migration. For each role in BASELINE_ROLE_PERMISSIONS
 * it computes the matrix cells equivalent to that baseline and writes them,
 * creating the row if it is missing.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO
 * ---------------------------------------------------------------------------
 *
 * It never REMOVES a grant. A role that has been re-permissioned since the
 * matrix shipped keeps every cell it has been given; the baseline is unioned
 * into that, not substituted for it. Running this twice is a no-op, and running
 * it after an administrator has widened a role does not undo their work.
 *
 * It cannot NARROW a role either, which is the point: this is the last moment
 * the baseline is authoritative. From here on, narrowing is what the matrix is
 * for.
 *
 * ---------------------------------------------------------------------------
 * THE ONE KEY THAT IS NOT A MATRIX CELL
 * ---------------------------------------------------------------------------
 *
 * `grantsFromPermissions` only grants an action when the role holds EVERY key
 * behind it — deliberately, because a cell compiles back to all of its keys and
 * a looser rule would hand Sales `manage_users` on the way to giving them
 * `manage_customer_users`. That is a privilege escalation, and a migration is
 * the last place to introduce one.
 *
 * So a baseline key that no cell can express on its own is written to the
 * legacy flat `permissions` array instead, which the resolver still reads.
 * Across all eleven built-in roles exactly one key lands there:
 * `manage_customer_users` for Sales.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDatabase } from '../config/database.js';
import Role from '../models/Role.js';
import {
  BASELINE_ROLE_PERMISSIONS,
  baselineFor,
  isSuperAdminRoleName,
  isPortalOnlyRoleName,
} from '../config/permissions.js';
import { grantsFromPermissions, compileGrants } from '../config/moduleRegistry.js';

const APPLY = process.argv.includes('--apply');

/** Merge two grant lists, unioning the actions of any cell they share. */
const mergeGrants = (existing = [], incoming = []) => {
  const byCell = new Map();

  for (const grant of [...existing, ...incoming]) {
    if (!grant?.module || !grant?.submodule) continue;
    const cell = `${grant.module}.${grant.submodule}`;
    const actions = byCell.get(cell) ?? new Set();
    for (const action of grant.actions || []) actions.add(action);
    byCell.set(cell, actions);
  }

  return [...byCell.entries()].map(([cell, actions]) => {
    const [module, submodule] = cell.split('.');
    return { module, submodule, actions: [...actions] };
  });
};

const run = async () => {
  await connectDatabase();

  const names = Object.keys(BASELINE_ROLE_PERMISSIONS);
  console.log(`\n[seed-role-baselines] ${names.length} built-in roles; mode: ${APPLY ? 'APPLY' : 'REPORT ONLY'}\n`);

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const name of names) {
    const baseline = baselineFor(name);
    const existing = await Role.findOne({ name }).lean();

    // The wildcard roles carry a FLAG, not a list of every permission ever
    // written. A role marked super-admin is complete by definition; a role
    // holding today's whole key set stops being complete when a module ships.
    if (baseline.includes('*') || isSuperAdminRoleName(name)) {
      if (!existing) {
        console.log(`  + ${name}: creating (isSuperAdmin)`);
        if (APPLY) {
          await Role.create({ name, isSuperAdmin: true, isSystem: true, grants: [], permissions: [] });
        }
        created += 1;
      } else if (!existing.isSuperAdmin) {
        console.log(`  ~ ${name}: setting isSuperAdmin`);
        if (APPLY) await Role.updateOne({ _id: existing._id }, { $set: { isSuperAdmin: true } });
        updated += 1;
      } else {
        unchanged += 1;
      }
      continue;
    }

    const wanted = grantsFromPermissions(baseline);
    const expressible = new Set(compileGrants(wanted));
    const leftovers = baseline.filter((key) => !expressible.has(key));

    if (!existing) {
      console.log(`  + ${name}: creating with ${wanted.length} cells${leftovers.length ? ` + ${leftovers.length} flat` : ''}`);
      if (APPLY) {
        await Role.create({
          name,
          isSystem: true,
          portalOnly: isPortalOnlyRoleName(name),
          grants: wanted,
          permissions: leftovers,
        });
      }
      created += 1;
      continue;
    }

    const grants = mergeGrants(existing.grants, wanted);
    const permissions = [...new Set([...(existing.permissions || []), ...leftovers])];

    const grantsChanged = JSON.stringify(grants) !== JSON.stringify(existing.grants || []);
    const permsChanged = permissions.length !== (existing.permissions || []).length;

    if (!grantsChanged && !permsChanged) {
      unchanged += 1;
      continue;
    }

    console.log(`  ~ ${name}: ${existing.grants?.length ?? 0} -> ${grants.length} cells${leftovers.length ? `, flat: ${leftovers.join(', ')}` : ''}`);
    if (APPLY) {
      await Role.updateOne(
        { _id: existing._id },
        { $set: { grants, permissions, isSystem: true } },
      );
    }
    updated += 1;
  }

  console.log(`\n  created: ${created}  updated: ${updated}  unchanged: ${unchanged}`);
  if (!APPLY) console.log('\n  Nothing was written. Re-run with --apply.\n');

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('[seed-role-baselines] failed:', err);
  process.exit(1);
});
