import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { tokenParams } from './teams.schemas.js';
import * as teams from './teams.service.js';

/**
 * The invitee's side of team invitations. Mounted at /api/invites behind `authenticate`.
 * (The inviter's side lives under /api/teams/:teamId/invites.)
 */
const router = Router();

// GET /api/invites - invitations waiting for me (matched on my account e-mail)
router.get('/', (req, res) => {
  res.json({ data: teams.listMyInvites(req.user) });
});

// POST /api/invites/:token/accept - join the team (user story 11)
router.post('/:token/accept', validate({ params: tokenParams }), (req, res) => {
  res.json({ data: teams.acceptInvite(req.valid.params.token, req.user) });
});

// POST /api/invites/:token/decline
router.post('/:token/decline', validate({ params: tokenParams }), (req, res) => {
  teams.declineInvite(req.valid.params.token, req.user);
  res.status(204).end();
});

export default router;
