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

public final class UserHandler {

    private final DataSource ds;
    private final SqlLoader sql;
    private final JwtUtil jwt;

    public UserHandler(DataSource ds, SqlLoader sql, JwtUtil jwt) {
        this.ds = ds;
        this.sql = sql;
        this.jwt = jwt;
    }

    public void create(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;
        if (!Middleware.requireAdmin(ctx, claims)) return;

        var body = ctx.bodyAsClass(CreateUserRequest.class);
        String hash = BcryptUtil.hash(body.password());

        try (Connection conn = ds.getConnection()) {
            UUID newId;
            try (var ps = conn.prepareStatement(sql.createUser)) {
                ps.setString(1, body.username());
                ps.setString(2, body.email());
                ps.setString(3, hash);
                ps.setObject(4, null);
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    newId = rs.getObject("id", UUID.class);
                }
            }

            try (var ps = conn.prepareStatement(sql.getUser)) {
                ps.setObject(1, newId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "User not found"));
                        return;
                    }
                    ctx.status(HttpStatus.CREATED).json(Middleware.shapeUser(rs));
                }
            }
        }
    }

    public void list(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;
        if (!Middleware.requireAdmin(ctx, claims)) return;

        int limit = ctx.queryParamAsClass("limit", Integer.class).getOrDefault(20);
        int offset = ctx.queryParamAsClass("offset", Integer.class).getOrDefault(0);

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.listUsers)) {
            ps.setInt(1, limit);
            ps.setInt(2, offset);
            try (ResultSet rs = ps.executeQuery()) {
                var list = new ArrayList<Map<String, Object>>();
                while (rs.next()) {
                    list.add(Middleware.shapeUser(rs));
                }
                ctx.json(list);
            }
        }
    }

    public void get(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;
        if (!Middleware.requireAdmin(ctx, claims)) return;

        String userId = ctx.pathParam("user_id");

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.getUser)) {
            ps.setObject(1, UUID.fromString(userId));
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "User not found"));
                    return;
                }
                ctx.json(Middleware.shapeUser(rs));
            }
        }
    }

    public void update(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;
        if (!Middleware.requireAdmin(ctx, claims)) return;

        String userId = ctx.pathParam("user_id");
        var body = ctx.bodyAsClass(UpdateUserRequest.class);

        // SQL: UPDATE users SET bio = ? WHERE id = ? RETURNING ...
        // Parameter order follows text appearance: bio=$2 appears before id=$1
        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.updateUser)) {
            ps.setString(1, body.bio());
            ps.setObject(2, UUID.fromString(userId));
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "User not found"));
                    return;
                }
                ctx.json(Middleware.shapeUser(rs));
            }
        }
    }

    public void delete(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;
        if (!Middleware.requireAdmin(ctx, claims)) return;

        String userId = ctx.pathParam("user_id");

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.deleteUser)) {
            ps.setObject(1, UUID.fromString(userId));
            int rows = ps.executeUpdate();
            if (rows != 1) {
                ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "User not found"));
                return;
            }
            ctx.status(HttpStatus.NO_CONTENT);
        }
    }

    public record CreateUserRequest(String username, String email, String password) {}
    public record UpdateUserRequest(String bio) {}
}
