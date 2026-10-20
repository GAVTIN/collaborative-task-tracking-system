-- =============================================================================
-- 001_init.sql - initial schema
--
-- Conventions
--   * Integer surrogate keys; every access path is authorisation-checked, so ids are not secrets.
--   * Timestamps are ISO 8601 UTC text ("2026-10-19T11:04:05.123Z"), which sort lexicographically.
--   * ON DELETE rules keep the graph consistent (deleting a team removes its tasks, comments,
--     attachment rows, ...). Files on disk are cleaned up by the application layer.
-- =============================================================================

-- ----- users ----------------------------------------------------------------
CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT    NOT NULL,                 -- bcrypt hash, never the password
  job_title      TEXT,
  bio            TEXT,
  -- Embedded in every JWT. Bumping it (e.g. on password change) invalidates all older tokens.
  token_version  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----- revoked tokens (logout) ---------------------------------------------------
-- JWTs are stateless, so "log out" is implemented as a deny-list of token ids (jti).
-- Rows are only needed until the token would have expired anyway, then they are purged.
CREATE TABLE revoked_tokens (
  jti         TEXT    PRIMARY KEY,
  expires_at  INTEGER NOT NULL                       -- unix seconds (the JWT "exp" claim)
);
CREATE INDEX idx_revoked_tokens_expires ON revoked_tokens (expires_at);

-- ----- teams ------------------------------------------------------------------
CREATE TABLE teams (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  owner_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE team_members (
  team_id    INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX idx_team_members_user ON team_members (user_id);

CREATE TABLE team_invites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  email         TEXT    NOT NULL COLLATE NOCASE,   -- the address the invitation was issued to
  token         TEXT    NOT NULL UNIQUE,           -- unguessable, used in accept/decline URLs
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  invited_by    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  responded_at  TEXT
);
-- At most one *pending* invitation per (team, email).
CREATE UNIQUE INDEX idx_team_invites_pending
  ON team_invites (team_id, email) WHERE status = 'pending';
CREATE INDEX idx_team_invites_email ON team_invites (email, status);

-- ----- tasks ------------------------------------------------------------------
-- team_id IS NULL  -> a personal task, visible only to its creator
-- team_id NOT NULL -> a team task, visible to every member of that team
CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'open'   CHECK (status   IN ('open', 'in_progress', 'completed')),
  priority      TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date      TEXT,
  team_id       INTEGER REFERENCES teams (id) ON DELETE CASCADE,
  created_by    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assignee_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  completed_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tasks_team        ON tasks (team_id);
CREATE INDEX idx_tasks_assignee    ON tasks (assignee_id, status);
CREATE INDEX idx_tasks_creator     ON tasks (created_by);
CREATE INDEX idx_tasks_due_date    ON tasks (due_date);

-- ----- comments ---------------------------------------------------------------
CREATE TABLE comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_comments_task ON comments (task_id, id);

-- ----- attachments ----------------------------------------------------------------
-- Only metadata lives in the database. The bytes are stored on disk under a random name
-- (stored_name), so user-supplied file names can never influence where a file is written.
CREATE TABLE attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  uploaded_by    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  original_name  TEXT    NOT NULL,
  stored_name    TEXT    NOT NULL UNIQUE,
  mime_type      TEXT    NOT NULL,
  size_bytes     INTEGER NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_attachments_task ON attachments (task_id);

-- ----- notifications ----------------------------------------------------------------
CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,   -- also used as the SSE event id
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  data        TEXT    NOT NULL DEFAULT '{}',       -- JSON: ids a client needs to deep-link
  read_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read_at, id);
