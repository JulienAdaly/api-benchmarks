package com.apibench;

import io.javalin.http.Context;
import io.javalin.http.HttpStatus;
import io.jsonwebtoken.Claims;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.Map;
import java.util.UUID;

public final class LikeHandler {

    private final DataSource ds;
    private final SqlLoader sql;
    private final JwtUtil jwt;

    public LikeHandler(DataSource ds, SqlLoader sql, JwtUtil jwt) {
        this.ds = ds;
        this.sql = sql;
        this.jwt = jwt;
    }

    public void like(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;

        String postId = ctx.pathParam("post_id");
        String userId = claims.getSubject();

        try (Connection conn = ds.getConnection()) {
            // Ensure post exists
            if (!postExists(conn, postId)) {
                ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Post not found"));
                return;
            }

            // Check if already liked
            try (var ps = conn.prepareStatement(sql.likeExists)) {
                ps.setObject(1, UUID.fromString(userId));
                ps.setObject(2, UUID.fromString(postId));
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        ctx.status(HttpStatus.CONFLICT).json(Map.of("error", "Post already liked"));
                        return;
                    }
                }
            }

            // Create like
            try (var ps = conn.prepareStatement(sql.createLike)) {
                ps.setObject(1, UUID.fromString(userId));
                ps.setObject(2, UUID.fromString(postId));
                ps.executeUpdate();
            }

            ctx.status(HttpStatus.NO_CONTENT);
        }
    }

    public void unlike(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;

        String postId = ctx.pathParam("post_id");
        String userId = claims.getSubject();

        try (Connection conn = ds.getConnection()) {
            // Ensure post exists
            if (!postExists(conn, postId)) {
                ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Post not found"));
                return;
            }

            try (var ps = conn.prepareStatement(sql.deleteLike)) {
                ps.setObject(1, UUID.fromString(userId));
                ps.setObject(2, UUID.fromString(postId));
                int rows = ps.executeUpdate();
                if (rows != 1) {
                    ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Post or like not found"));
                    return;
                }
            }

            ctx.status(HttpStatus.NO_CONTENT);
        }
    }

    private boolean postExists(Connection conn, String postId) throws Exception {
        try (var ps = conn.prepareStatement("SELECT 1 FROM posts WHERE id = ?")) {
            ps.setObject(1, UUID.fromString(postId));
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }
}
