import { z } from 'zod';
import {
  AT_LEAST_ONE_FIELD,
  bodyId,
  hasAtLeastOneField,
  id,
  isoDate,
  pagination,
  queryBoolean,
  text,
} from '../../utils/schemas.js';

export const STATUSES = ['open', 'in_progress', 'completed'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const SORT_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'priority', 'status', 'title'];

/** Accepts `?status=open,in_progress` as well as repeated `?status=open&status=in_progress`. */
const enumList = (values) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? value.join(',') : value),
    z
      .string()
      .transform((raw) => raw.split(',').map((part) => part.trim()).filter(Boolean))
      .pipe(z.array(z.enum(values)).min(1))
  );

export const taskParams = z.object({ taskId: id });

export const listTasksQuery = z.object({
  status: enumList(STATUSES).optional(),
  priority: enumList(PRIORITIES).optional(),
  assignee: z.union([z.enum(['me', 'none']), id]).optional(),
  createdBy: z.union([z.literal('me'), id]).optional(),
  teamId: z.union([z.literal('personal'), id]).optional(),
  q: z.string().trim().max(100, 'Search text must be at most 100 characters').optional(),
  dueBefore: isoDate.optional(),
  dueAfter: isoDate.optional(),
  overdue: queryBoolean.optional(),
  sortBy: z.enum(SORT_FIELDS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  ...pagination,
});

const fields = {
  title: text(200, 'Title'),
  description: z.string().trim().max(5000, 'Description must be at most 5000 characters'),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  dueDate: isoDate.nullable(),
  assigneeId: bodyId.nullable(),
};

export const createTaskBody = z.object({
  title: fields.title,
  description: fields.description.optional(),
  status: fields.status.optional(),
  priority: fields.priority.optional(),
  dueDate: fields.dueDate.optional(),
  teamId: bodyId.optional(),
  assigneeId: fields.assigneeId.optional(),
  /** When true and no description is supplied, the AI drafts one from the title. */
  generateDescription: z.boolean().optional(),
});

/** Partial update. `teamId` is intentionally absent: a task cannot be moved between teams. */
export const updateTaskBody = z.object(fields).partial().refine(hasAtLeastOneField, AT_LEAST_ONE_FIELD);

export const assignBody = z.object({ assigneeId: fields.assigneeId });
