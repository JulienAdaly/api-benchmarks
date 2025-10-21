/*
Bun-optimized implementation using Express server with Bun runtime optimizations
- Uses Express server for compatibility
- Uses postgres client optimized for Bun
- Leverages Bun's faster startup and native APIs
- Uses ES modules and Bun-specific features
*/

import express from "express";
import postgres from "postgres";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { resolve } from "path";

// Configuration
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://apibench:apibench_password@localhost:15432/apibench";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRE_MINUTES = parseInt(process.env.JWT_EXPIRE_MINUTES || "60", 10);
// For parity with Python app; not used directly here
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));

// Same deterministic bcrypt salt used by the Python implementation
const BCRYPT_SALT = "$2b$08$WQZlxDJ5MmT7wSXFTy2UU.";

// Database connection - optimized for Bun
const PG_MAX = parseInt(process.env.PG_MAX || process.env.POSTGRES_MAX || "20", 10);
const PG_IDLE_TIMEOUT = parseInt(process.env.PG_IDLE_TIMEOUT || "30", 10);
const PG_CONNECT_TIMEOUT = parseInt(process.env.PG_CONNECT_TIMEOUT || "15", 10);
const sql = postgres(DATABASE_URL, {
  max: PG_MAX,
  idle_timeout: PG_IDLE_TIMEOUT,
  connect_timeout: PG_CONNECT_TIMEOUT,
});

// Helpers
function loadSql(relativePath) {
  const baseDirEnv = process.env.QUERIES_DIR;
  const baseDir = baseDirEnv ? baseDirEnv : resolve(import.meta.dir, "../../../database/queries");
  const filePath = resolve(baseDir, relativePath);
  try {
    return readFileSync(filePath, { encoding: "utf-8" });
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

function getToken(req, res) {
  const header = req.headers["authorization"];
  if (!header) {
    res.status(401).json({ detail: "Unauthorized" });
    return null;
  }
  const parts = header.split(" ");
  if (parts.length !== 2) {
    res.status(401).json({ detail: "Unauthorized" });
    return null;
  }
  return parts[1];
}

function decodeTokenOr401(token, res) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    res.status(401).json({ detail: "Unauthorized" });
    return null;
  }
}

async function requireAdminOr403(payload, res) {
  try {
    if (payload && payload.role === "admin") {
      return true;
    }
    res.status(403).json({ detail: "Forbidden" });
    return false;
  } catch (_e) {
    res.status(403).json({ detail: "Forbidden" });
    return false;
  }
}

// SQL queries - loaded once at startup for better performance
// Auth
const SQL_LOGIN = loadSql("auth/login.sql");
const SQL_ME = loadSql("auth/me.sql");

// Users
const SQL_CREATE_USER = loadSql("users/create.sql");
const SQL_GET_USER = loadSql("users/get.sql");
const SQL_LIST_USERS = loadSql("users/list.sql");
const SQL_UPDATE_USER = loadSql("users/update.sql");
const SQL_DELETE_USER = loadSql("users/delete.sql");

// Posts
const SQL_CREATE_POST = loadSql("posts/create.sql");
const SQL_LIST_POSTS = loadSql("posts/list.sql");
const SQL_GET_POST = loadSql("posts/get.sql");
const SQL_GET_POST_AUTHOR = loadSql("posts/get_author.sql");
const SQL_DELETE_POST = loadSql("posts/delete.sql");

// Comments
const SQL_CREATE_COMMENT = loadSql("comments/create.sql");
const SQL_LIST_COMMENTS = loadSql("comments/list.sql");

// Likes
const SQL_LIKE_EXISTS = loadSql("likes/exists.sql");
const SQL_CREATE_LIKE = loadSql("likes/create.sql");
const SQL_DELETE_LIKE = loadSql("likes/delete.sql");

// Express app setup
const app = express();
app.use(express.json());

// Auth endpoints
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const result = await sql.unsafe(SQL_LOGIN, [email]);
    const row = result[0];
    let isValid = false;
    if (row) {
      isValid = bcrypt.compareSync(String(password || ""), row.password_hash);
    }
    if (row && isValid) {
      const role = row.is_admin ? "admin" : "user";
      const token = jwt.sign({ sub: String(row.id), role }, JWT_SECRET, { algorithm: "HS256" });
      res.json({ accessToken: token });
      return;
    }
    res.status(401).json({ detail: "Invalid credentials" });
  } catch (err) {
    res.status(401).json({ detail: "Invalid credentials" });
  }
});

app.get("/auth/me", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  try {
    const result = await sql.unsafe(SQL_ME, [payload.sub]);
    const row = result[0];
    if (!row) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    res.json({
      id: String(row.id),
      username: row.username,
      email: row.email,
      bio: row.bio,
      createdAt: row.created_at,
    });
  } catch (_e) {
    res.status(401).json({ detail: "Unauthorized" });
  }
});

// Users (Admin only)
app.post("/users", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const { username, email, password } = req.body || {};
  try {
    const isAdmin = await requireAdminOr403(payload, res);
    if (!isAdmin) return;
    const passwordHash = bcrypt.hashSync(String(password || ""), BCRYPT_SALT);
    const created = await sql.unsafe(SQL_CREATE_USER, [username, email, passwordHash, null]);
    const newId = created[0] && created[0].id;
    if (!newId) {
      res.status(400).json({ detail: "Failed to create user" });
      return;
    }
    const fetched = await sql.unsafe(SQL_GET_USER, [newId]);
    const fetchedRow = fetched[0];
    if (!fetchedRow) {
      res.status(404).json({ detail: "User not found" });
      return;
    }
    res.status(201).json(shapeUserRow(fetchedRow));
  } catch (e) {
    console.error(`Error creating user: ${e}`);
    res.status(400).json({ detail: "Failed to create user" });
  }
});

