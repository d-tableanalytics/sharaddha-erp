/**
 * A real MongoDB, in memory, for tests that are about database behaviour.
 *
 * Most HRMS tests are pure and need none of this. These do: a partial unique
 * index, an aggregation, and a delete guard that counts rows are all things
 * whose behaviour lives in the database. Asserting them against a mock would
 * only prove the mock agrees with itself — and the index in particular is the
 * single thing standing between two live departments and the same code.
 *
 * `mongodb-memory-server` downloads a real mongod on first use and runs it on a
 * random port; nothing touches the configured MONGODB_URI.
 */

import mongoose from 'mongoose';

import { seedHrmsRoles } from '../../modules/hrms/rbac/seedRoles.js';

/** First start includes a binary download on a cold machine. */
const LAUNCH_TIMEOUT_MS = 120_000;

let server = null;

/**
 * Start mongod and connect mongoose. Call from a `before` hook.
 *
 * Seeds the eight HRMS roles before returning, so a suite whose first test
 * runs before any `clearCollections()` call still finds them defined - the
 * same reason `clearCollections()` reseeds after every wipe.
 */
export async function startTestMongo() {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  server = await MongoMemoryServer.create({ instance: { launchTimeout: LAUNCH_TIMEOUT_MS } });
  await mongoose.connect(server.getUri(), { dbName: 'hrms_test' });
  await seedHrmsRoles();
  return server.getUri();
}

export async function stopTestMongo() {
  await mongoose.disconnect();
  if (server) await server.stop();
  server = null;
}

/**
 * Build the declared indexes for these models.
 *
 * Mongoose creates indexes in the background, so without this a test could
 * insert a duplicate before the unique index exists and pass for the wrong
 * reason. `syncIndexes` also drops indexes the schema no longer declares, so
 * the collection matches the model exactly.
 */
export async function syncIndexes(...models) {
  for (const model of models) await model.syncIndexes();
}

/**
 * Empty every collection, so each test starts from a known state - then
 * reseed the eight HRMS roles.
 *
 * The reseed exists because permissions now resolve from `HrmsRole` documents
 * rather than from code (see `modules/hrms/rbac/seedRoles.js`), and this
 * helper's whole job is wiping every collection on the connection, `HrmsRole`
 * included. Without it, every test in every HRMS suite would start each case
 * with `hrms_employee`, `hrms_super_admin` and the rest defined nowhere, and
 * a `stubProtect(user)` naming one of those keys would grant nothing. The
 * eight args this used to ignore were already a hint that call sites expected
 * SOME of that state to survive a clear; this makes the one piece that has
 * to, in every suite, do so without every test file re-deriving it.
 */
export async function clearCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  await seedHrmsRoles();
}

export default { startTestMongo, stopTestMongo, syncIndexes, clearCollections };
