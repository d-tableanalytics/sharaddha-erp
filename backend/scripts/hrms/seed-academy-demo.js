/**
 * Demo content for SI Academy.
 *
 *   npm run academy:seed          # create the sample catalogue
 *   npm run academy:seed -- --force   # recreate it if it is already there
 *
 * ---------------------------------------------------------------------------
 * A SCRIPT, NOT A BOOT-TIME SEEDER
 * ---------------------------------------------------------------------------
 * `server.js` says in its own words that this process does NO seeding, because
 * it shares a database with the Customer Portal and one writer owns the seed
 * data. Hanging demo content off boot would break that rule, and would also put
 * a sample learning path into a production database the first time somebody
 * restarted the API.
 *
 * So this is run deliberately, by a person, like `hrms:import` and
 * `hrms:migrate-keys` beside it.
 *
 * ---------------------------------------------------------------------------
 * IT REFUSES TO RUN IN PRODUCTION
 * ---------------------------------------------------------------------------
 * Not because the data is dangerous, but because a learning path called "Sample"
 * that nobody remembers creating is the kind of thing that ends up assigned to
 * real employees. `NODE_ENV=production` stops it; `--force-production` is
 * deliberately NOT an option.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It creates no CONTENT ITEMS, and therefore no video or PDF lessons, because
 * a content item without an object in storage is a lesson that fails when a
 * learner opens it — exactly the broken state section 24 asks the module to
 * avoid. Upload a video and a PDF through the Content Library, then add them to
 * the "Company Orientation" course this creates.
 *
 * What it DOES create is everything that needs no bytes: the paths, the course
 * structure, a real assessment with real questions, and an assignment rule.
 * That is enough to exercise the whole flow end to end.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { connectDatabase } from '../../config/database.js';
import {
  LearningPath,
  AcademyCourse,
  Assessment,
  AssignmentRule,
} from '../../models/hrms/AcademyModels.js';
import Department from '../../models/hrms/Department.js';

dotenv.config();

const force = process.argv.includes('--force');

const log = (...args) => console.log('[academy:seed]', ...args);

// ---------------------------------------------------------------------------
// The sample catalogue
// ---------------------------------------------------------------------------

/**
 * Two paths, because one is not enough to show what the module is for: an
 * everyone-path that a `matchAll` rule assigns, and a department-specific one
 * that a criteria rule assigns. Section 11's two examples, made real.
 */
const PATHS = [
  {
    key: 'orientation',
    name: 'New Employee — Company Orientation',
    description:
      'What every new joiner needs in their first week: who we are, how we work, and the policies everybody signs.',
    dueDateMode: 'joining_plus_days',
    dueDays: 7,
    mandatory: true,
    sequential: true,
    requiresCertificate: false,
    courses: [
      {
        name: 'Welcome to the Company',
        description: 'Our history, our customers, and how the business actually makes money.',
        estimatedMinutes: 20,
      },
      {
        name: 'HR Policies',
        description: 'Leave, attendance, expenses and the things people ask HR most often.',
        estimatedMinutes: 30,
      },
      {
        name: 'Code of Conduct',
        description: 'What is expected of everybody, and how to raise a concern.',
        estimatedMinutes: 20,
      },
    ],
  },
  {
    key: 'it-onboarding',
    name: 'IT — New Employee Onboarding',
    description:
      'The security and systems induction every new IT hire completes in their first fortnight.',
    dueDateMode: 'joining_plus_days',
    dueDays: 15,
    mandatory: true,
    sequential: true,
    requiresCertificate: true,
    certificateValidityMonths: 12,
    courses: [
      {
        name: 'IT Security Awareness',
        description: 'Passwords, phishing, and what to do when something looks wrong.',
        estimatedMinutes: 45,
      },
      {
        name: 'Data Protection',
        description: 'How we handle customer and employee data, and what the law requires.',
        estimatedMinutes: 30,
      },
      {
        name: 'Final Assessment',
        description: 'Confirm what you have learned. 70% to pass, unlimited retries.',
        estimatedMinutes: 15,
        withAssessment: true,
      },
    ],
  },
];

