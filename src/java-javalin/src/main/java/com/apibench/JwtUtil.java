package com.apibench;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

public final class JwtUtil {

    private final SecretKey key;
    private final long expireMs;

    public JwtUtil() {
        String secret = System.getenv("JWT_SECRET");
        if (secret == null || secret.isEmpty()) {
            throw new IllegalStateException("JWT_SECRET must be set");
        }
        // Pad to at least 32 bytes for HS256
        while (secret.length() < 32) {
            secret = secret + secret;
        }
        this.key = Keys.hmacShaKeyFor(secret.substring(0, 32).getBytes(StandardCharsets.UTF_8));

        String expMin = System.getenv("JWT_EXPIRE_MINUTES");
        this.expireMs = (expMin != null && !expMin.isEmpty() ? Long.parseLong(expMin) : 60) * 60_000L;
    }

    public String sign(String userId, boolean isAdmin) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(userId)
                .claim("is_admin", isAdmin)
                .expiration(new Date(now + expireMs))
                .signWith(key)
                .compact();
    }

    public Claims verify(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
