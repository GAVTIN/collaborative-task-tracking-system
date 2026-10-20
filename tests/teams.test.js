import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, createTask, createTeamWith, createUser } from './helpers.js';

describe('teams (user story 11)', () => {
  it('creates a team and makes the creator its owner', async () => {
    const owner = await createUser();
    const res = await as(owner).post('/api/teams', { name: 'Platform', description: 'Infra folks' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.name, 'Platform');
    assert.equal(res.body.data.myRole, 'owner');
    assert.equal(res.body.data.memberCount, 1);
  });

  it('lists only the teams the user belongs to', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await as(alice).post('/api/teams', { name: 'Alice Team' });
    await as(bob).post('/api/teams', { name: 'Bob Team' });

    const res = await as(alice).get('/api/teams');
    assert.deepEqual(res.body.data.map((t) => t.name), ['Alice Team']);
  });

  it('hides teams from non-members with a 404 (not 403)', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const team = await createTeamWith(owner);

    assert.equal((await as(outsider).get(`/api/teams/${team.id}`)).status, 404);
    assert.equal((await as(outsider).get(`/api/teams/${team.id}/members`)).status, 404);
  });

  it('validates the team body', async () => {
    const owner = await createUser();
    const res = await as(owner).post('/api/teams', { name: '   ' });
    assert.equal(res.status, 422);
  });

  it('lets owner/admin edit, but not plain members', async () => {
    const owner = await createUser();
    const member = await createUser();
    const team = await createTeamWith(owner, [member]);

    const denied = await as(member).patch(`/api/teams/${team.id}`, { name: 'Hijacked' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'INSUFFICIENT_TEAM_ROLE');

    const ok = await as(owner).patch(`/api/teams/${team.id}`, { name: 'Renamed' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.name, 'Renamed');
  });

  it('lets only the owner delete a team', async () => {
    const owner = await createUser();
    const member = await createUser();
    const team = await createTeamWith(owner, [member]);

    assert.equal((await as(member).delete(`/api/teams/${team.id}`)).status, 403);
    assert.equal((await as(owner).delete(`/api/teams/${team.id}`)).status, 204);
    assert.equal((await as(owner).get(`/api/teams/${team.id}`)).status, 404);
  });
});

describe('invitations (user story 11)', () => {
  it('invites by e-mail; the invitee sees it, accepts it and joins', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const team = await createTeamWith(owner);

    const invite = await as(owner).post(`/api/teams/${team.id}/invites`, { email: invitee.email });
    assert.equal(invite.status, 201);
    assert.equal(invite.body.data.status, 'pending');
    assert.ok(invite.body.data.token.length > 20);

    const mine = await as(invitee).get('/api/invites');
    assert.equal(mine.body.data.length, 1);
    assert.equal(mine.body.data[0].teamName, team.name);

    const accepted = await as(invitee).post(`/api/invites/${invite.body.data.token}/accept`);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.myRole, 'member');

    const members = await as(owner).get(`/api/teams/${team.id}/members`);
    assert.equal(members.body.data.length, 2);
    assert.equal(members.body.data[0].role, 'owner'); // owner sorts first
  });

  it('notifies a registered invitee and the inviter on acceptance', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const team = await createTeamWith(owner);

    const invite = await as(owner).post(`/api/teams/${team.id}/invites`, { email: invitee.email });
    const inviteeNotes = await as(invitee).get('/api/notifications');
    assert.equal(inviteeNotes.body.data[0].type, 'team_invite');

    await as(invitee).post(`/api/invites/${invite.body.data.token}/accept`);
    const ownerNotes = await as(owner).get('/api/notifications');
    assert.equal(ownerNotes.body.data[0].type, 'invite_accepted');
  });

  it('rejects inviting an existing member or duplicating a pending invite', async () => {
    const owner = await createUser();
    const member = await createUser();
    const other = await createUser();
    const team = await createTeamWith(owner, [member]);

    const already = await as(owner).post(`/api/teams/${team.id}/invites`, { email: member.email });
    assert.equal(already.status, 409);
    assert.equal(already.body.error.code, 'ALREADY_MEMBER');

    await as(owner).post(`/api/teams/${team.id}/invites`, { email: other.email });
    const dup = await as(owner).post(`/api/teams/${team.id}/invites`, { email: other.email });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'INVITE_ALREADY_PENDING');
  });

  it('only lets the addressed account accept an invitation', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const thief = await createUser();
    const team = await createTeamWith(owner);

    const invite = await as(owner).post(`/api/teams/${team.id}/invites`, { email: invitee.email });
    const res = await as(thief).post(`/api/invites/${invite.body.data.token}/accept`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'INVITE_EMAIL_MISMATCH');
  });

  it('cannot be accepted twice, and can be declined or revoked', async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const team = await createTeamWith(owner);

    const inviteA = await as(owner).post(`/api/teams/${team.id}/invites`, { email: a.email });
    await as(a).post(`/api/invites/${inviteA.body.data.token}/accept`);
    const again = await as(a).post(`/api/invites/${inviteA.body.data.token}/accept`);
    assert.equal(again.status, 409);

    const inviteB = await as(owner).post(`/api/teams/${team.id}/invites`, { email: b.email });
    assert.equal((await as(b).post(`/api/invites/${inviteB.body.data.token}/decline`)).status, 204);
    assert.equal((await as(b).post(`/api/invites/${inviteB.body.data.token}/accept`)).status, 409);

    const c = await createUser();
    const inviteC = await as(owner).post(`/api/teams/${team.id}/invites`, { email: c.email });
    assert.equal((await as(owner).delete(`/api/teams/${team.id}/invites/${inviteC.body.data.id}`)).status, 204);
    assert.equal((await as(c).post(`/api/invites/${inviteC.body.data.token}/accept`)).status, 409);
  });

  it('prevents plain members from inviting, and admins from inviting admins', async () => {
    const owner = await createUser();
    const member = await createUser();
    const admin = await createUser();
    const target = await createUser();
    const team = await createTeamWith(owner, [member, admin]);
    await as(owner).patch(`/api/teams/${team.id}/members/${admin.id}`, { role: 'admin' });

    assert.equal((await as(member).post(`/api/teams/${team.id}/invites`, { email: target.email })).status, 403);
    assert.equal(
      (await as(admin).post(`/api/teams/${team.id}/invites`, { email: target.email, role: 'admin' })).status,
      403
    );
    assert.equal((await as(admin).post(`/api/teams/${team.id}/invites`, { email: target.email })).status, 201);
  });
});

