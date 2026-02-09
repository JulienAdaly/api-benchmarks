package com.apibench;

import io.javalin.http.Context;
import io.javalin.http.HttpStatus;
import io.jsonwebtoken.Claims;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.Map;

public final class AuthHandler {

    private final DataSource ds;
    private final SqlLoader sql;
    private final JwtUtil jwt;

    public AuthHandler(DataSource ds, SqlLoader sql, JwtUtil jwt) {
        this.ds = ds;
        this.sql = sql;
        this.jwt = jwt;
    }

    public void login(Context ctx) throws Exception {
        var body = ctx.bodyAsClass(LoginRequest.class);

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement("SELECT id::text, password_hash, is_admin FROM users WHERE email = ?")) {
            ps.setString(1, body.email());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", "Invalid credentials"));
                    return;
                }
                String id = rs.getString("id");
                String passwordHash = rs.getString("password_hash");
                boolean isAdmin = rs.getBoolean("is_admin");

                if (!BcryptUtil.verify(body.password(), passwordHash)) {
                    ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", "Invalid credentials"));
                    return;
                }

                String token = jwt.sign(id, isAdmin);
                ctx.json(Map.of("accessToken", token));
            }
        }
    }

    public void me(Context ctx) throws Exception {
        Claims claims = Middleware.requireAuth(ctx, jwt);
        if (claims == null) return;

        String userId = claims.getSubject();

        try (Connection conn = ds.getConnection();
             var ps = conn.prepareStatement(sql.me)) {
            ps.setObject(1, java.util.UUID.fromString(userId));
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", "Unauthorized"));
                    return;
                }
                ctx.json(Middleware.shapeUser(rs));
            }
        }
    }

    public record LoginRequest(String email, String password) {}
}
