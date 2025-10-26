use axum::{
    extract::{Path, Query, State, Extension},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::{create_token, hash_password, verify_password, Claims},
    error::AppError,
    models::*,
    sql::*,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    20
}

////////////////////////////////////////////////////////////////////////////////
// Auth endpoints
////////////////////////////////////////////////////////////////////////////////

pub async fn login(
    State(app_state): State<AppState>,
    Json(credentials): Json<LoginCredentials>,
) -> Result<Json<LoginResponse>, AppError> {
    let login_row: Option<LoginRow> = sqlx::query_as(SQL_LOGIN)
        .bind(&credentials.email)
        .fetch_optional(&app_state.db)
        .await?;

    if let Some(row) = login_row {
        let is_valid = verify_password(&credentials.password, &row.password_hash).await?;

        if is_valid {
            let token = create_token(&row.id, row.is_admin, &app_state.auth_config)?;
            return Ok(Json(LoginResponse {
                access_token: token,
            }));
        }
    }

    Err(AppError::Unauthorized("Invalid credentials".to_string()))
}

pub async fn me(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<User>, AppError> {
    let user_uuid = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let user_row: Option<UserRow> = sqlx::query_as(SQL_ME)
        .bind(user_uuid)
        .fetch_optional(&app_state.db)
        .await?;

    match user_row {
        Some(row) => Ok(Json(User::from(row))),
        None => Err(AppError::Unauthorized("User not found".to_string())),
    }
}

////////////////////////////////////////////////////////////////////////////////
// Users endpoints (Admin only)
////////////////////////////////////////////////////////////////////////////////

pub async fn create_user(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(user_data): Json<CreateUser>,
) -> Result<(StatusCode, Json<User>), AppError> {
    if !claims.is_admin {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let password_hash = hash_password(&user_data.password).await?;

    let created_id: Uuid = sqlx::query_scalar(SQL_CREATE_USER)
        .bind(&user_data.username)
        .bind(&user_data.email)
        .bind(&password_hash)
        .bind(None::<String>) // bio is None for new users
        .fetch_one(&app_state.db)
        .await
        .map_err(|_| AppError::BadRequest("Failed to create user".to_string()))?;

    let user_row: UserRow = sqlx::query_as(SQL_GET_USER)
        .bind(created_id)
        .fetch_one(&app_state.db)
        .await?;

    Ok((StatusCode::CREATED, Json(User::from(user_row))))
}

pub async fn list_users(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Vec<User>>, AppError> {
    if !claims.is_admin {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let user_rows: Vec<UserRow> = sqlx::query_as(SQL_LIST_USERS)
        .bind(pagination.limit)
        .bind(pagination.offset)
        .fetch_all(&app_state.db)
        .await?;

    let users: Vec<User> = user_rows.into_iter().map(User::from).collect();
    Ok(Json(users))
}

pub async fn get_user(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_user_id): Path<String>,
) -> Result<Json<User>, AppError> {
    if !claims.is_admin {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let target_uuid = Uuid::parse_str(&target_user_id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let user_row: Option<UserRow> = sqlx::query_as(SQL_GET_USER)
        .bind(target_uuid)
        .fetch_optional(&app_state.db)
        .await?;

    match user_row {
        Some(row) => Ok(Json(User::from(row))),
        None => Err(AppError::NotFound("User not found".to_string())),
    }
}

pub async fn update_user(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_user_id): Path<String>,
    Json(update_data): Json<UpdateUser>,
) -> Result<Json<User>, AppError> {
    if !claims.is_admin {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let target_uuid = Uuid::parse_str(&target_user_id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let user_row: Option<UserRow> = sqlx::query_as(SQL_UPDATE_USER)
        .bind(target_uuid)
        .bind(update_data.bio.as_deref())
        .fetch_optional(&app_state.db)
        .await?;

    match user_row {
        Some(row) => Ok(Json(User::from(row))),
        None => Err(AppError::NotFound("User not found".to_string())),
    }
}

pub async fn delete_user(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, AppError> {
    if !claims.is_admin {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let target_uuid = Uuid::parse_str(&target_user_id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let result = sqlx::query(SQL_DELETE_USER)
        .bind(target_uuid)
        .execute(&app_state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("User not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

////////////////////////////////////////////////////////////////////////////////
// Posts endpoints
////////////////////////////////////////////////////////////////////////////////

pub async fn create_post(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(post_data): Json<PostCreate>,
) -> Result<(StatusCode, Json<Post>), AppError> {
    let user_uuid = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let post_row: PostCreateRow = sqlx::query_as(SQL_CREATE_POST)
        .bind(user_uuid)
        .bind(&post_data.content)
        .fetch_one(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create post: {:?}", e);
            match e {
                sqlx::Error::Database(db_err) => {
                    AppError::BadRequest(format!("Database error: {}", db_err))
                }
                sqlx::Error::PoolTimedOut => {
                    AppError::InternalServerError("Database connection timeout".to_string())
                }
                _ => AppError::BadRequest("Failed to create post".to_string())
            }
        })?;

    let post = Post::from(post_row);

    Ok((StatusCode::CREATED, Json(post)))
}

pub async fn list_posts(
    State(app_state): State<AppState>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Vec<Post>>, AppError> {
    let post_rows: Vec<PostRow> = sqlx::query_as(SQL_LIST_POSTS)
        .bind(pagination.limit)
        .bind(pagination.offset)
        .fetch_all(&app_state.db)
        .await?;

    let posts: Vec<Post> = post_rows.into_iter().map(Post::from).collect();
    Ok(Json(posts))
}

pub async fn get_post(
    State(app_state): State<AppState>,
    Path(post_id): Path<String>,
) -> Result<Json<Post>, AppError> {
    let post_uuid = Uuid::parse_str(&post_id)
        .map_err(|_| AppError::BadRequest("Invalid post ID".to_string()))?;

    let post_row: Option<PostRow> = sqlx::query_as(SQL_GET_POST)
        .bind(post_uuid)
        .fetch_optional(&app_state.db)
        .await?;

    match post_row {
        Some(row) => Ok(Json(Post::from(row))),
        None => Err(AppError::NotFound("Post not found".to_string())),
    }
}

pub async fn delete_post(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(post_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let user_uuid = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;
    let post_uuid = Uuid::parse_str(&post_id)
        .map_err(|_| AppError::BadRequest("Invalid post ID".to_string()))?;

    // Check if post exists and get author
    let author_id: Option<Uuid> = sqlx::query_scalar(SQL_GET_POST_AUTHOR)
        .bind(post_uuid)
        .fetch_optional(&app_state.db)
        .await?;

    let author_id = author_id.ok_or_else(|| AppError::NotFound("Post not found".to_string()))?;

    if author_id != user_uuid && !claims.is_admin {
        return Err(AppError::Forbidden(
            "You can only delete your own posts".to_string(),
        ));
    }

    sqlx::query(SQL_DELETE_POST)
        .bind(post_uuid)
        .execute(&app_state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

////////////////////////////////////////////////////////////////////////////////
// Comments endpoints
////////////////////////////////////////////////////////////////////////////////

pub async fn create_comment(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(post_id): Path<String>,
    Json(comment_data): Json<CommentCreate>,
) -> Result<(StatusCode, Json<Comment>), AppError> {
    let user_uuid = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;
    let post_uuid = Uuid::parse_str(&post_id)
        .map_err(|_| AppError::BadRequest("Invalid post ID".to_string()))?;

    let comment_row: CommentRow = sqlx::query_as(SQL_CREATE_COMMENT)
        .bind(user_uuid)
        .bind(post_uuid)
        .bind(&comment_data.content)
        .fetch_one(&app_state.db)
        .await
        .map_err(|e| {
            if let Some(db_err) = e.as_database_error() {
                if let Some(pg_err) = db_err.try_downcast_ref::<sqlx::postgres::PgDatabaseError>() {
                    // 23503: foreign_key_violation
                    if pg_err.code() == "23503" {
                        return AppError::NotFound("Post not found".to_string());
                    }
                }
            }
            AppError::BadRequest("Failed to create comment".to_string())
        })?;

    Ok((StatusCode::CREATED, Json(Comment::from(comment_row))))
}

pub async fn list_comments(
    State(app_state): State<AppState>,
    Path(post_id): Path<String>,
) -> Result<Json<Vec<Comment>>, AppError> {
    let post_uuid = Uuid::parse_str(&post_id)
        .map_err(|_| AppError::BadRequest("Invalid post ID".to_string()))?;

    // Check if post exists
    let post_exists: Option<PostRow> = sqlx::query_as(SQL_GET_POST)
        .bind(post_uuid)
        .fetch_optional(&app_state.db)
        .await?;

    if post_exists.is_none() {
        return Err(AppError::NotFound("Post not found".to_string()));
    }

    let comment_rows: Vec<CommentRow> = sqlx::query_as(SQL_LIST_COMMENTS)
        .bind(post_uuid)
        .fetch_all(&app_state.db)
        .await?;

    let comments: Vec<Comment> = comment_rows.into_iter().map(Comment::from).collect();
    Ok(Json(comments))
}

////////////////////////////////////////////////////////////////////////////////
// Likes endpoints
////////////////////////////////////////////////////////////////////////////////

pub async fn like_post(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(post_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let user_uuid = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;
    let post_uuid = Uuid::parse_str(&post_id)
        .map_err(|_| AppError::BadRequest("Invalid post ID".to_string()))?;

    let result = sqlx::query(SQL_CREATE_LIKE)
        .bind(user_uuid)
        .bind(post_uuid)
        .execute(&app_state.db)
        .await;

    match result {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            if let Some(db_err) = e.as_database_error() {
                if let Some(pg_err) = db_err.try_downcast_ref::<sqlx::postgres::PgDatabaseError>() {
                    match pg_err.code() {
                        "23505" => return Err(AppError::Conflict("Post already liked".to_string())), // unique_violation
                        "23503" => return Err(AppError::NotFound("Post not found".to_string())), // foreign_key_violation
                        _ => {}
                    }
                }
            }
            Err(e.into())
        }
    }
}

pub async fn unlike_post(
    State(app_state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(post_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let user_uuid = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;
    let post_uuid = Uuid::parse_str(&post_id)
        .map_err(|_| AppError::BadRequest("Invalid post ID".to_string()))?;

    let result = sqlx::query(SQL_DELETE_LIKE)
        .bind(user_uuid)
        .bind(post_uuid)
        .execute(&app_state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Post or like not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}
