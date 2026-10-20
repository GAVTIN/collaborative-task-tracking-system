import crypto from 'node:crypto';
import config from '../../config/index.js';
import db, { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';
import { removeStoredFiles } from '../../utils/files.js';
import { buildSet } from '../../utils/sql.js';
import { daysFromNowIso, nowIso } from '../../utils/time.js';
import { notify } from '../notifications/notifications.service.js';
import { findUserByEmail } from '../users/users.service.js';

/*
 * Team roles
 *   owner  created the team; can do everything, including delete it and change roles
 *   admin  can edit the team, invite members and remove regular members; can delete any task
 *   member can see the team, create/edit tasks, assign teammates, comment and attach files
 */

// ---------------------------------------------------------------------------
// Membership / authorisation helpers (also used by the task module)
// ---------------------------------------------------------------------------

export function getMembership(teamId, userId) {
  return prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId) ?? null;
}

export const isTeamMember = (teamId, userId) => getMembership(teamId, userId) !== null;

/**
 * Returns the user's role, or throws 404 - deliberately NOT 403 - so outsiders cannot tell whether a
 * team id exists.
 */
export function requireMember(teamId, userId) {
  const membership = getMembership(teamId, userId);
  if (!membership) throw HttpError.notFound('Team not found', 'TEAM_NOT_FOUND');
  return membership.role;
}

/** Like `requireMember` but also demands one of the `allowedRoles`, otherwise 403. */
export function requireRole(teamId, userId, allowedRoles) {
  const role = requireMember(teamId, userId);
  if (!allowedRoles.includes(role)) {
    throw HttpError.forbidden(
      `This action requires the ${allowedRoles.join(' or ')} role in this team`,
      'INSUFFICIENT_TEAM_ROLE'
    );
  }
  return role;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

// The JOIN on team_members doubles as the access check: non-members simply get no row.
const TEAM_SELECT = `
  SELECT t.*, tm.role AS my_role,
         (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS member_count
  FROM teams t
  JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = @userId`;

function toTeam(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    myRole: row.my_role,
    memberCount: row.member_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getTeam(teamId, userId) {
  const row = prepare(`${TEAM_SELECT} WHERE t.id = @teamId`).get({ userId, teamId });
  if (!row) throw HttpError.notFound('Team not found', 'TEAM_NOT_FOUND');
  return toTeam(row);
}

export function listTeams(userId) {
  return prepare(`${TEAM_SELECT} ORDER BY t.name COLLATE NOCASE`).all({ userId }).map(toTeam);
}

/** Creates the team and makes the creator its owner - atomically. */
export function createTeam(userId, { name, description }) {
  const teamId = db.transaction(() => {
    const { lastInsertRowid } = prepare('INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)').run(
      name,
      description ?? '',
      userId
    );
    prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')").run(lastInsertRowid, userId);
    return Number(lastInsertRowid);
  })();
  return getTeam(teamId, userId);
}

export function updateTeam(teamId, userId, patch) {
  requireRole(teamId, userId, ['owner', 'admin']);
  const { sets, params } = buildSet(patch, { name: 'name', description: 'description' });
  if (sets.length > 0) {
    prepare(`UPDATE teams SET ${sets.join(', ')}, updated_at = @now WHERE id = @teamId`).run({
      ...params,
      now: nowIso(),
      teamId,
    });
  }
  return getTeam(teamId, userId);
}

/** Deleting a team cascades to its tasks, comments, attachments rows and invites; files are removed from disk. */
export async function deleteTeam(teamId, userId) {
  requireRole(teamId, userId, ['owner']);
  const files = prepare(
    `SELECT a.stored_name FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.team_id = ?`
  )
    .all(teamId)
    .map((row) => row.stored_name);

  prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  await removeStoredFiles(files);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function listMembers(teamId, userId) {
  requireMember(teamId, userId);
  return prepare(
    `SELECT u.id, u.name, u.email, u.job_title, tm.role, tm.joined_at
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`
  )
    .all(teamId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      jobTitle: row.job_title ?? null,
      role: row.role,
      joinedAt: row.joined_at,
    }));
}

export function updateMemberRole(teamId, actorId, targetUserId, role) {
  requireRole(teamId, actorId, ['owner']);
  const target = getMembership(teamId, targetUserId);
  if (!target) throw HttpError.notFound('Member not found', 'MEMBER_NOT_FOUND');
  if (target.role === 'owner') {
    throw HttpError.conflict("The owner's role cannot be changed", 'OWNER_ROLE_IMMUTABLE');
  }
  prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, teamId, targetUserId);
  return listMembers(teamId, actorId).find((member) => member.id === targetUserId);
}

