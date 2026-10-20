import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { newPassword } from '../auth/auth.schemas.js';
import { text } from '../../utils/schemas.js';
import * as usersService from './users.service.js';

// All routes here are mounted behind `authenticate` (see src/routes.js).
const router = Router();

const updateProfileBody = z
  .object({
    name: text(100, 'Name'),
    // `null` clears the field; omitting it leaves it unchanged.
    jobTitle: text(100, 'Job title').nullable(),
    bio: z.string().trim().max(500, 'Bio must be at most 500 characters').nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword,
});

// GET /api/users/me - view own profile (user story 3)
router.get('/me', (req, res) => {
  res.json({ data: usersService.getProfile(req.user.id) });
});

// PATCH /api/users/me - update own profile (user story 3)
router.patch('/me', validate({ body: updateProfileBody }), (req, res) => {
  res.json({ data: usersService.updateProfile(req.user.id, req.valid.body) });
});

// PUT /api/users/me/password - change password; returns a fresh token, older tokens stop working
router.put('/me/password', validate({ body: changePasswordBody }), async (req, res) => {
  const session = await usersService.changePassword(req.user.id, req.valid.body);
  res.json({ data: session });
});

export default router;
