use axum::{
    middleware,
    routing::{delete, get, post},
    Router,
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::env;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod auth;
mod error;
mod handlers;
mod models;
mod sql;

use auth::{auth_middleware, AuthConfig};
use handlers::*;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub auth_config: AuthConfig,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing with less verbose logging for better performance
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_axum_api=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Configuration
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://apibench:apibench_password@localhost:15432/apibench".to_string());

    let auth_config = AuthConfig::default();

    // Standardized DB pool configuration (can be overridden via environment variables)
    let max_connections = env::var("DB_POOL_MAX")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(50);
    let min_connections = env::var("DB_POOL_MIN")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(10);
    let acquire_timeout_secs = env::var("DB_POOL_ACQUIRE_TIMEOUT")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(10);
    let idle_timeout_secs = env::var("DB_POOL_IDLE_TIMEOUT")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(300);
    let max_lifetime_secs = env::var("DB_POOL_MAX_LIFETIME")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(1800);

    // Retry database connection with exponential backoff
    // This handles cases where the database might not be fully ready yet
    let mut retry_delay = 1u64;
    let mut attempt = 0u32;
    const MAX_RETRIES: u32 = 10;
    let pool = loop {
        attempt += 1;
        match PgPoolOptions::new()
            .max_connections(max_connections)
            .min_connections(min_connections)
            .acquire_timeout(std::time::Duration::from_secs(acquire_timeout_secs))
            .idle_timeout(std::time::Duration::from_secs(idle_timeout_secs))
            .max_lifetime(std::time::Duration::from_secs(max_lifetime_secs))
            .test_before_acquire(true)  // Test connections before use to handle terminated connections gracefully
            .connect(&database_url)
            .await
        {
            Ok(pool) => break pool,
            Err(e) => {
                if attempt >= MAX_RETRIES {
                    tracing::error!("Failed to connect to database after {} retries: {}", MAX_RETRIES, e);
                    return Err(e.into());
                }
                tracing::warn!(
                    "Database connection failed (attempt {}/{}), retrying in {}s: {}",
                    attempt,
                    MAX_RETRIES,
                    retry_delay,
                    e
                );
                tokio::time::sleep(std::time::Duration::from_secs(retry_delay)).await;
                retry_delay = std::cmp::min(retry_delay * 2, 10); // Exponential backoff, max 10s
            }
        }
    };

    // Create app state
    let app_state = AppState {
        db: pool,
        auth_config: auth_config.clone(),
    };

    // Build protected routes that require authentication
    let protected_routes = Router::new()
        .route("/auth/me", get(me))
        .route("/users", post(create_user).get(list_users))
        .route("/users/{userId}", get(get_user).put(update_user).delete(delete_user))
        .route("/posts", post(create_post))
        .route("/posts/{post_id}", delete(delete_post))
        .route("/posts/{post_id}/comments", post(create_comment))
        .route("/posts/{post_id}/like", post(like_post).delete(unlike_post))
        .layer(middleware::from_fn_with_state(
            auth_config,
            auth_middleware,
        ));

    // Build our application with routes
    let app = Router::new()
        // Public routes (no auth required)
        .route("/auth/login", post(login))
        .route("/posts", get(list_posts))
        .route("/posts/{post_id}", get(get_post))
        .route("/posts/{post_id}/comments", get(list_comments))
        // Merge protected routes
        .merge(protected_routes)
        // Add CORS (remove tracing layer for better performance)
        .layer(CorsLayer::permissive())
        // Add shared state
        .with_state(app_state);

    // Run the server
    let port = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()
        .unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    tracing::info!("Server running on http://0.0.0.0:{}", port);

    axum::serve(listener, app).await?;

    Ok(())
}