/**
 * Removes a member (or lets a member leave).
 *  - anyone may remove themselves, except the owner (who must delete the team instead);
 *  - owners may remove any other member; admins may only remove regular members.
 * Tasks the departing member was assigned in this team become unassigned.
 */
export function removeMember(teamId, actorId, targetUserId) {
  const actorRole = requireMember(teamId, actorId);
  const target = getMembership(teamId, targetUserId);
  if (!target) throw HttpError.notFound('Member not found', 'MEMBER_NOT_FOUND');

  if (actorId === targetUserId) {
    if (actorRole === 'owner') {
      throw HttpError.conflict('The owner cannot leave the team; delete the team instead', 'OWNER_CANNOT_LEAVE');
    }
  } else {
    if (actorRole === 'member') {
      throw HttpError.forbidden('Only owners and admins can remove other members', 'INSUFFICIENT_TEAM_ROLE');
    }
    if (target.role === 'owner') throw HttpError.forbidden('The team owner cannot be removed', 'INSUFFICIENT_TEAM_ROLE');
    if (actorRole === 'admin' && target.role !== 'member') {
      throw HttpError.forbidden('Admins can only remove regular members', 'INSUFFICIENT_TEAM_ROLE');
    }
  }

  db.transaction(() => {
    prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, targetUserId);
    prepare('UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE team_id = ? AND assignee_id = ?').run(
      nowIso(),
      teamId,
      targetUserId
    );
  })();
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const INVITE_SELECT = `
  SELECT i.*, t.name AS team_name, u.name AS inviter_name
  FROM team_invites i
  JOIN teams t ON t.id = i.team_id
  JOIN users u ON u.id = i.invited_by`;

