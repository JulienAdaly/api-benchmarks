from fastapi import FastAPI, Depends, HTTPException, status, Request, Response
from fastapi.responses import ORJSONResponse
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.concurrency import run_in_threadpool
import os
import asyncpg
from asyncpg import exceptions as pg_exc
import jwt
import bcrypt

from typing import Optional, List

from src.models import (
    LoginCredentialsModel,
    CreateUserModel,
    UpdateUserModel,
    PostCreateModel,
    CommentCreateModel,
)
from src.utils import require_admin, shape_user_row, shape_post_row, shape_comment_row
from src.sql import (
    SQL_LOGIN,
    SQL_ME,
    SQL_CREATE_USER,
    SQL_GET_USER,
    SQL_LIST_USERS,
    SQL_UPDATE_USER,
    SQL_DELETE_USER,
    SQL_CREATE_POST,
    SQL_LIST_POSTS,
    SQL_GET_POST,
    SQL_GET_POST_AUTHOR,
    SQL_DELETE_POST,
    SQL_CREATE_COMMENT,
    SQL_LIST_COMMENTS,
    SQL_CREATE_LIKE,
    SQL_DELETE_LIKE,
)


################################################################################
# Configuration
################################################################################

DATABASE_URL = os.getenv("DATABASE_URL")
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))
ADMIN_USER = os.getenv("ADMIN_USER")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
BCRYPT_SALT = os.getenv("BCRYPT_SALT")


################################################################################
# Helper functions
################################################################################


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


def get_token(request: Request) -> str:
    token = request.headers.get("Authorization")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )
    return token.split(" ")[1]


################################################################################
# App setup
################################################################################


app: FastAPI = FastAPI(
    log_level=None,
    default_response_class=ORJSONResponse,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.on_event("startup")
async def on_startup() -> None:
    pool_min = int(os.getenv("DB_POOL_MIN", "10"))
    pool_max = int(os.getenv("DB_POOL_MAX", "20"))
    app.state.db_pool = await asyncpg.create_pool(
        DATABASE_URL,
        min_size=pool_min,
        max_size=pool_max,
    )


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await app.state.db_pool.close()


async def get_db_connection():
    async with app.state.db_pool.acquire() as conn:
        yield conn

################################################################################
# Auth endpoints
################################################################################


@app.post("/auth/login", response_model=dict)
async def login(
    body: LoginCredentialsModel, conn: asyncpg.Connection = Depends(get_db_connection)
) -> dict:
    result = await conn.fetchrow(
        SQL_LOGIN,
        body.email,
    )

    is_valid = False
    if result:
        # Offload CPU-bound bcrypt check to a threadpool to avoid blocking the event loop
        is_valid = await run_in_threadpool(
            bcrypt.checkpw,
            body.password.encode(),
            result["password_hash"].encode(),
        )
    if result and is_valid:
        token = jwt.encode(
            {"sub": str(result["id"]), "is_admin": result["is_admin"]},
            JWT_SECRET,
            algorithm="HS256",
        )

        return {"accessToken": token}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
    )


