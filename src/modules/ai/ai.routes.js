import { Router } from 'express';
import { z } from 'zod';
import { aiLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { id, text } from '../../utils/schemas.js';
import { getTask } from '../tasks/tasks.service.js';
import { generateTaskDescription, loadCommentsForSummary, summarizeTask } from './ai.service.js';

// Mounted behind `authenticate` (see src/routes.js). AI calls are rate-limited per user.
const router = Router();
router.use(aiLimiter);

const descriptionBody = z.object({
  title: text(200, 'Title'),
  context: z.string().trim().max(2000, 'Context must be at most 2000 characters').optional(),
});
const taskParams = z.object({ taskId: id });

// POST /api/ai/task-description - draft a description from a title (user story 14)
router.post('/task-description', validate({ body: descriptionBody }), async (req, res) => {
  res.json({ data: await generateTaskDescription(req.valid.body) });
});

// POST /api/ai/tasks/:taskId/summary - summarise a task and its comment thread (user story 14)
router.post('/tasks/:taskId/summary', validate({ params: taskParams }), async (req, res) => {
  const { taskId } = req.valid.params;
  const task = getTask(taskId, req.user.id); // 404 unless the caller can see the task
  res.json({ data: await summarizeTask(task, loadCommentsForSummary(taskId)) });
});

export default router;
