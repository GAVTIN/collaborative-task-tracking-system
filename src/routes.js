import { Router } from 'express';
import { authenticate } from './middleware/auth.js';
import aiRoutes from './modules/ai/ai.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import inviteRoutes from './modules/teams/invites.routes.js';
import teamRoutes from './modules/teams/teams.routes.js';
import taskRoutes from './modules/tasks/tasks.routes.js';
import userRoutes from './modules/users/users.routes.js';

/**
 * The API surface. Everything except /auth/register and /auth/login requires a valid bearer token.
 * `authenticate` is applied here once per feature so individual route files stay focused on behaviour.
 */
const router = Router();

router.use('/auth', authRoutes); // public (register/login) + authenticated logout, handled inside
router.use('/users', authenticate, userRoutes);
router.use('/teams', authenticate, teamRoutes);
router.use('/invites', authenticate, inviteRoutes);
router.use('/tasks', authenticate, taskRoutes); // includes nested /comments and /attachments
router.use('/ai', authenticate, aiRoutes);
router.use('/notifications', notificationRoutes); // authenticates per route (the SSE stream also accepts tickets)

export default router;
