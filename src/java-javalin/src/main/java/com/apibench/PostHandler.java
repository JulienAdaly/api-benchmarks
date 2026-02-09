package com.apibench;

import io.javalin.http.Context;
import io.javalin.http.HttpStatus;
import io.jsonwebtoken.Claims;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public final class PostHandler {

    private final DataSource ds;
    private final SqlLoader sql;
    private final JwtUtil jwt;

    public PostHandler(DataSource ds, SqlLoader sql, JwtUtil jwt) {
        this.ds = ds;
        this.sql = sql;
        this.jwt = jwt;
    }

    public void create(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;

        var body = ctx.bodyAsClass(CreatePostRequest.class);
        String userId = claims.getSubject();

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.createPost)) {
            ps.setObject(1, UUID.fromString(userId));
            ps.setString(2, body.content());
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                var map = new LinkedHashMap<String, Object>();
                map.put("id", rs.getObject("id").toString());
                map.put("authorId", rs.getObject("author_id").toString());
                map.put("content", rs.getString("content"));
                map.put("createdAt", rs.getTimestamp("created_at").toInstant());
                map.put("likeCount", 0);
                ctx.status(HttpStatus.CREATED).json(map);
            }
        }
    }

    public void list(Context ctx) throws Exception {
        int limit = ctx.queryParamAsClass("limit", Integer.class).getOrDefault(20);
        int offset = ctx.queryParamAsClass("offset", Integer.class).getOrDefault(0);

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.listPosts)) {
            ps.setInt(1, limit);
            ps.setInt(2, offset);
            try (ResultSet rs = ps.executeQuery()) {
                var list = new ArrayList<Map<String, Object>>();
                while (rs.next()) {
                    list.add(Middleware.shapePost(rs));
                }
                ctx.json(list);
            }
        }
    }

    public void get(Context ctx) throws Exception {
        String postId = ctx.pathParam("post_id");

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.getPost)) {
            ps.setObject(1, UUID.fromString(postId));
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Post not found"));
                    return;
                }
                ctx.json(Middleware.shapePost(rs));
            }
        }
    }

    public void delete(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;

        String postId = ctx.pathParam("post_id");
        String userId = claims.getSubject();

        try (Connection conn = ds.getConnection()) {
            // Check post exists and get author
            String authorId;
            try (var ps = conn.prepareStatement(sql.getPostAuthor)) {
                ps.setObject(1, UUID.fromString(postId));
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Post not found"));
                        return;
                    }
                    authorId = rs.getObject("author_id").toString();
                }
            }

            // Check authorization: must be author or admin
            if (!authorId.equals(userId)) {
                if (!Middleware.requireAdmin(ctx, claims)) return;
            }

            try (var ps = conn.prepareStatement(sql.deletePost)) {
                ps.setObject(1, UUID.fromString(postId));
                ps.executeUpdate();
            }

            ctx.status(HttpStatus.NO_CONTENT);
        }
    }

    public record CreatePostRequest(String content) {}
}
