-- Foreign-key and sort/path indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_author_created_at
  ON posts(author_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_post_created_at
  ON comments(post_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_author_created_at
  ON comments(author_id, created_at DESC);

-- Checking/aggregating likes by post
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_post_likes_post
  ON post_likes(post_id);

-- Paginate "recent posts" globally
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_created_at
  ON posts(created_at DESC);

-- Users pagination by creation time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at
  ON users(created_at DESC);