import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
  createInviteBody,
  createTeamBody,
  inviteParams,
  memberParams,
  teamParams,
  updateRoleBody,
  updateTeamBody,
} from './teams.schemas.js';
import * as teams from './teams.service.js';

// Mounted behind `authenticate` (see src/routes.js).
const router = Router();

// POST /api/teams - create a team; the creator becomes its owner (user story 11)
router.post('/', validate({ body: createTeamBody }), (req, res) => {
  res.status(201).json({ data: teams.createTeam(req.user.id, req.valid.body) });
});

// GET /api/teams - teams I belong to
router.get('/', (req, res) => {
  res.json({ data: teams.listTeams(req.user.id) });
});

// GET /api/teams/:teamId
router.get('/:teamId', validate({ params: teamParams }), (req, res) => {
  res.json({ data: teams.getTeam(req.valid.params.teamId, req.user.id) });
});

// PATCH /api/teams/:teamId (owner/admin)
router.patch('/:teamId', validate({ params: teamParams, body: updateTeamBody }), (req, res) => {
  res.json({ data: teams.updateTeam(req.valid.params.teamId, req.user.id, req.valid.body) });
});

// DELETE /api/teams/:teamId (owner)
router.delete('/:teamId', validate({ params: teamParams }), async (req, res) => {
  await teams.deleteTeam(req.valid.params.teamId, req.user.id);
  res.status(204).end();
});

// ----- members -----

// GET /api/teams/:teamId/members
router.get('/:teamId/members', validate({ params: teamParams }), (req, res) => {
  res.json({ data: teams.listMembers(req.valid.params.teamId, req.user.id) });
});

// PATCH /api/teams/:teamId/members/:userId - change a member's role (owner)
router.patch('/:teamId/members/:userId', validate({ params: memberParams, body: updateRoleBody }), (req, res) => {
  const { teamId, userId } = req.valid.params;
  res.json({ data: teams.updateMemberRole(teamId, req.user.id, userId, req.valid.body.role) });
});

// DELETE /api/teams/:teamId/members/:userId - remove a member, or leave the team yourself
router.delete('/:teamId/members/:userId', validate({ params: memberParams }), (req, res) => {
  const { teamId, userId } = req.valid.params;
  teams.removeMember(teamId, req.user.id, userId);
  res.status(204).end();
});

// ----- invitations (owner/admin) -----

// POST /api/teams/:teamId/invites - invite someone by e-mail (user story 11)
router.post('/:teamId/invites', validate({ params: teamParams, body: createInviteBody }), (req, res) => {
  res.status(201).json({ data: teams.createInvite(req.valid.params.teamId, req.user, req.valid.body) });
});

// GET /api/teams/:teamId/invites - pending invitations
router.get('/:teamId/invites', validate({ params: teamParams }), (req, res) => {
  res.json({ data: teams.listTeamInvites(req.valid.params.teamId, req.user.id) });
});

// DELETE /api/teams/:teamId/invites/:inviteId - revoke
router.delete('/:teamId/invites/:inviteId', validate({ params: inviteParams }), (req, res) => {
  const { teamId, inviteId } = req.valid.params;
  teams.revokeInvite(teamId, req.user.id, inviteId);
  res.status(204).end();
});

export default router;