@app.get("/auth/me", response_model=dict)
async def me(
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> dict:
    id = decode_token(token)["sub"]
    result = await conn.fetchrow(
        SQL_ME,
        id,
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )
    return {
        "id": str(result["id"]),
        "username": result["username"],
        "email": result["email"],
        "bio": result["bio"],
        "createdAt": result["created_at"],
    }


################################################################################
# Users endpoints (Admin only)
################################################################################


@app.post(
    "/users",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new user (Admin only)",
)
async def create_user(
    user: CreateUserModel,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> Optional[dict]:
    await require_admin(decode_token(token))

    if not BCRYPT_SALT:
        raise ValueError("BCRYPT_SALT is not set")

    hashed_bytes = await run_in_threadpool(
        bcrypt.hashpw,
        user.password.encode(),
        BCRYPT_SALT.encode(),
    )
    hashed_password = hashed_bytes.decode()

    created = await conn.fetchrow(
        SQL_CREATE_USER,
        user.username,
        user.email,
        hashed_password,
        None,
    )
    if not created:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create user"
        )
    new_id = created["id"]
    fetched = await conn.fetchrow(SQL_GET_USER, new_id)
    if not fetched:
        # Should not happen, but be safe
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return shape_user_row(fetched)


@app.get("/users", response_model=List[dict], summary="List all users (Admin only)")
async def list_users(
    limit: int = 20,
    offset: int = 0,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> List[dict]:
    await require_admin(decode_token(token))

    rows = await conn.fetch(SQL_LIST_USERS, limit, offset)
    return [shape_user_row(r) for r in rows]


@app.put("/users/{user_id}", response_model=dict, summary="Update user (Admin only)")
async def update_user(
    user_id: str,
    update: UpdateUserModel,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> dict:
    await require_admin(decode_token(token))

    row = await conn.fetchrow(SQL_UPDATE_USER, user_id, update.bio)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return shape_user_row(row)


@app.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete user (Admin only)",
)
async def delete_user(
    user_id: str,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> Response:
    await require_admin(decode_token(token))

    result = await conn.execute(SQL_DELETE_USER, user_id)
    if not result.endswith(" 1"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


################################################################################
# Posts endpoints
################################################################################


@app.post("/posts", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_post(
    body: PostCreateModel,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> dict:
    user_id = decode_token(token)["sub"]
    row = await conn.fetchrow(SQL_CREATE_POST, user_id, body.content)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create post"
        )
    # New posts have zero likes
    return {
        **shape_post_row(row),
        "likeCount": 0,
    }


@app.get("/posts", response_model=List[dict])
async def list_posts(
    limit: int = 20,
    offset: int = 0,
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> List[dict]:
    rows = await conn.fetch(SQL_LIST_POSTS, limit, offset)
    return [shape_post_row(r) for r in rows]


@app.get("/posts/{post_id}", response_model=dict)
async def get_post(
    post_id: str, conn: asyncpg.Connection = Depends(get_db_connection)
) -> dict:
    row = await conn.fetchrow(SQL_GET_POST, post_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    return shape_post_row(row)


@app.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: str,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> Response:
    decoded_token = decode_token(token)

    user_id = decoded_token["sub"]
    author_id = await conn.fetchval(SQL_GET_POST_AUTHOR, post_id)
    if not author_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    if str(author_id) != str(user_id):
        await require_admin(decoded_token)

    await conn.execute(SQL_DELETE_POST, post_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


################################################################################
# Comments endpoints
################################################################################


@app.post(
    "/posts/{post_id}/comments",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    post_id: str,
    body: CommentCreateModel,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> dict:
    user_id = decode_token(token)["sub"]
    try:
        row = await conn.fetchrow(SQL_CREATE_COMMENT, user_id, post_id, body.content)
    except pg_exc.ForeignKeyViolationError:
        # Post (or user) does not exist
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create comment"
        )
    return shape_comment_row(row)


@app.get("/posts/{post_id}/comments", response_model=List[dict])
async def list_comments(
    post_id: str, conn: asyncpg.Connection = Depends(get_db_connection)
) -> List[dict]:
    exists = await conn.fetchrow(SQL_GET_POST, post_id)
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    rows = await conn.fetch(SQL_LIST_COMMENTS, post_id)
    return [shape_comment_row(r) for r in rows]


################################################################################
# Likes endpoints
################################################################################


@app.post("/posts/{post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
async def like_post(
    post_id: str,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> Response:
    user_id = decode_token(token)["sub"]
    try:
        result = await conn.execute(SQL_CREATE_LIKE, user_id, post_id)
        # If SQL uses ON CONFLICT DO NOTHING, result can be "INSERT 0 0" when already liked
        if result.strip().endswith(" 0"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Post already liked"
            )
    except pg_exc.UniqueViolationError:
        # Duplicate like without ON CONFLICT clause
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Post already liked"
        )
    except pg_exc.ForeignKeyViolationError:
        # Post (or user) does not exist
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete("/posts/{post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_post(
    post_id: str,
    token: str = Depends(get_token),
    conn: asyncpg.Connection = Depends(get_db_connection),
) -> Response:
    user_id = decode_token(token)["sub"]
    result = await conn.execute(SQL_DELETE_LIKE, user_id, post_id)
    if not result.endswith(" 1"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post or like not found"
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
