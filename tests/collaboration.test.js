import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, countUploadedFiles, createTask, createTeamWith, createUser, uploadDir } from './helpers.js';

describe('comments (user story 10)', () => {
  it('lets team members discuss a task, oldest first', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    const task = await createTask(owner, { teamId: team.id });

    const first = await as(owner).post(`/api/tasks/${task.id}/comments`, { body: 'Kick-off notes' });
    assert.equal(first.status, 201);
    assert.equal(first.body.data.author.id, owner.id);
    await as(mate).post(`/api/tasks/${task.id}/comments`, { body: 'On it' });

    const list = await as(mate).get(`/api/tasks/${task.id}/comments`);
    assert.deepEqual(list.body.data.map((c) => c.body), ['Kick-off notes', 'On it']);
    assert.equal(list.body.meta.total, 2);

    const fetched = await as(owner).get(`/api/tasks/${task.id}`);
    assert.equal(fetched.body.data.commentCount, 2);
  });

  it('validates the comment body', async () => {
    const user = await createUser();
    const task = await createTask(user);
    assert.equal((await as(user).post(`/api/tasks/${task.id}/comments`, { body: '   ' })).status, 422);
    assert.equal((await as(user).post(`/api/tasks/${task.id}/comments`, { body: 'x'.repeat(2001) })).status, 422);
  });

  it('blocks outsiders from reading or writing comments', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(owner);
    assert.equal((await as(outsider).post(`/api/tasks/${task.id}/comments`, { body: 'hi' })).status, 404);
    assert.equal((await as(outsider).get(`/api/tasks/${task.id}/comments`)).status, 404);
  });

  it('notifies the creator and assignee, but not the commenter', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    const task = await createTask(owner, { teamId: team.id, assigneeId: mate.id });

    await as(mate).post(`/api/tasks/${task.id}/comments`, { body: 'Question' });

    const ownerNotes = (await as(owner).get('/api/notifications')).body.data;
    assert.equal(ownerNotes[0].type, 'task_comment');
    const mateTypes = (await as(mate).get('/api/notifications')).body.data.map((n) => n.type);
    assert.ok(!mateTypes.includes('task_comment'));
  });

  it('lets only the author edit; author or team admin delete', async () => {
    const owner = await createUser();
    const alice = await createUser();
    const bob = await createUser();
    const team = await createTeamWith(owner, [alice, bob]);
    const task = await createTask(owner, { teamId: team.id });

    const comment = (await as(alice).post(`/api/tasks/${task.id}/comments`, { body: 'v1' })).body.data;
    const url = `/api/tasks/${task.id}/comments/${comment.id}`;

    assert.equal((await as(bob).patch(url, { body: 'hijack' })).status, 403);
    assert.equal((await as(owner).patch(url, { body: 'hijack' })).status, 403); // even the owner cannot rewrite words
    const edited = await as(alice).patch(url, { body: 'v2' });
    assert.equal(edited.body.data.body, 'v2');

    assert.equal((await as(bob).delete(url)).status, 403);
    assert.equal((await as(owner).delete(url)).status, 204); // moderation
    assert.equal((await as(alice).delete(url)).status, 404);
  });

  it('does not let a comment id from another task be addressed through this one', async () => {
    const user = await createUser();
    const t1 = await createTask(user);
    const t2 = await createTask(user);
    const comment = (await as(user).post(`/api/tasks/${t1.id}/comments`, { body: 'x' })).body.data;
    assert.equal((await as(user).delete(`/api/tasks/${t2.id}/comments/${comment.id}`)).status, 404);
  });
});

