import { Router } from 'express';
import { aiLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import attachmentRoutes from '../attachments/attachments.routes.js';
import commentRoutes from '../comments/comments.routes.js';
import { assignBody, createTaskBody, listTasksQuery, taskParams, updateTaskBody } from './tasks.schemas.js';
import * as tasks from './tasks.service.js';

// Mounted behind `authenticate` (see src/routes.js).
const router = Router();

// AI-assisted creation costs money, so it shares the per-user AI rate limit; plain creation is unaffected.
const limitAiAssist = (req, res, next) => (req.valid.body.generateDescription ? aiLimiter(req, res, next) : next());

// POST /api/tasks - create a task (user story 4); optional `generateDescription: true` (user story 14)
router.post('/', validate({ body: createTaskBody }), limitAiAssist, async (req, res) => {
  const task = await tasks.createTask(req.user, req.valid.body);
  res.status(201).location(`/api/tasks/${task.id}`).json({ data: task });
});

// GET /api/tasks - list / filter / search / sort (user stories 5, 8, 9)
//   ?assignee=me            tasks assigned to me
//   ?status=open,in_progress
//   ?q=invoice              search title + description
router.get('/', validate({ query: listTasksQuery }), (req, res) => {
  res.json(tasks.listTasks(req.user, req.valid.query));
});

// GET /api/tasks/:taskId
router.get('/:taskId', validate({ params: taskParams }), (req, res) => {
  res.json({ data: tasks.getTask(req.valid.params.taskId, req.user.id) });
});

// PATCH /api/tasks/:taskId - partial update, including status changes
router.patch('/:taskId', validate({ params: taskParams, body: updateTaskBody }), (req, res) => {
  res.json({ data: tasks.updateTask(req.user, req.valid.params.taskId, req.valid.body) });
});

// DELETE /api/tasks/:taskId
router.delete('/:taskId', validate({ params: taskParams }), async (req, res) => {
  await tasks.deleteTask(req.user, req.valid.params.taskId);
  res.status(204).end();
});

// POST /api/tasks/:taskId/complete - shortcut for PATCH { status: "completed" } (user story 6)
router.post('/:taskId/complete', validate({ params: taskParams }), (req, res) => {
  res.json({ data: tasks.completeTask(req.user, req.valid.params.taskId) });
});

// PUT /api/tasks/:taskId/assignee - assign to a teammate, or { assigneeId: null } to unassign (user story 7)
router.put('/:taskId/assignee', validate({ params: taskParams, body: assignBody }), (req, res) => {
  res.json({ data: tasks.assignTask(req.user, req.valid.params.taskId, req.valid.body.assigneeId) });
});

// Task-scoped collaboration resources (user story 10)
router.use('/:taskId/comments', commentRoutes);
router.use('/:taskId/attachments', attachmentRoutes);

export default router;
