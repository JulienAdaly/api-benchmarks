ALTER TABLE posts ADD COLUMN IF NOT EXISTS likes_count integer NOT NULL DEFAULT 0;

-- Backfill existing counts (safe to skip in empty/dev DB)
UPDATE posts p
SET likes_count = pl.cnt
FROM (
  SELECT post_id, COUNT(*)::int AS cnt
  FROM post_likes
  GROUP BY post_id
) pl
WHERE p.id = pl.post_id;

CREATE OR REPLACE FUNCTION increment_likes_count() RETURNS trigger AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_likes_count() RETURNS trigger AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count - 1 WHERE id = OLD.post_id;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_likes_inc ON post_likes;
CREATE TRIGGER post_likes_inc AFTER INSERT ON post_likes
  FOR EACH ROW EXECUTE FUNCTION increment_likes_count();

DROP TRIGGER IF EXISTS post_likes_dec ON post_likes;
CREATE TRIGGER post_likes_dec AFTER DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION decrement_likes_count();