describe('attachments (user story 10)', () => {
  const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content');

  it('uploads, lists and downloads a file byte-for-byte', async () => {
    const user = await createUser();
    const task = await createTask(user);

    const up = await as(user).attach(`/api/tasks/${task.id}/attachments`, pdfBytes, 'spec.pdf');
    assert.equal(up.status, 201);
    assert.equal(up.body.data.fileName, 'spec.pdf');
    assert.equal(up.body.data.sizeBytes, pdfBytes.length);
    assert.equal(up.body.data.uploadedBy.id, user.id);

    const list = await as(user).get(`/api/tasks/${task.id}/attachments`);
    assert.equal(list.body.data.length, 1);

    const down = await as(user).get(up.body.data.downloadUrl).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(down.status, 200);
    assert.deepEqual(down.body, pdfBytes);
    assert.match(down.headers['content-disposition'], /^attachment; filename="?spec\.pdf"?$/);
    assert.equal(down.headers['x-content-type-options'], 'nosniff');

    assert.equal((await as(user).get(`/api/tasks/${task.id}`)).body.data.attachmentCount, 1);
  });

  it('stores files under random names, never the client-supplied one', async () => {
    const user = await createUser();
    const task = await createTask(user);
    const before = new Set(fs.readdirSync(uploadDir));

    await as(user).attach(`/api/tasks/${task.id}/attachments`, pdfBytes, '../../etc/passwd.pdf');
    const created = fs.readdirSync(uploadDir).filter((f) => !before.has(f));
    assert.equal(created.length, 1);
    assert.match(created[0], /^[0-9a-f-]{36}\.pdf$/);
    assert.ok(!fs.existsSync(path.join(uploadDir, '..', '..', 'etc', 'passwd.pdf')));
  });

  it('rejects disallowed types without leaving files behind', async () => {
    const user = await createUser();
    const task = await createTask(user);
    const before = countUploadedFiles();

    for (const name of ['evil.html', 'evil.svg', 'evil.js', 'evil.exe', 'noextension']) {
      const res = await as(user).attach(`/api/tasks/${task.id}/attachments`, Buffer.from('<script>alert(1)</script>'), name);
      assert.equal(res.status, 415, `${name} should be rejected`);
      assert.equal(res.body.error.code, 'UNSUPPORTED_FILE_TYPE');
    }
    assert.equal(countUploadedFiles(), before);
  });

  it('enforces the size limit and cleans up', async () => {
    const user = await createUser();
    const task = await createTask(user);
    const before = countUploadedFiles();

    const res = await as(user).attach(`/api/tasks/${task.id}/attachments`, Buffer.alloc(1024 * 1024 + 10), 'big.zip');
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
    assert.equal(countUploadedFiles(), before);
  });

  it('requires a file', async () => {
    const user = await createUser();
    const task = await createTask(user);
    const res = await as(user).post(`/api/tasks/${task.id}/attachments`, {});
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'FILE_REQUIRED');
  });

  it('writes nothing to disk for users who cannot see the task', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(owner);
    const before = countUploadedFiles();

    const up = await as(outsider).attach(`/api/tasks/${task.id}/attachments`, pdfBytes, 'x.pdf');
    assert.equal(up.status, 404);
    assert.equal(countUploadedFiles(), before);

    const own = await as(owner).attach(`/api/tasks/${task.id}/attachments`, pdfBytes, 'x.pdf');
    assert.equal((await as(outsider).get(own.body.data.downloadUrl)).status, 404);
  });

  it('notifies teammates when a file is attached', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    const task = await createTask(owner, { teamId: team.id });

    await as(mate).attach(`/api/tasks/${task.id}/attachments`, pdfBytes, 'design.pdf');
    const notes = (await as(owner).get('/api/notifications')).body.data;
    assert.equal(notes[0].type, 'task_attachment');
    assert.match(notes[0].message, /design\.pdf/);
  });

  it('deletes the row and the file; permissions apply', async () => {
    const owner = await createUser();
    const alice = await createUser();
    const bob = await createUser();
    const team = await createTeamWith(owner, [alice, bob]);
    const task = await createTask(owner, { teamId: team.id });

    const up = (await as(alice).attach(`/api/tasks/${task.id}/attachments`, pdfBytes, 'a.pdf')).body.data;
    const url = `/api/tasks/${task.id}/attachments/${up.id}`;
    const before = countUploadedFiles();

    assert.equal((await as(bob).delete(url)).status, 403);
    assert.equal((await as(alice).delete(url)).status, 204);
    assert.equal(countUploadedFiles(), before - 1);
    assert.equal((await as(alice).get(`${url}/download`)).status, 404);
  });

  it('removes files from disk when the task or team is deleted', async () => {
    const owner = await createUser();
    const team = await createTeamWith(owner);
    const task = await createTask(owner, { teamId: team.id });
    const task2 = await createTask(owner, { teamId: team.id });
    await as(owner).attach(`/api/tasks/${task.id}/attachments`, pdfBytes, 'a.pdf');
    await as(owner).attach(`/api/tasks/${task2.id}/attachments`, pdfBytes, 'b.pdf');
    const before = countUploadedFiles();

    await as(owner).delete(`/api/tasks/${task.id}`);
    assert.equal(countUploadedFiles(), before - 1);
    await as(owner).delete(`/api/teams/${team.id}`);
    assert.equal(countUploadedFiles(), before - 2);
  });
});
