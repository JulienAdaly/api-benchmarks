/*
Fastify implementation mirroring the Python FastAPI app at src/python-fastapi/src/main.py
and the Express implementation at src/js-express/src/main.js
*/

const fastify = require('fastify')({ logger: false });
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Configuration
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://apibench:apibench_password@localhost:15432/apibench';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRE_MINUTES = parseInt(process.env.JWT_EXPIRE_MINUTES || '60', 10);
// For parity with Python app; not used directly here
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
);

// Same deterministic bcrypt salt used by the Python implementation
const BCRYPT_SALT = '$2b$08$WQZlxDJ5MmT7wSXFTy2UU.';

// Helpers
function loadSql(relativePath) {
  const baseDirEnv = process.env.QUERIES_DIR;
  const baseDir = baseDirEnv
    ? baseDirEnv
    : path.resolve(__dirname, '../../../database/queries');
  const filePath = path.resolve(baseDir, relativePath);
  try {
    return fs.readFileSync(filePath, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`SQL file not found: ${filePath}`);
  }
}

function shapeUserRow(row) {
  return {
    id: String(row.id),
    username: row.username,
    email: row.email,
    bio: row.bio,
    createdAt: row.created_at,
  };
}

function shapePostRow(row) {
  const likeCount = row.like_count != null ? parseInt(row.like_count, 10) : 0;
  return {
    id: String(row.id),
    authorId: String(row.author_id),
    content: row.content,
    likeCount,
    createdAt: row.created_at,
  };
}

function shapeCommentRow(row) {
  return {
    id: String(row.id),
    authorId: String(row.author_id),
    post_id: String(row.post_id),
    content: row.content,
    createdAt: row.created_at,
  };
}

function getToken(request) {
  const header = request.headers['authorization'];
  if (!header) {
    return null;
  }
  const parts = header.split(' ');
  if (parts.length !== 2) {
    return null;
  }
  return parts[1];
}

function decodeTokenOr401(token, reply) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return null;
  }
}

async function requireAdminOr403(payload, reply) {
  try {
    if (payload && payload.role === 'admin') {
      return true;
    }
    reply.status(403).send({ detail: 'Forbidden' });
    return false;
  } catch (_e) {
    reply.status(403).send({ detail: 'Forbidden' });
    return false;
  }
}

// SQL queries
// Auth
const SQL_LOGIN = loadSql('auth/login.sql');
const SQL_ME = loadSql('auth/me.sql');

// Users
const SQL_CREATE_USER = loadSql('users/create.sql');
const SQL_GET_USER = loadSql('users/get.sql');
const SQL_LIST_USERS = loadSql('users/list.sql');
const SQL_UPDATE_USER = loadSql('users/update.sql');
const SQL_DELETE_USER = loadSql('users/delete.sql');

// Posts
const SQL_CREATE_POST = loadSql('posts/create.sql');
const SQL_LIST_POSTS = loadSql('posts/list.sql');
const SQL_GET_POST = loadSql('posts/get.sql');
const SQL_GET_POST_AUTHOR = loadSql('posts/get_author.sql');
const SQL_DELETE_POST = loadSql('posts/delete.sql');

// Comments
const SQL_CREATE_COMMENT = loadSql('comments/create.sql');
const SQL_LIST_COMMENTS = loadSql('comments/list.sql');

// Likes
const SQL_LIKE_EXISTS = loadSql('likes/exists.sql');
const SQL_CREATE_LIKE = loadSql('likes/create.sql');
const SQL_DELETE_LIKE = loadSql('likes/delete.sql');

// DB Pool - Configurable connection pool size
const PG_POOL_MAX = parseInt(process.env.PG_POOL_MAX || '20', 10);
const pool = new Pool({ connectionString: DATABASE_URL, max: PG_POOL_MAX });

// Fastify automatically parses JSON