function toInvite(row) {
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    email: row.email,
    role: row.role,
    // A pending invite past its expiry is reported as expired even before any cleanup runs.
    status: row.status === 'pending' && row.expires_at <= nowIso() ? 'expired' : row.status,
    token: row.token,
    invitedBy: { id: row.invited_by, name: row.inviter_name },
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

const getInviteById = (inviteId) => toInvite(prepare(`${INVITE_SELECT} WHERE i.id = ?`).get(inviteId));

/**
 * Invites an e-mail address to the team. There is no mail server in this project, so the response
 * contains the invitation `token`; the inviter shares it (e.g. as a link). If the address already belongs to
 * a registered user, they also get an in-app notification and see the invite in `GET /api/invites`.
 */
export function createInvite(teamId, actor, { email, role }) {
  const actorRole = requireRole(teamId, actor.id, ['owner', 'admin']);
  if (role === 'admin' && actorRole !== 'owner') {
    throw HttpError.forbidden('Only the team owner can invite someone as an admin', 'INSUFFICIENT_TEAM_ROLE');
  }

  const invitee = findUserByEmail(email);
  if (invitee && isTeamMember(teamId, invitee.id)) {
    throw HttpError.conflict('This user is already a member of the team', 'ALREADY_MEMBER');
  }

  // Retire stale invitations first so the "one pending invite per email" index does not block a re-invite.
  prepare(
    "UPDATE team_invites SET status = 'expired' WHERE team_id = ? AND email = ? AND status = 'pending' AND expires_at <= ?"
  ).run(teamId, email, nowIso());
  if (prepare("SELECT 1 FROM team_invites WHERE team_id = ? AND email = ? AND status = 'pending'").get(teamId, email)) {
    throw HttpError.conflict('A pending invitation for this email already exists', 'INVITE_ALREADY_PENDING');
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const { lastInsertRowid } = prepare(
    'INSERT INTO team_invites (team_id, email, token, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(teamId, email, token, role, actor.id, daysFromNowIso(config.invites.ttlDays));

  const invite = getInviteById(lastInsertRowid);
  if (invitee) {
    notify(invitee.id, {
      type: 'team_invite',
      message: `${actor.name} invited you to join the team "${invite.teamName}"`,
      data: { inviteId: invite.id, teamId, token },
    });
  }
  return invite;
}

export function listTeamInvites(teamId, userId) {
  requireRole(teamId, userId, ['owner', 'admin']);
  return prepare(
    `${INVITE_SELECT} WHERE i.team_id = ? AND i.status = 'pending' AND i.expires_at > ? ORDER BY i.id DESC`
  )
    .all(teamId, nowIso())
    .map(toInvite);
}

export function revokeInvite(teamId, userId, inviteId) {
  requireRole(teamId, userId, ['owner', 'admin']);
  const invite = prepare("SELECT id FROM team_invites WHERE id = ? AND team_id = ? AND status = 'pending'").get(
    inviteId,
    teamId
  );
  if (!invite) throw HttpError.notFound('Pending invitation not found', 'INVITE_NOT_FOUND');
  prepare("UPDATE team_invites SET status = 'revoked', responded_at = ? WHERE id = ?").run(nowIso(), inviteId);
}

/** Invitations addressed to the signed-in user's e-mail that can still be answered. */
export function listMyInvites(user) {
  return prepare(`${INVITE_SELECT} WHERE i.email = ? AND i.status = 'pending' AND i.expires_at > ? ORDER BY i.id DESC`)
    .all(user.email, nowIso())
    .map(toInvite);
}

/** Shared validation for accept / decline. */
function loadAnswerableInvite(token, user) {
  const row = prepare(`${INVITE_SELECT} WHERE i.token = ?`).get(token);
  if (!row) throw HttpError.notFound('Invitation not found', 'INVITE_NOT_FOUND');

  if (row.email.toLowerCase() !== user.email.toLowerCase()) {
    throw HttpError.forbidden('This invitation was issued to a different email address', 'INVITE_EMAIL_MISMATCH');
  }
  if (row.status !== 'pending') {
    throw HttpError.conflict(`This invitation has already been ${row.status}`, 'INVITE_NOT_PENDING');
  }
  if (row.expires_at <= nowIso()) {
    prepare("UPDATE team_invites SET status = 'expired' WHERE id = ?").run(row.id);
    throw new HttpError(410, 'INVITE_EXPIRED', 'This invitation has expired; ask for a new one');
  }
  return row;
}

export function acceptInvite(token, user) {
  const invite = loadAnswerableInvite(token, user);

  db.transaction(() => {
    prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(
      invite.team_id,
      user.id,
      invite.role
    );
    prepare("UPDATE team_invites SET status = 'accepted', responded_at = ? WHERE id = ?").run(nowIso(), invite.id);
  })();

  notify(invite.invited_by, {
    type: 'invite_accepted',
    message: `${user.name} joined your team "${invite.team_name}"`,
    data: { teamId: invite.team_id, userId: user.id },
  });
  return getTeam(invite.team_id, user.id);
}

export function declineInvite(token, user) {
  const invite = loadAnswerableInvite(token, user);
  prepare("UPDATE team_invites SET status = 'declined', responded_at = ? WHERE id = ?").run(nowIso(), invite.id);
}
