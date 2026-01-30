use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    
    #[error("Forbidden: {0}")]
    Forbidden(String),
    
    #[error("Not found: {0}")]
    NotFound(String),
    
    #[error("Bad request: {0}")]
    BadRequest(String),
    
    #[error("Conflict: {0}")]
    Conflict(String),
    
    #[error("Internal server error: {0}")]
    InternalServerError(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            AppError::Database(ref e) => {
                if let sqlx::Error::Database(db_err) = e {
                    if db_err.code().as_deref() == Some("57P01") {
                        tracing::debug!("Connection terminated, will retry: {:?}", e);
                    } else {
                        tracing::error!("Database error: {:?}", e);
                    }
                } else {
                    tracing::error!("Database error: {:?}", e);
                }
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
            AppError::Unauthorized(ref message) => (StatusCode::UNAUTHORIZED, message.as_str()),
            AppError::Forbidden(ref message) => (StatusCode::FORBIDDEN, message.as_str()),
            AppError::NotFound(ref message) => (StatusCode::NOT_FOUND, message.as_str()),
            AppError::BadRequest(ref message) => (StatusCode::BAD_REQUEST, message.as_str()),
            AppError::Conflict(ref message) => (StatusCode::CONFLICT, message.as_str()),
            AppError::InternalServerError(ref message) => {
                tracing::error!("Internal server error: {}", message);
                (StatusCode::INTERNAL_SERVER_ERROR, message.as_str())
            }
        };

        let body = Json(json!({
            "detail": error_message,
        }));

        (status, body).into_response()
    }
}
