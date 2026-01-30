import os
from pathlib import Path


def load_sql(relative_path: str) -> str:
    base_dir_env = os.getenv("QUERIES_DIR")
    if base_dir_env:
        base_dir = Path(base_dir_env)
    else:
        # repo_root/database/queries
        base_dir = Path(__file__).resolve().parents[3] / "database" / "queries"
    file_path = base_dir / relative_path
    try:
        return file_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RuntimeError(f"SQL file not found: {file_path}") from exc


# Auth
SQL_LOGIN = load_sql("auth/login.sql")
SQL_ME = load_sql("auth/me.sql")

# Users
SQL_CREATE_USER = load_sql("users/create.sql")
SQL_GET_USER = load_sql("users/get.sql")
SQL_LIST_USERS = load_sql("users/list.sql")
SQL_UPDATE_USER = load_sql("users/update.sql")
SQL_DELETE_USER = load_sql("users/delete.sql")

# Posts
SQL_CREATE_POST = load_sql("posts/create.sql")
SQL_LIST_POSTS = load_sql("posts/list.sql")
SQL_GET_POST = load_sql("posts/get.sql")
SQL_GET_POST_AUTHOR = load_sql("posts/get_author.sql")
SQL_DELETE_POST = load_sql("posts/delete.sql")

# Comments
SQL_CREATE_COMMENT = load_sql("comments/create.sql")
SQL_LIST_COMMENTS = load_sql("comments/list.sql")

# Likes
SQL_LIKE_EXISTS = load_sql("likes/exists.sql")
SQL_CREATE_LIKE = load_sql("likes/create.sql")
SQL_DELETE_LIKE = load_sql("likes/delete.sql")