describe('members and roles', () => {
  it('lets the owner change roles but never the owner role itself', async () => {
    const owner = await createUser();
    const member = await createUser();
    const team = await createTeamWith(owner, [member]);

    const promoted = await as(owner).patch(`/api/teams/${team.id}/members/${member.id}`, { role: 'admin' });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.data.role, 'admin');

    const self = await as(owner).patch(`/api/teams/${team.id}/members/${owner.id}`, { role: 'member' });
    assert.equal(self.status, 409);
    assert.equal(self.body.error.code, 'OWNER_ROLE_IMMUTABLE');

    assert.equal((await as(member).patch(`/api/teams/${team.id}/members/${owner.id}`, { role: 'member' })).status, 403);
  });

  it('lets members leave, but not the owner', async () => {
    const owner = await createUser();
    const member = await createUser();
    const team = await createTeamWith(owner, [member]);

    assert.equal((await as(owner).delete(`/api/teams/${team.id}/members/${owner.id}`)).status, 409);
    assert.equal((await as(member).delete(`/api/teams/${team.id}/members/${member.id}`)).status, 204);
    assert.equal((await as(member).get(`/api/teams/${team.id}`)).status, 404);
  });

  it('enforces who can remove whom', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const admin2 = await createUser();
    const member = await createUser();
    const team = await createTeamWith(owner, [admin, admin2, member]);
    await as(owner).patch(`/api/teams/${team.id}/members/${admin.id}`, { role: 'admin' });
    await as(owner).patch(`/api/teams/${team.id}/members/${admin2.id}`, { role: 'admin' });

    assert.equal((await as(member).delete(`/api/teams/${team.id}/members/${admin.id}`)).status, 403);
    assert.equal((await as(admin).delete(`/api/teams/${team.id}/members/${owner.id}`)).status, 403);
    assert.equal((await as(admin).delete(`/api/teams/${team.id}/members/${admin2.id}`)).status, 403);
    assert.equal((await as(admin).delete(`/api/teams/${team.id}/members/${member.id}`)).status, 204);
  });

  it('unassigns tasks of a member who leaves', async () => {
    const owner = await createUser();
    const member = await createUser();
    const team = await createTeamWith(owner, [member]);
    const task = await createTask(owner, { teamId: team.id, assigneeId: member.id });

    await as(member).delete(`/api/teams/${team.id}/members/${member.id}`);
    const after = await as(owner).get(`/api/tasks/${task.id}`);
    assert.equal(after.body.data.assignee, null);
  });
});
