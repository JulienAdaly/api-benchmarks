/*
Pure Bun-native implementation using Bun.serve() with Bun Server and Bun SQL client
- Uses Bun's built-in HTTP server for optimal performance
- Uses Bun SQL client (bun:pg) instead of external postgres library
- Leverages Bun.password for password hashing/verification
- Maintains same API contract as Express implementation
*/

import jwt from 'jsonwebtoken';
import { SQL } from 'bun';

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

// Database connection - using Bun native SQL client
// The sql instance is automatically configured from DATABASE_URL environment variable
const sql = new SQL(DATABASE_URL, {
  // Pool configuration
  max: 20, // Maximum 20 concurrent connections
  //   idleTimeout: 9, // Close idle connections after 9s
  maxLifetime: 3600, // Max connection lifetime 1 hour
  //   connectionTimeout: 9, // Connection timeout 9s
});

// Precompiled route regexes and constants
const ROUTE_USER = /^\/users\/([0-9a-fA-F-]+)$/;
const ROUTE_POST = /^\/posts\/([0-9a-fA-F-]+)$/;
const ROUTE_COMMENTS = /^\/posts\/([0-9a-fA-F-]+)\/comments$/;
const ROUTE_LIKE = /^\/posts\/([0-9a-fA-F-]+)\/like$/;
const AUTH_BEARER_PREFIX = 'Bearer ';

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

function getToken(headers) {
  const header = headers.get('authorization');
  if (!header) return null;
  if (header.startsWith(AUTH_BEARER_PREFIX))
    return header.slice(AUTH_BEARER_PREFIX.length);
  return null;
}

function decodeToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

async function getAuthPayload(headers) {
  const token = getToken(headers);
  if (!token) return null;
  return decodeToken(token);
}

async function requireAdmin(payload) {
  return payload && payload.role === 'admin';
}

// Response helpers
function jsonResponse(data, status = 200) {
  return Response.json(data, { status });
}

function errorResponse(detail, status = 400) {
  return jsonResponse({ detail }, status);
}

const SQL_LOGIN =
  'SELECT id, password_hash, is_admin FROM users WHERE email = $1;';

const SQL_ME =
  'SELECT id, username, email, bio, created_at FROM users WHERE id = $1;';

// Users
const SQL_CREATE_USER =
  'INSERT INTO users (username, email, password_hash, bio) VALUES ($1, $2, $3, $4) RETURNING id;';
const SQL_GET_USER =
  'SELECT id, username, email, bio, created_at FROM users WHERE id = $1;';
const SQL_LIST_USERS =
  'SELECT id, username, email, bio, created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2;';
const SQL_UPDATE_USER =
  'UPDATE users SET bio = $2 WHERE id = $1 RETURNING id, username, email, bio, created_at;';
const SQL_DELETE_USER = 'DELETE FROM users WHERE id = $1;';

// Posts
const SQL_CREATE_POST =
  'INSERT INTO posts (author_id, content) VALUES ($1, $2) RETURNING id, author_id, content, created_at;';
const SQL_LIST_POSTS =
  'SELECT p.id, p.author_id, p.content, p.created_at, p.likes_count::bigint AS like_count FROM posts p ORDER BY p.created_at DESC LIMIT $1 OFFSET $2;';
const SQL_GET_POST =
  'SELECT p.id, p.author_id, p.content, p.created_at, p.likes_count::bigint AS like_count FROM posts p WHERE p.id = $1;';
const SQL_GET_POST_AUTHOR = 'SELECT author_id FROM posts WHERE id = $1;';
const SQL_DELETE_POST = 'DELETE FROM posts WHERE id = $1;';

// Comments
const SQL_CREATE_COMMENT =
  'INSERT INTO comments (author_id, post_id, content) VALUES ($1, $2, $3) RETURNING id, author_id, post_id, content, created_at;';
const SQL_LIST_COMMENTS =
  'SELECT id, author_id, post_id, content, created_at FROM comments WHERE post_id = $1 ORDER BY created_at ASC;';

// Likes
const SQL_LIKE_EXISTS =
  'SELECT 1 FROM post_likes WHERE user_id = $1 AND post_id = $2;';
const SQL_CREATE_LIKE =
  'INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;';
const SQL_DELETE_LIKE =
  'DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2;';

// Route handlers
async function handleLogin(body) {
  const { email, password } = body || {};
  try {
    const result = await sql.unsafe(SQL_LOGIN, [email]);
    const row = result[0];
    let isValid = false;
    if (row) {
      isValid = Bun.password.verifySync(
        String(password || ''),
        row.password_hash
      );
    }
    if (row && isValid) {
      const role = row.is_admin ? 'admin' : 'user';
      const token = jwt.sign({ sub: String(row.id), role }, JWT_SECRET, {
        algorithm: 'HS256',
      });
      return jsonResponse({ accessToken: token });
    }
    return errorResponse('Invalid credentials', 401);
  } catch (err) {
    return errorResponse('Invalid credentials', 401);
  }
}