// Auth endpoints
fastify.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body || {};
  try {
    const result = await pool.query(SQL_LOGIN, [email]);
    const row = result.rows[0];
    let isValid = false;
    if (row) {
      isValid = bcrypt.compareSync(String(password || ''), row.password_hash);
    }
    if (row && isValid) {
      const role = row.is_admin ? 'admin' : 'user';
      const token = jwt.sign({ sub: String(row.id), role }, JWT_SECRET, {
        algorithm: 'HS256',
      });
      return { accessToken: token };
    }
    reply.status(401).send({ detail: 'Invalid credentials' });
  } catch (err) {
    reply.status(401).send({ detail: 'Invalid credentials' });
  }
});

fastify.get('/auth/me', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  try {
    const result = await pool.query(SQL_ME, [payload.sub]);
    const row = result.rows[0];
    if (!row) {
      reply.status(401).send({ detail: 'Unauthorized' });
      return;
    }
    return {
      id: String(row.id),
      username: row.username,
      email: row.email,
      bio: row.bio,
      createdAt: row.created_at,
    };
  } catch (_e) {
    reply.status(401).send({ detail: 'Unauthorized' });
  }
});

// Users (Admin only)
fastify.post('/users', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const { username, email, password } = request.body || {};
  try {
    const isAdmin = await requireAdminOr403(payload, reply);
    if (!isAdmin) return;
    const passwordHash = bcrypt.hashSync(String(password || ''), BCRYPT_SALT);
    const created = await pool.query(SQL_CREATE_USER, [
      username,
      email,
      passwordHash,
      null,
    ]);
    const newId = created.rows[0] && created.rows[0].id;
    if (!newId) {
      reply.status(400).send({ detail: 'Failed to create user' });
      return;
    }
    const fetched = await pool.query(SQL_GET_USER, [newId]);
    const fetchedRow = fetched.rows[0];
    if (!fetchedRow) {
      reply.status(404).send({ detail: 'User not found' });
      return;
    }
    reply.status(201).send(shapeUserRow(fetchedRow));
  } catch (e) {
    // Mirror Python's behavior of logging and not exposing details
    console.error(`Error creating user: ${e}`);
    // Do not leak error details; fallback to 400 like FastAPI branch
    reply.status(400).send({ detail: 'Failed to create user' });
  }
});

fastify.get('/users', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const limit = parseInt(request.query.limit || '20', 10);
  const offset = parseInt(request.query.offset || '0', 10);
  const isAdmin = await requireAdminOr403(payload, reply);
  if (!isAdmin) return;
  const result = await pool.query(SQL_LIST_USERS, [limit, offset]);
  return result.rows.map(shapeUserRow);
});

fastify.get('/users/:userId', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const isAdmin = await requireAdminOr403(payload, reply);
  if (!isAdmin) return;
  const result = await pool.query(SQL_GET_USER, [request.params.userId]);
  const row = result.rows[0];
  if (!row) {
    reply.status(404).send({ detail: 'User not found' });
    return;
  }
  return shapeUserRow(row);
});

fastify.put('/users/:userId', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const isAdmin = await requireAdminOr403(payload, reply);
  if (!isAdmin) return;
  const { bio = null } = request.body || {};
  const result = await pool.query(SQL_UPDATE_USER, [
    request.params.userId,
    bio,
  ]);
  const row = result.rows[0];
  if (!row) {
    reply.status(404).send({ detail: 'User not found' });
    return;
  }
  return shapeUserRow(row);
});

fastify.delete('/users/:userId', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const isAdmin = await requireAdminOr403(payload, reply);
  if (!isAdmin) return;
  const result = await pool.query(SQL_DELETE_USER, [request.params.userId]);
  if (result.rowCount !== 1) {
    reply.status(404).send({ detail: 'User not found' });
    return;
  }
  reply.status(204).send();
});

// Posts
fastify.post('/posts', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const { content } = request.body || {};
  const result = await pool.query(SQL_CREATE_POST, [payload.sub, content]);
  const row = result.rows[0];
  if (!row) {
    reply.status(400).send({ detail: 'Failed to create post' });
    return;
  }
  reply.status(201).send({ ...shapePostRow(row), likeCount: 0 });
});

