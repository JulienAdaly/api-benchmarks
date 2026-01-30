from fastapi import HTTPException, status
import asyncpg


async def require_admin(decoded_token: dict) -> None:
    if not decoded_token.get("is_admin", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def shape_user_row(row: asyncpg.Record) -> dict:
    return {
        "id": str(row["id"]),
        "username": row["username"],
        "email": row["email"],
        "bio": row["bio"],
        "createdAt": row["created_at"],
    }


def shape_post_row(row: asyncpg.Record) -> dict:
    like_count = int(row["like_count"]) if ("like_count" in row) else 0
    return {
        "id": str(row["id"]),
        "authorId": str(row["author_id"]),
        "content": row["content"],
        "likeCount": like_count,
        "createdAt": row["created_at"],
    }


def shape_comment_row(row: asyncpg.Record) -> dict:
    return {
        "id": str(row["id"]),
        "authorId": str(row["author_id"]),
        "post_id": str(row["post_id"]),
        "content": row["content"],
        "createdAt": row["created_at"],
    }
