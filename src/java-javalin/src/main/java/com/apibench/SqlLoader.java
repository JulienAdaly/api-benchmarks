package com.apibench;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class SqlLoader {

    public final String login;
    public final String me;
    public final String createUser;
    public final String getUser;
    public final String listUsers;
    public final String updateUser;
    public final String deleteUser;
    public final String createPost;
    public final String listPosts;
    public final String getPost;
    public final String getPostAuthor;
    public final String deletePost;
    public final String createComment;
    public final String listComments;
    public final String likeExists;
    public final String createLike;
    public final String deleteLike;

    public SqlLoader() {
        String queriesDir = System.getenv("QUERIES_DIR");
        Path base;
        if (queriesDir != null && !queriesDir.isEmpty()) {
            base = Path.of(queriesDir);
        } else {
            base = Path.of(System.getProperty("user.dir"), "..", "..", "database", "queries").normalize();
        }

        login = load(base, "auth/login.sql");
        me = load(base, "auth/me.sql");
        createUser = load(base, "users/create.sql");
        getUser = load(base, "users/get.sql");
        listUsers = load(base, "users/list.sql");
        updateUser = load(base, "users/update.sql");
        deleteUser = load(base, "users/delete.sql");
        createPost = load(base, "posts/create.sql");
        listPosts = load(base, "posts/list.sql");
        getPost = load(base, "posts/get.sql");
        getPostAuthor = load(base, "posts/get_author.sql");
        deletePost = load(base, "posts/delete.sql");
        createComment = load(base, "comments/create.sql");
        listComments = load(base, "comments/list.sql");
        likeExists = load(base, "likes/exists.sql");
        createLike = load(base, "likes/create.sql");
        deleteLike = load(base, "likes/delete.sql");
    }

    private static String load(Path base, String relative) {
        try {
            String sql = Files.readString(base.resolve(relative));
            // Convert PostgreSQL $1, $2 placeholders to JDBC ? placeholders
            return sql.replaceAll("\\$\\d+", "?");
        } catch (IOException e) {
            throw new RuntimeException("Failed to load SQL: " + base.resolve(relative), e);
        }
    }
}
