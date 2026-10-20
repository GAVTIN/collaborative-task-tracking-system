import { z } from 'zod';
import { AT_LEAST_ONE_FIELD, hasAtLeastOneField, id, text } from '../../utils/schemas.js';
import { email } from '../auth/auth.schemas.js';

export const teamParams = z.object({ teamId: id });
export const memberParams = z.object({ teamId: id, userId: id });
export const inviteParams = z.object({ teamId: id, inviteId: id });
export const tokenParams = z.object({ token: z.string().min(10).max(100) });

export const createTeamBody = z.object({
  name: text(100, 'Team name'),
  description: z.string().trim().max(500, 'Description must be at most 500 characters').optional(),
});

export const updateTeamBody = createTeamBody.partial().refine(hasAtLeastOneField, AT_LEAST_ONE_FIELD);

export const updateRoleBody = z.object({ role: z.enum(['admin', 'member']) });

export const createInviteBody = z.object({
  email,
  role: z.enum(['admin', 'member']).default('member'),
});