async function handleMe(headers) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  try {
    const result = await sql.unsafe(SQL_ME, [payload.sub]);
    const row = result[0];
    if (!row) return errorResponse('Unauthorized', 401);

    return jsonResponse({
      id: String(row.id),
      username: row.username,
      email: row.email,
      bio: row.bio,
      createdAt: row.created_at,
    });
  } catch (_e) {
    return errorResponse('Unauthorized', 401);
  }
}

async function handleCreateUser(headers, body) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const { username, email, password } = body || {};
  try {
    const isAdmin = await requireAdmin(payload);
    if (!isAdmin) return errorResponse('Forbidden', 403);

    const passwordHash = Bun.password.hashSync(String(password || ''), {
      algorithm: 'bcrypt',
    });
    const created = await sql.unsafe(SQL_CREATE_USER, [
      username,
      email,
      passwordHash,
      null,
    ]);
    const newId = created[0]?.id;
    if (!newId) return errorResponse('Failed to create user', 400);

    const fetched = await sql.unsafe(SQL_GET_USER, [newId]);
    const fetchedRow = fetched[0];
    if (!fetchedRow) return errorResponse('User not found', 404);

    return jsonResponse(shapeUserRow(fetchedRow), 201);
  } catch (e) {
    console.error(`Error creating user: ${e}`);
    return errorResponse('Failed to create user', 400);
  }
}

async function handleListUsers(headers, url) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const searchParams = url; // now receives URLSearchParams
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const isAdmin = await requireAdmin(payload);
  if (!isAdmin) return errorResponse('Forbidden', 403);

  const result = await sql.unsafe(SQL_LIST_USERS, [limit, offset]);
  return jsonResponse(result.map(shapeUserRow));
}

async function handleGetUser(headers, userId) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const isAdmin = await requireAdmin(payload);
  if (!isAdmin) return errorResponse('Forbidden', 403);

  const result = await sql.unsafe(SQL_GET_USER, [userId]);
  const row = result[0];
  if (!row) return errorResponse('User not found', 404);

  return jsonResponse(shapeUserRow(row));
}

async function handleUpdateUser(headers, userId, body) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const isAdmin = await requireAdmin(payload);
  if (!isAdmin) return errorResponse('Forbidden', 403);

  const { bio = null } = body || {};
  const result = await sql.unsafe(SQL_UPDATE_USER, [userId, bio]);
  const row = result[0];
  if (!row) return errorResponse('User not found', 404);

  return jsonResponse(shapeUserRow(row));
}

async function handleDeleteUser(headers, userId) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const isAdmin = await requireAdmin(payload);
  if (!isAdmin) return errorResponse('Forbidden', 403);

  const result = await sql.unsafe(SQL_DELETE_USER, [userId]);
  if (result.count !== 1) return errorResponse('User not found', 404);

  return new Response(null, { status: 204 });
}

async function handleCreatePost(headers, body) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const { content } = body || {};
  const result = await sql.unsafe(SQL_CREATE_POST, [payload.sub, content]);
  const row = result[0];
  if (!row) return errorResponse('Failed to create post', 400);

  return jsonResponse({ ...shapePostRow(row), likeCount: 0 }, 201);
}

async function handleListPosts(searchParams) {
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const result = await sql.unsafe(SQL_LIST_POSTS, [limit, offset]);
  return jsonResponse(result.map(shapePostRow));
}

async function handleGetPost(postId) {
  try {
    const result = await sql.unsafe(SQL_GET_POST, [postId]);
    const row = result[0];
    if (!row) return errorResponse('Post not found', 404);

    const shaped = shapePostRow(row);
    return jsonResponse(shaped);
  } catch (error) {
    console.error('Error in handleGetPost:', error);
    return errorResponse('Internal Server Error', 500);
  }
}

async function handleDeletePost(headers, postId) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const author = await sql.unsafe(SQL_GET_POST_AUTHOR, [postId]);
  const authorId = author[0]?.author_id;
  if (!authorId) return errorResponse('Post not found', 404);

  if (String(authorId) !== String(payload.sub)) {
    return errorResponse('Forbidden', 403);
  }

  await sql.unsafe(SQL_DELETE_POST, [postId]);
  return new Response(null, { status: 204 });
}

async function handleCreateComment(headers, postId, body) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const { content } = body || {};
  const exists = await sql.unsafe(SQL_GET_POST, [postId]);
  if (!exists[0]) return errorResponse('Post not found', 404);

  const result = await sql.unsafe(SQL_CREATE_COMMENT, [
    payload.sub,
    postId,
    content,
  ]);
  const row = result[0];
  if (!row) return errorResponse('Failed to create comment', 400);

  return jsonResponse(shapeCommentRow(row), 201);
}