/** A real assessment — five questions, plausible answers, one genuinely tricky. */
const ASSESSMENT = {
  title: 'IT Security Assessment',
  description: 'Covers the Security Awareness and Data Protection courses.',
  passingPercent: 70,
  maxAttempts: null,
  scorePolicy: 'highest',
  shuffleQuestions: true,
  questions: [
    {
      text: 'You receive an email from "IT Support" asking you to confirm your password via a link. What should you do?',
      type: 'single',
      options: [
        { text: 'Report it to the IT helpdesk and do not click the link', isCorrect: true },
        { text: 'Click the link but only enter your username', isCorrect: false },
        { text: 'Reply asking whether the email is genuine', isCorrect: false },
        { text: 'Forward it to your team so they are warned', isCorrect: false },
      ],
    },
    {
      text: 'Which of these make a password stronger? Select all that apply.',
      type: 'multiple',
      options: [
        { text: 'Length — a longer passphrase beats a short complex one', isCorrect: true },
        { text: 'Being unique to one account', isCorrect: true },
        { text: 'Being stored in an approved password manager', isCorrect: true },
        { text: 'Replacing letters with lookalike numbers, like P4ssw0rd', isCorrect: false },
      ],
    },
    {
      text: 'You need to send a customer list to a colleague working from home. What is the right approach?',
      type: 'single',
      options: [
        { text: 'Share it through the approved company system', isCorrect: true },
        { text: 'Email it to their personal address so it arrives faster', isCorrect: false },
        { text: 'Copy it to a personal USB drive and share that', isCorrect: false },
        { text: 'Upload it to a free file-sharing site and send the link', isCorrect: false },
      ],
    },
    {
      text: 'You realise you have sent a file containing employee bank details to the wrong person. What do you do first?',
      type: 'single',
      options: [
        { text: 'Report it immediately, even though it was a mistake', isCorrect: true },
        { text: 'Ask the recipient to delete it and say nothing further', isCorrect: false },
        { text: 'Wait to see whether anything comes of it', isCorrect: false },
        { text: 'Delete your copy so the file cannot be traced to you', isCorrect: false },
      ],
    },
    {
      text: 'Which of these count as personal data? Select all that apply.',
      type: 'multiple',
      options: [
        { text: 'An employee’s bank account number', isCorrect: true },
        { text: 'A customer’s mobile number', isCorrect: true },
        { text: 'A work email address that identifies a named person', isCorrect: true },
        { text: 'The company’s registered office address', isCorrect: false },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[academy:seed] Refusing to run with NODE_ENV=production. This creates sample\n' +
        '               learning paths, and a path nobody remembers creating is a path\n' +
        '               that ends up assigned to real employees.',
    );
    process.exitCode = 1;
    return;
  }

  await connectDatabase();

  const existing = await LearningPath.countDocuments({ deletedAt: null });
  if (existing > 0 && !force) {
    log(`${existing} learning path(s) already exist. Nothing to do.`);
    log('Pass --force to add the sample catalogue anyway.');
    await mongoose.disconnect();
    return;
  }

  // ---- the assessment, first: a lesson has to point at something ----------
  let assessment = await Assessment.findOne({ title: ASSESSMENT.title, deletedAt: null });
  if (!assessment) {
    assessment = await Assessment.create({
      ...ASSESSMENT,
      questions: ASSESSMENT.questions.map((q, order) => ({ ...q, order })),
    });
    log(`Created assessment "${assessment.title}" with ${assessment.questions.length} questions.`);
  } else {
    log(`Assessment "${assessment.title}" already exists — reusing it.`);
  }

  // ---- paths and their courses -------------------------------------------
  const created = {};

  for (const spec of PATHS) {
    let path = await LearningPath.findOne({ name: spec.name, deletedAt: null });

    if (path) {
      log(`Path "${spec.name}" already exists — reusing it.`);
    } else {
      path = await LearningPath.create({
        name: spec.name,
        description: spec.description,
        dueDateMode: spec.dueDateMode,
        dueDays: spec.dueDays,
        mandatory: spec.mandatory,
        sequential: spec.sequential,
        requiresCertificate: spec.requiresCertificate,
        certificateValidityMonths: spec.certificateValidityMonths ?? null,
        active: true,
      });
      log(`Created path "${path.name}".`);
    }

    created[spec.key] = path;

    for (const [order, course] of spec.courses.entries()) {
      const already = await AcademyCourse.findOne({
        pathId: path._id,
        name: course.name,
        deletedAt: null,
      });
      if (already) continue;

      await AcademyCourse.create({
        pathId: path._id,
        name: course.name,
        description: course.description,
        estimatedMinutes: course.estimatedMinutes,
        mandatory: true,
        order,
        active: true,
        /**
         * Only the assessment course gets a lesson. The others are deliberately
         * empty until somebody uploads a video or a PDF for them — a lesson
         * pointing at content that does not exist is worse than no lesson.
         */
        lessons: course.withAssessment
          ? [
              {
                title: 'IT Security Assessment',
                description: 'Five questions. 70% to pass.',
                type: 'quiz',
                assessmentId: assessment._id,
                mandatory: true,
                order: 0,
              },
            ]
          : [],
      });
      log(`  + course "${course.name}"`);
    }
  }

  // ---- the two rules ------------------------------------------------------
  const orientationRule = await AssignmentRule.findOne({
    name: 'All new employees — orientation',
    deletedAt: null,
  });
  if (!orientationRule) {
    await AssignmentRule.create({
      name: 'All new employees — orientation',
      pathId: created.orientation._id,
      pathName: created.orientation.name,
      matchAll: true,
      trigger: 'on_create',
      active: true,
      priority: 10,
    });
    log('Created rule "All new employees — orientation" (company-wide).');
  }

  /**
   * The department rule needs a department to point at, and department names
   * are the customer's rather than ours (AD-1). So it is created ONLY if a
   * department already exists whose code looks like IT, and it is left inactive
   * either way — an administrator reviews and enables it.
   */
  const itDepartment = await Department.findOne({
    deletedAt: null,
    $or: [{ code: 'IT' }, { name: /^information technology$/i }, { name: /^it$/i }],
  });

  const itRule = await AssignmentRule.findOne({ name: 'IT — new hire induction', deletedAt: null });
  if (!itRule) {
    if (itDepartment) {
      await AssignmentRule.create({
        name: 'IT — new hire induction',
        pathId: created['it-onboarding']._id,
        pathName: created['it-onboarding'].name,
        matchAll: false,
        criteria: {
          departmentIds: [itDepartment._id],
          locationIds: [],
          designations: [],
          employmentTypes: ['full_time'],
        },
        trigger: 'on_create',
        // OFF. It assigns training automatically to every future IT hire, and
        // that is a decision for an administrator rather than for a seed script.
        active: false,
        priority: 20,
      });
      log(
        `Created rule "IT — new hire induction" targeting department "${itDepartment.name}" — INACTIVE.`,
      );
      log('  Review it under SI Academy > Rules and switch it on when you are ready.');
    } else {
      log('No IT department found, so the department-specific rule was not created.');
      log('  Create one under Org Structure, then add a rule under SI Academy > Rules.');
    }
  }

  log('');
  log('Done. Next steps:');
  log('  1. Upload a video and a PDF under SI Academy > Content Library.');
  log('  2. Add them as lessons to the orientation courses.');
  log('  3. Create an employee, or run a rule, to see an assignment appear.');

  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error('[academy:seed] failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
