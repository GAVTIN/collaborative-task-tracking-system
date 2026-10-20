import db, { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';
import { removeStoredFiles } from '../../utils/files.js';
import { buildMeta, toLimitOffset } from '../../utils/pagination.js';
import { buildSet, escapeLike } from '../../utils/sql.js';
import { nowIso } from '../../utils/time.js';
import { generateTaskDescription } from '../ai/ai.service.js';
import { notify, notifyMany } from '../notifications/notifications.service.js';
import { isTeamMember, requireMember } from '../teams/teams.service.js';

/*
 * Visibility rules (the heart of task authorisation)
 *   - A PERSONAL task (team_id NULL) is visible only to its creator.
 *   - A TEAM task is visible to every current member of that team.
 * Anything else behaves as if it does not exist (404, never 403), so ids cannot be probed.
 *
 * Permissions on a visible task
 *   - view / edit / assign / complete / comment / attach: any user who can see it (team members collaborate)
 *   - delete: the creator, or an owner/admin of the task's team
 */

const clip = (text, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const TASK_SELECT = `
  SELECT t.*,
         cu.name  AS creator_name,
         au.name  AS assignee_name,
         au.email AS assignee_email,
         tm.name  AS team_name,
         (SELECT COUNT(*) FROM comments c    WHERE c.task_id = t.id) AS comment_count,
         (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachment_count
  FROM tasks t
  JOIN users cu       ON cu.id = t.created_by
  LEFT JOIN users au  ON au.id = t.assignee_id
  LEFT JOIN teams tm  ON tm.id = t.team_id`;

/** Maps a joined row to the public JSON shape. */
export function toTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    isOverdue: row.due_date !== null && row.status !== 'completed' && row.due_date < nowIso(),
    teamId: row.team_id,
    team: row.team_id ? { id: row.team_id, name: row.team_name } : null,
    createdBy: { id: row.created_by, name: row.creator_name },
    assignee: row.assignee_id
      ? { id: row.assignee_id, name: row.assignee_name, email: row.assignee_email }
      : null,
    completedAt: row.completed_at,
    commentCount: row.comment_count,
    attachmentCount: row.attachment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Loads the raw task row (plus the caller's team role as `my_role`) if - and only if - the user may see it.
 * Used by the comments/attachments modules too, so every task-scoped feature shares one access rule.
 * @throws {HttpError} 404 when the task does not exist or is not visible to the user
 */
export function getAccessibleTask(taskId, userId) {
  const row = prepare(
    `SELECT t.*, m.role AS my_role
     FROM tasks t
     LEFT JOIN team_members m ON m.team_id = t.team_id AND m.user_id = @me
     WHERE t.id = @taskId
       AND ((t.team_id IS NULL AND t.created_by = @me) OR m.user_id IS NOT NULL)`
  ).get({ me: userId, taskId });
  if (!row) throw HttpError.notFound('Task not found', 'TASK_NOT_FOUND');
  return row;
}

export function getTask(taskId, userId) {
  getAccessibleTask(taskId, userId); // authorisation
  return toTask(prepare(`${TASK_SELECT} WHERE t.id = ?`).get(taskId));
}

// Whitelisted ORDER BY expressions - `sortBy` is validated against these keys, never interpolated raw.
const SORT_SQL = {
  createdAt: 't.created_at',
  updatedAt: 't.updated_at',
  dueDate: 't.due_date',
  title: 't.title COLLATE NOCASE',
  status: "CASE t.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END",
  priority: "CASE t.priority WHEN 'low' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
};

/**
 * Lists the tasks visible to the user, with filtering, searching, sorting and pagination.
 * All filters are optional and combine with AND. Every value is bound as a named parameter.
 */
export function listTasks(user, filters) {
  const where = [
    `((t.team_id IS NULL AND t.created_by = @me)
      OR t.team_id IN (SELECT team_id FROM team_members WHERE user_id = @me))`,
  ];
  const params = { me: user.id };

  const addInList = (column, prefix, values) => {
    const placeholders = values.map((value, index) => {
      params[`${prefix}${index}`] = value;
      return `@${prefix}${index}`;
    });
    where.push(`${column} IN (${placeholders.join(', ')})`);
  };

  if (filters.status) addInList('t.status', 'status', filters.status);
  if (filters.priority) addInList('t.priority', 'priority', filters.priority);

  if (filters.assignee === 'me') {
    where.push('t.assignee_id = @me');
  } else if (filters.assignee === 'none') {
    where.push('t.assignee_id IS NULL');
  } else if (filters.assignee !== undefined) {
    where.push('t.assignee_id = @assignee');
    params.assignee = filters.assignee;
  }

  if (filters.createdBy === 'me') {
    where.push('t.created_by = @me');
  } else if (filters.createdBy !== undefined) {
    where.push('t.created_by = @createdBy');
    params.createdBy = filters.createdBy;
  }

  if (filters.teamId === 'personal') {
    where.push('t.team_id IS NULL');
  } else if (filters.teamId !== undefined) {
    where.push('t.team_id = @teamId');
    params.teamId = filters.teamId;
  }

  if (filters.q) {
    where.push("(t.title LIKE @q ESCAPE '\\' OR t.description LIKE @q ESCAPE '\\')");
    params.q = `%${escapeLike(filters.q)}%`;
  }
  if (filters.dueBefore) {
    where.push('t.due_date <= @dueBefore');
    params.dueBefore = filters.dueBefore;
  }
  if (filters.dueAfter) {
    where.push('t.due_date >= @dueAfter');
    params.dueAfter = filters.dueAfter;
  }
  if (filters.overdue !== undefined) {
    params.now = nowIso();
    const isOverdue = "(t.due_date IS NOT NULL AND t.due_date < @now AND t.status != 'completed')";
    where.push(filters.overdue ? isOverdue : `NOT ${isOverdue}`);
  }

  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  // Tasks without a due date always sort last, whichever direction is requested.
  const primaryOrder =
    filters.sortBy === 'dueDate' ? `(t.due_date IS NULL) ASC, t.due_date ${direction}` : `${SORT_SQL[filters.sortBy]} ${direction}`;
  const orderBy = `${primaryOrder}, t.id ${direction}`;

  const whereSql = where.join(' AND ');
  const { total } = prepare(`SELECT COUNT(*) AS total FROM tasks t WHERE ${whereSql}`).get(params);

  const { limit, offset } = toLimitOffset(filters);
  const rows = prepare(`${TASK_SELECT} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`).all({
    ...params,
    limit,
    offset,
  });

  return { data: rows.map(toTask), meta: buildMeta(filters, total) };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Assignment rule: team tasks may only be assigned to current team members; personal tasks only to
 * their owner (or nobody).
 */
function assertValidAssignee({ teamId, assigneeId, ownerId }) {
  if (assigneeId == null) return;
  if (teamId == null) {
    if (assigneeId !== ownerId) {
      throw new HttpError(
        422,
        'INVALID_ASSIGNEE',
        'Personal tasks can only be assigned to yourself. Create the task inside a team to assign it to a teammate.'
      );
    }
    return;
  }
  if (!isTeamMember(teamId, assigneeId)) {
    throw new HttpError(422, 'INVALID_ASSIGNEE', "The assignee must be a member of the task's team");
  }
}

export async function createTask(user, input) {
  const teamId = input.teamId ?? null;
  const assigneeId = input.assigneeId ?? null;

  if (teamId !== null) requireMember(teamId, user.id); // 404 if it is not one of the user's teams
  assertValidAssignee({ teamId, assigneeId, ownerId: user.id });

  // Optional AI assist: an explicit description always wins over generation.
  let description = input.description ?? '';
  if (input.generateDescription && !description) {
    ({ description } = await generateTaskDescription({ title: input.title }));
  }

  const status = input.status ?? 'open';
  const { lastInsertRowid } = prepare(
    `INSERT INTO tasks (title, description, status, priority, due_date, team_id, created_by, assignee_id, completed_at)
     VALUES (@title, @description, @status, @priority, @dueDate, @teamId, @createdBy, @assigneeId, @completedAt)`
  ).run({
    title: input.title,
    description,
    status,
    priority: input.priority ?? 'medium',
    dueDate: input.dueDate ?? null,
    teamId,
    createdBy: user.id,
    assigneeId,
    completedAt: status === 'completed' ? nowIso() : null,
  });

  const task = getTask(Number(lastInsertRowid), user.id);
  if (assigneeId !== null && assigneeId !== user.id) {
    notify(assigneeId, {
      type: 'task_assigned',
      message: `${user.name} assigned you the task "${clip(task.title)}"`,
      data: { taskId: task.id, teamId },
    });
  }
  return task;
}

const TRACKED_COLUMNS = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  due_date: 'due date',
  assignee_id: 'assignee',
};

export function updateTask(user, taskId, patch) {
  const before = getAccessibleTask(taskId, user.id);

  if (patch.assigneeId !== undefined) {
    assertValidAssignee({ teamId: before.team_id, assigneeId: patch.assigneeId, ownerId: before.created_by });
  }

  const { sets, params } = buildSet(patch, {
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    dueDate: 'due_date',
    assigneeId: 'assignee_id',
  });
  if (patch.status !== undefined) {
    // completed_at follows the status automatically: set on completion, cleared on reopen.
    sets.push('completed_at = @completedAt');
    params.completedAt = patch.status === 'completed' ? (before.completed_at ?? nowIso()) : null;
  }
  if (sets.length > 0) {
    prepare(`UPDATE tasks SET ${sets.join(', ')}, updated_at = @now WHERE id = @taskId`).run({
      ...params,
      now: nowIso(),
      taskId,
    });
  }

  const after = getAccessibleTask(taskId, user.id);
  notifyAboutUpdate(user, before, after);
  return getTask(taskId, user.id);
}

/** Convenience wrappers used by the dedicated endpoints. */
export const completeTask = (user, taskId) => updateTask(user, taskId, { status: 'completed' });
export const assignTask = (user, taskId, assigneeId) => updateTask(user, taskId, { assigneeId });

export async function deleteTask(user, taskId) {
  const task = getAccessibleTask(taskId, user.id);
  const canDelete =
    task.team_id === null || task.created_by === user.id || ['owner', 'admin'].includes(task.my_role);
  if (!canDelete) {
    throw HttpError.forbidden('Only the task creator or a team owner/admin can delete this task', 'INSUFFICIENT_PERMISSIONS');
  }

  const files = prepare('SELECT stored_name FROM attachments WHERE task_id = ?')
    .all(taskId)
    .map((row) => row.stored_name);

  db.transaction(() => prepare('DELETE FROM tasks WHERE id = ?').run(taskId))();
  await removeStoredFiles(files);

  if (task.assignee_id) {
    notifyMany(
      [task.assignee_id],
      {
        type: 'task_deleted',
        message: `${user.name} deleted the task "${clip(task.title)}"`,
        data: { taskId, teamId: task.team_id },
      },
      { exclude: [user.id] }
    );
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Who cares about a task: the person who created it and whoever is working on it. */
export const taskStakeholders = (task) => [task.created_by, task.assignee_id];

/**
 * Tells the right people what changed:
 *  - a newly assigned user gets a dedicated "assigned to you" notification;
 *  - the creator and (previous/current) assignee hear about other changes;
 *  - nobody is notified about their own action.
 */
function notifyAboutUpdate(actor, before, after) {
  const changed = Object.keys(TRACKED_COLUMNS).filter((column) => before[column] !== after[column]);
  if (changed.length === 0) return;

  const data = { taskId: after.id, teamId: after.team_id, actorId: actor.id };
  const title = clip(after.title);

  const newAssignee =
    changed.includes('assignee_id') && after.assignee_id && after.assignee_id !== actor.id ? after.assignee_id : null;
  if (newAssignee) {
    notify(newAssignee, {
      type: 'task_assigned',
      message: `${actor.name} assigned you the task "${title}"`,
      data,
    });
  }

  const recipients = [after.created_by, before.assignee_id, after.assignee_id];
  const exclude = [actor.id, newAssignee];

  if (before.status !== 'completed' && after.status === 'completed') {
    notifyMany(
      recipients,
      { type: 'task_completed', message: `${actor.name} marked the task "${title}" as completed`, data },
      { exclude }
    );
  } else {
    const what = changed.map((column) => TRACKED_COLUMNS[column]).join(', ');
    notifyMany(
      recipients,
      { type: 'task_updated', message: `${actor.name} updated the task "${title}" (${what})`, data },
      { exclude }
    );
  }
}
