/**
 * `npm run seed` - fills the database with demo data so the API can be explored immediately.
 *
 * Creates three users, one team, and a handful of tasks with comments. Safe to run repeatedly:
 * it does nothing if the demo users already exist.
 *
 * Demo logins (password for all: Password123):
 *   alice@example.com   (team owner)
 *   bob@example.com     (member)
 *   carol@example.com   (member)
 */
import db, { prepare } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { daysFromNowIso } from '../src/utils/time.js';

migrate();

if (prepare('SELECT 1 FROM users WHERE email = ?').get('alice@example.com')) {
  console.log('Demo data already present - nothing to do.');
  db.close();
  process.exit(0);
}

const passwordHash = await hashPassword('Password123');

db.transaction(() => {
  const addUser = (name, email, jobTitle) =>
    Number(
      prepare('INSERT INTO users (name, email, password_hash, job_title) VALUES (?, ?, ?, ?)').run(
        name,
        email,
        passwordHash,
        jobTitle
      ).lastInsertRowid
    );

  const alice = addUser('Alice Johnson', 'alice@example.com', 'Engineering Manager');
  const bob = addUser('Bob Smith', 'bob@example.com', 'Backend Developer');
  const carol = addUser('Carol Diaz', 'carol@example.com', 'Designer');

  const teamId = Number(
    prepare('INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)').run(
      'Website Relaunch',
      'Everything needed to ship the new marketing site.',
      alice
    ).lastInsertRowid
  );
  const addMember = prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)');
  addMember.run(teamId, alice, 'owner');
  addMember.run(teamId, bob, 'member');
  addMember.run(teamId, carol, 'member');

  const addTask = (title, description, status, priority, dueInDays, assignee, creator, team = teamId) =>
    Number(
      prepare(
        `INSERT INTO tasks (title, description, status, priority, due_date, team_id, created_by, assignee_id, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        title,
        description,
        status,
        priority,
        dueInDays === null ? null : daysFromNowIso(dueInDays),
        team,
        creator,
        assignee,
        status === 'completed' ? daysFromNowIso(-1) : null
      ).lastInsertRowid
    );

  const design = addTask('Design homepage mockups', 'Hero, pricing and testimonials sections.', 'in_progress', 'high', 3, carol, alice);
  addTask('Set up CI pipeline', 'Run tests and linting on every pull request.', 'open', 'medium', 7, bob, alice);
  addTask('Write launch announcement', 'Blog post and social copy.', 'open', 'low', 14, null, alice);
  addTask('Choose hosting provider', 'Compare three options on cost and latency.', 'completed', 'medium', -2, bob, alice);
  addTask('Fix broken contact form', 'Submissions currently return a 500.', 'open', 'high', -1, bob, carol); // overdue
  addTask('Buy birthday gift', 'Personal reminder - only Alice can see this.', 'open', 'low', 5, alice, alice, null);

  const addComment = prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)');
  addComment.run(design, alice, 'Can we get a first draft by Thursday?');
  addComment.run(design, carol, 'Yes - sharing the Figma link tomorrow.');
})();

console.log('Seeded demo data. Log in with alice@example.com / Password123');
db.close();
