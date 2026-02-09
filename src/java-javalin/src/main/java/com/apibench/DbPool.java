package com.apibench;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import java.net.URI;

public final class DbPool {

    private final HikariDataSource ds;

    public DbPool() {
        String databaseUrl = System.getenv("DATABASE_URL");
        if (databaseUrl == null || databaseUrl.isEmpty()) {
            throw new IllegalStateException("DATABASE_URL must be set");
        }

        URI uri = URI.create(databaseUrl);
        String host = uri.getHost();
        int port = uri.getPort() > 0 ? uri.getPort() : 5432;
        String dbName = uri.getPath().substring(1); // strip leading /
        String userInfo = uri.getUserInfo();
        String user = null;
        String password = null;
        if (userInfo != null) {
            String[] parts = userInfo.split(":", 2);
            user = parts[0];
            if (parts.length > 1) {
                password = parts[1];
            }
        }

        String jdbcUrl = "jdbc:postgresql://" + host + ":" + port + "/" + dbName;

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(jdbcUrl);
        if (user != null) config.setUsername(user);
        if (password != null) config.setPassword(password);

        config.setMaximumPoolSize(envInt("DB_POOL_MAX", 10));
        config.setMinimumIdle(envInt("DB_POOL_MIN", 5));
        config.setIdleTimeout(envInt("DB_POOL_IDLE_TIMEOUT", 300) * 1000L);
        config.setMaxLifetime(envInt("DB_POOL_MAX_LIFETIME", 1800) * 1000L);
        config.setConnectionTimeout(envInt("DB_POOL_ACQUIRE_TIMEOUT", 10) * 1000L);

        ds = new HikariDataSource(config);
    }

    public HikariDataSource getDataSource() {
        return ds;
    }

    public void close() {
        ds.close();
    }

    private static int envInt(String key, int fallback) {
        String v = System.getenv(key);
        if (v == null || v.isEmpty()) return fallback;
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