app.get("/users", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const limit = parseInt(req.query.limit || "20", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const isAdmin = await requireAdminOr403(payload, res);
  if (!isAdmin) return;
  const result = await sql.unsafe(SQL_LIST_USERS, [limit, offset]);
  res.json(result.map(shapeUserRow));
});

app.get("/users/:userId", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const isAdmin = await requireAdminOr403(payload, res);
  if (!isAdmin) return;
  const result = await sql.unsafe(SQL_GET_USER, [req.params.userId]);
  const row = result[0];
  if (!row) {
    res.status(404).json({ detail: "User not found" });
    return;
  }
  res.json(shapeUserRow(row));
});

app.put("/users/:userId", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const isAdmin = await requireAdminOr403(payload, res);
  if (!isAdmin) return;
  const { bio = null } = req.body || {};
  const result = await sql.unsafe(SQL_UPDATE_USER, [req.params.userId, bio]);
  const row = result[0];
  if (!row) {
    res.status(404).json({ detail: "User not found" });
    return;
  }
  res.json(shapeUserRow(row));
});

app.delete("/users/:userId", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const isAdmin = await requireAdminOr403(payload, res);
  if (!isAdmin) return;
  const result = await sql.unsafe(SQL_DELETE_USER, [req.params.userId]);
  if (result.count !== 1) {
    res.status(404).json({ detail: "User not found" });
    return;
  }
  res.sendStatus(204);
});

// Posts
app.post("/posts", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const { content } = req.body || {};
  const result = await sql.unsafe(SQL_CREATE_POST, [payload.sub, content]);
  const row = result[0];
  if (!row) {
    res.status(400).json({ detail: "Failed to create post" });
    return;
  }
  res.status(201).json({ ...shapePostRow(row), likeCount: 0 });
});

app.get("/posts", async (req, res) => {
  const limit = parseInt(req.query.limit || "20", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const result = await sql.unsafe(SQL_LIST_POSTS, [limit, offset]);
  res.json(result.map(shapePostRow));
});

app.get("/posts/:postId", async (req, res) => {
  const result = await sql.unsafe(SQL_GET_POST, [req.params.postId]);
  const row = result[0];
  if (!row) {
    res.status(404).json({ detail: "Post not found" });
    return;
  }
  res.json(shapePostRow(row));
});

app.delete("/posts/:postId", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const postId = req.params.postId;
  const author = await sql.unsafe(SQL_GET_POST_AUTHOR, [postId]);
  const authorId = author[0] && author[0].author_id;
  if (!authorId) {
    res.status(404).json({ detail: "Post not found" });
    return;
  }
  if (String(authorId) !== String(payload.sub)) {
    res.status(403).json({ detail: "Forbidden" });
    return;
  }
  await sql.unsafe(SQL_DELETE_POST, [postId]);
  res.sendStatus(204);
});

// Comments
app.post("/posts/:postId/comments", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const postId = req.params.postId;
  const { content } = req.body || {};
  const exists = await sql.unsafe(SQL_GET_POST, [postId]);
  if (!exists[0]) {
    res.status(404).json({ detail: "Post not found" });
    return;
  }
  const result = await sql.unsafe(SQL_CREATE_COMMENT, [payload.sub, postId, content]);
  const row = result[0];
  if (!row) {
    res.status(400).json({ detail: "Failed to create comment" });
    return;
  }
  res.status(201).json(shapeCommentRow(row));
});

app.get("/posts/:postId/comments", async (req, res) => {
  const postId = req.params.postId;
  const exists = await sql.unsafe(SQL_GET_POST, [postId]);
  if (!exists[0]) {
    res.status(404).json({ detail: "Post not found" });
    return;
  }
  const result = await sql.unsafe(SQL_LIST_COMMENTS, [postId]);
  res.json(result.map(shapeCommentRow));
});

// Likes
app.post("/posts/:postId/like", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const postId = req.params.postId;
  const exists = await sql.unsafe(SQL_GET_POST, [postId]);
  if (!exists[0]) {
    res.status(404).json({ detail: "Post not found" });
    return;
  }
  const already = await sql.unsafe(SQL_LIKE_EXISTS, [payload.sub, postId]);
  if (already[0]) {
    res.status(409).json({ detail: "Post already liked" });
    return;
  }
  try {
    await sql.unsafe(SQL_CREATE_LIKE, [payload.sub, postId]);
    res.sendStatus(204);
  } catch (e) {
    if (e.code === "23505") {
      // unique_violation
      res.status(409).json({ detail: "Post already liked" });
      return;
    }
    console.error("Error in handleCreateLike:", e);
    res.status(500).json({ detail: "Internal Server Error" });
  }
});

app.delete("/posts/:postId/like", async (req, res) => {
  const bearer = getToken(req, res);
  if (!bearer) return;
  const payload = decodeTokenOr401(bearer, res);
  if (!payload) return;
  const postId = req.params.postId;
  const exists = await sql.unsafe(SQL_GET_POST, [postId]);
  if (!exists[0]) {
    res.status(404).json({ detail: "Post not found" });
    return;
  }
  const result = await sql.unsafe(SQL_DELETE_LIKE, [payload.sub, postId]);
  if (result.count !== 1) {
    res.status(404).json({ detail: "Post or like not found" });
    return;
  }
  res.sendStatus(204);
});

// Startup & Shutdown
const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, () => {
  console.log(`Bun-optimized Express server listening on http://0.0.0.0:${PORT}`);
});

process.on("SIGTERM", async () => {
  try { await sql.end(); } catch (_e) {}
  process.exit(0);
});

process.on("SIGINT", async () => {
  try { await sql.end(); } catch (_e) {}
  process.exit(0);
});