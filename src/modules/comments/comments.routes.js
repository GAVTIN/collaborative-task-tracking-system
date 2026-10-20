import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { id, pagination } from '../../utils/schemas.js';
import * as comments from './comments.service.js';

// Mounted at /api/tasks/:taskId/comments, so `mergeParams` is needed to see :taskId.
const router = Router({ mergeParams: true });

const taskParams = z.object({ taskId: id });
const commentParams = z.object({ taskId: id, commentId: id });
const commentBody = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(2000, 'Comment must be at most 2000 characters'),
});
const listQuery = z.object(pagination);

// POST /api/tasks/:taskId/comments (user story 10)
router.post('/', validate({ params: taskParams, body: commentBody }), (req, res) => {
  const comment = comments.addComment(req.user, req.valid.params.taskId, req.valid.body.body);
  res.status(201).location(`/api/tasks/${comment.taskId}/comments/${comment.id}`).json({ data: comment });
});

// GET /api/tasks/:taskId/comments
router.get('/', validate({ params: taskParams, query: listQuery }), (req, res) => {
  res.json(comments.listComments(req.user, req.valid.params.taskId, req.valid.query));
});

// PATCH /api/tasks/:taskId/comments/:commentId (author only)
router.patch('/:commentId', validate({ params: commentParams, body: commentBody }), (req, res) => {
  const { taskId, commentId } = req.valid.params;
  res.json({ data: comments.updateComment(req.user, taskId, commentId, req.valid.body.body) });
});

// DELETE /api/tasks/:taskId/comments/:commentId (author, or team owner/admin)
router.delete('/:commentId', validate({ params: commentParams }), (req, res) => {
  const { taskId, commentId } = req.valid.params;
  comments.deleteComment(req.user, taskId, commentId);
  res.status(204).end();
});

export default router;
