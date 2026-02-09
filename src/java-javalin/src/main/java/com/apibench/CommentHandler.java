package com.apibench;

import io.javalin.http.Context;
import io.javalin.http.HttpStatus;
import io.jsonwebtoken.Claims;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;

public final class CommentHandler {

    private final DataSource ds;
    private final SqlLoader sql;
    private final JwtUtil jwt;

    public CommentHandler(DataSource ds, SqlLoader sql, JwtUtil jwt) {
        this.ds = ds;
        this.sql = sql;
        this.jwt = jwt;
    }

    public void create(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;

        String postId = ctx.pathParam("post_id");
        var body = ctx.bodyAsClass(CreateCommentRequest.class);
        String userId = claims.getSubject();

        try (Connection conn = ds.getConnection()) {
            // Ensure post exists
            if (!postExists(conn, postId)) {
                ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Post not found"));
                return;
            }

            try (var ps = conn.prepareStatement(sql.createComment)) {
                ps.setObject(1, UUID.fromString(userId));
                ps.setObject(2, UUID.fromString(postId));
                ps.setString(3, body.content());
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    ctx.status(HttpStatus.CREATED).json(Middleware.shapeComment(rs));
                }
            }
        }
    }

    public void list(Context ctx) throws Exception {
        String postId = ctx.pathParam("post_id");

        try (Connection conn = ds.getConnection()) {
            // Ensure post exists
            if (!postExists(conn, postId)) {
                ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Post not found"));
                return;
            }

            try (var ps = conn.prepareStatement(sql.listComments)) {
                ps.setObject(1, UUID.fromString(postId));
                try (ResultSet rs = ps.executeQuery()) {
                    var list = new ArrayList<Map<String, Object>>();
                    while (rs.next()) {
                        list.add(Middleware.shapeComment(rs));
                    }
                    ctx.json(list);
                }
            }
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

    public record CreateCommentRequest(String content) {}
}