async function handleListComments(postId) {
  try {
    const exists = await sql.unsafe(SQL_GET_POST, [postId]);
    if (!exists[0]) {
      return errorResponse('Post not found', 404);
    }

    const result = await sql.unsafe(SQL_LIST_COMMENTS, [postId]);
    const shaped = result.map(shapeCommentRow);
    return jsonResponse(shaped);
  } catch (error) {
    console.error('Error in handleListComments:', error);
    return errorResponse('Internal Server Error', 500);
  }
}

async function handleCreateLike(headers, postId) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  try {
    const result = await sql.unsafe(SQL_CREATE_LIKE, [payload.sub, postId]);
    if (result.rowCount === 1) {
      return new Response(null, { status: 204 });
    } else {
      // rowCount is 0, meaning ON CONFLICT DO NOTHING was triggered
      return errorResponse('Post already liked', 409);
    }
  } catch (error) {
    if (error.code === '23503') { // foreign_key_violation
      return errorResponse('Post not found', 404);
    } else if (error.code === '23505') { // unique_violation, for safety
      return errorResponse('Post already liked', 409);
    } else {
      console.error('Error in handleCreateLike:', error);
      return errorResponse('Internal Server Error', 500);
    }
  }
}

async function handleDeleteLike(headers, postId) {
  const payload = await getAuthPayload(headers);
  if (!payload) return errorResponse('Unauthorized', 401);

  const exists = await sql.unsafe(SQL_GET_POST, [postId]);
  if (!exists[0]) return errorResponse('Post not found', 404);

  const result = await sql.unsafe(SQL_DELETE_LIKE, [payload.sub, postId]);
  if (result.count !== 1) return errorResponse('Post or like not found', 404);

  return new Response(null, { status: 204 });
}

// Main request handler with routing
async function handleRequest(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  // Parse JSON body for POST/PUT requests
  let body = null;
  if (
    (method === 'POST' || method === 'PUT') &&
    req.headers.get('content-type')?.includes('application/json')
  ) {
    try {
      const text = await req.text();
      if (text && text.trim() !== '' && text.trim() !== 'null') {
        body = JSON.parse(text);
      }
    } catch (e) {
      return errorResponse('Invalid JSON', 400);
    }
  }

  // Route matching - exact same API contract as Express version
  if (method === 'POST' && pathname === '/auth/login') {
    return handleLogin(body);
  }

  if (method === 'GET' && pathname === '/auth/me') {
    return handleMe(req.headers);
  }

  // Users routes
  if (method === 'POST' && pathname === '/users') {
    return handleCreateUser(req.headers, body);
  }

  if (method === 'GET' && pathname === '/users') {
    return handleListUsers(req.headers, searchParams);
  }

  const userMatch = ROUTE_USER.exec(pathname);
  if (userMatch) {
    const userId = userMatch[1];
    if (method === 'GET') return handleGetUser(req.headers, userId);
    if (method === 'PUT') return handleUpdateUser(req.headers, userId, body);
    if (method === 'DELETE') return handleDeleteUser(req.headers, userId);
  }

  // Posts routes
  if (method === 'POST' && pathname === '/posts') {
    return handleCreatePost(req.headers, body);
  }

  if (method === 'GET' && pathname === '/posts') {
    return handleListPosts(searchParams);
  }

  const postMatch = ROUTE_POST.exec(pathname);
  if (postMatch) {
    const postId = postMatch[1];
    if (method === 'GET') return handleGetPost(postId);
    if (method === 'DELETE') return handleDeletePost(req.headers, postId);
  }

  // Comments routes
  const commentMatch = ROUTE_COMMENTS.exec(pathname);
  if (commentMatch) {
    const postId = commentMatch[1];
    if (method === 'POST')
      return handleCreateComment(req.headers, postId, body);
    if (method === 'GET') return handleListComments(postId);
  }

  // Likes routes
  const likeMatch = ROUTE_LIKE.exec(pathname);
  if (likeMatch) {
    const postId = likeMatch[1];
    if (method === 'POST') return handleCreateLike(req.headers, postId);
    if (method === 'DELETE') return handleDeleteLike(req.headers, postId);
  }

  // 404 for unmatched routes
  return errorResponse('Not Found', 404);
}

// Start Bun server
const PORT = parseInt(process.env.PORT || '3000', 10);

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
  error(error) {
    console.error('Server error:', error);
    return errorResponse('Internal Server Error', 500);
  },
});

console.log(
  `Bun native server with Bun Server and Bun SQL client listening on http://0.0.0.0:${PORT}`
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  try {
    await sql.end();
    server.stop();
  } catch (_e) {}
  process.exit(0);
});

process.on('SIGINT', async () => {
  try {
    await sql.end();
    server.stop();
  } catch (_e) {}
  process.exit(0);
});
