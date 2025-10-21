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

    // Create database connection pool with high-load optimized settings
    let pool = PgPoolOptions::new()
        .max_connections(50)  // Increase significantly for 1000 VUs
        .min_connections(10)  // Keep more connections ready
        .acquire_timeout(std::time::Duration::from_secs(10))  // Longer timeout
        .idle_timeout(std::time::Duration::from_secs(300))    // Shorter idle timeout
        .max_lifetime(std::time::Duration::from_secs(1800))
        .test_before_acquire(false)  // Skip connection testing for speed
        .connect(&database_url)
        .await?;

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
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("Server running on http://0.0.0.0:8080");
    
    axum::serve(listener, app).await?;

    Ok(())
}