fastify.get('/posts', async (request, reply) => {
  const limit = parseInt(request.query.limit || '20', 10);
  const offset = parseInt(request.query.offset || '0', 10);
  const result = await pool.query(SQL_LIST_POSTS, [limit, offset]);
  return result.rows.map(shapePostRow);
});

fastify.get('/posts/:postId', async (request, reply) => {
  const result = await pool.query(SQL_GET_POST, [request.params.postId]);
  const row = result.rows[0];
  if (!row) {
    reply.status(404).send({ detail: 'Post not found' });
    return;
  }
  return shapePostRow(row);
});

fastify.delete('/posts/:postId', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const postId = request.params.postId;
  const author = await pool.query(SQL_GET_POST_AUTHOR, [postId]);
  const authorId = author.rows[0] && author.rows[0].author_id;
  if (!authorId) {
    reply.status(404).send({ detail: 'Post not found' });
    return;
  }
  if (String(authorId) !== String(payload.sub)) {
    reply.status(403).send({ detail: 'Forbidden' });
    return;
  }
  await pool.query(SQL_DELETE_POST, [postId]);
  reply.status(204).send();
});

// Comments
fastify.post('/posts/:postId/comments', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    reply.status(401).send({ detail: 'Unauthorized' });
    return;
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const postId = request.params.postId;
  const { content } = request.body || {};
  const exists = await pool.query(SQL_GET_POST, [postId]);
  if (!exists.rows[0]) {
    reply.status(404).send({ detail: 'Post not found' });
    return;
  }
  const result = await pool.query(SQL_CREATE_COMMENT, [
    payload.sub,
    postId,
    content,
  ]);
  const row = result.rows[0];
  if (!row) {
    reply.status(400).send({ detail: 'Failed to create comment' });
    return;
  }
  reply.status(201).send(shapeCommentRow(row));
});

fastify.get('/posts/:postId/comments', async (request, reply) => {
  const postId = request.params.postId;
  const exists = await pool.query(SQL_GET_POST, [postId]);
  if (!exists.rows[0]) {
    reply.status(404).send({ detail: 'Post not found' });
    return;
  }
  const result = await pool.query(SQL_LIST_COMMENTS, [postId]);
  return result.rows.map(shapeCommentRow);
});

// Likes
fastify.post('/posts/:postId/like', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    return reply.code(401).send({ detail: 'Unauthorized' });
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const { postId } = request.params;

  try {
    const result = await pool.query(SQL_CREATE_LIKE, [payload.sub, postId]);
    if (result.rowCount === 1) {
      reply.code(204).send();
    } else {
      // rowCount is 0, meaning ON CONFLICT DO NOTHING was triggered
      reply.code(409).send({ detail: 'Post already liked' });
    }
  } catch (e) {
    if (e.code === '23503') { // foreign_key_violation
      reply.code(404).send({ detail: 'Post not found' });
    } else if (e.code === '23505') { // unique_violation, for safety
        reply.code(409).send({ detail: 'Post already liked' });
    } else {
      console.error('Error in handleCreateLike:', e);
      reply.code(500).send({ detail: 'Internal Server Error' });
    }
  }
});

fastify.delete('/posts/:postId/like', async (request, reply) => {
  const bearer = getToken(request);
  if (!bearer) {
    return reply.code(401).send({ detail: 'Unauthorized' });
  }
  const payload = decodeTokenOr401(bearer, reply);
  if (!payload) return;
  const postId = request.params.postId;
  const exists = await pool.query(SQL_GET_POST, [postId]);
  if (!exists.rows[0]) {
    return reply.code(404).send({ detail: 'Post not found' });
  }
  const result = await pool.query(SQL_DELETE_LIKE, [payload.sub, postId]);
  if (result.rowCount !== 1) {
    return reply.code(404).send({ detail: 'Post or like not found' });
  }
  reply.code(204).send();
});

// Startup & Shutdown
const PORT = parseInt(process.env.PORT || '3000', 10);

fastify.listen({ port: PORT, host: '0.0.0.0' }, async (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Fastify server listening on ${address}`);
});

// Graceful shutdown
const shutdown = async () => {
  try {
    await pool.end();
    await fastify.close();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
