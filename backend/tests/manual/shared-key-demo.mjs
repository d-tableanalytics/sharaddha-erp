/**
 * THROWAWAY demonstration for the 2026-11-24 RBAC audit. Not part of the suite.
 *
 *   node --test tests/manual/shared-key-demo.mjs
 *
 * Shows what happens when an Admin leaves a cell UNTICKED whose permission key
 * is also carried by a cell that IS ticked. Mirrors the setup in
 * tests/matrix-authoritative.test.js exactly.
 */

import test from 'node:test';

import Role from '../../models/Role.js';
import { can, loadRoles } from '../../utils/roleResolver.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from '../helpers/mongo.js';

test.before(async () => { await startTestMongo(); await syncIndexes(Role); });
test.after(async () => { await stopTestMongo(); });

test('a cell left unticked is still allowed when a ticked sibling shares its key', async () => {
  await clearCollections();

  // The Admin ticks EXACTLY ONE cell: Work Queue > Tasks > view.
  await Role.create({
    name: 'Management',
    isSystem: true,
    grants: [{ module: 'work_queue', submodule: 'tasks', actions: ['view'] }],
    permissions: [],
  });
  await loadRoles();

  const user = { role: 'Management' };

  console.log('\n  TICKED:  work_queue.tasks:view   (and nothing else)\n');
  for (const [sub, action] of [
    ['tasks', 'view'],
    ['tasks', 'create'],
    ['checklist', 'view'],
    ['scoreboard', 'view'],
  ]) {
    const allowed = can(user, 'work_queue', sub, action);
    const ticked = sub === 'tasks' && action === 'view';
    const note = allowed && !ticked ? '   <-- NOT TICKED, STILL ALLOWED' : '';
    console.log(`    work_queue.${sub}:${action}`.padEnd(38) + `->  ${allowed ? 'ALLOWED' : 'denied '}${note}`);
  }

  // Now the revocation case: the Admin unticks Checklist > create, intending to
  // stop this role creating checklist items, and leaves Tasks > create ticked.
  await Role.updateOne({ name: 'Management' }, {
    $set: { grants: [{ module: 'work_queue', submodule: 'tasks', actions: ['view', 'create'] }] },
  });
  await loadRoles();

  console.log('\n  TICKED:  work_queue.tasks:view + tasks:create');
  console.log('  UNTICKED (deliberately): work_queue.checklist:create\n');
  for (const [sub, action] of [['tasks', 'create'], ['checklist', 'create'], ['checklist', 'edit']]) {
    const allowed = can(user, 'work_queue', sub, action);
    const note = allowed && sub === 'checklist' ? '   <-- REVOCATION DID NOT TAKE' : '';
    console.log(`    work_queue.${sub}:${action}`.padEnd(38) + `->  ${allowed ? 'ALLOWED' : 'denied '}${note}`);
  }
  console.log();
});
