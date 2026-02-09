package com.apibench;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.javalin.Javalin;
import io.javalin.json.JavalinJackson;

import javax.sql.DataSource;

public class App {

    public static void main(String[] args) {
        var sql = new SqlLoader();
        var dbPool = new DbPool();
        var jwt = new JwtUtil();
        DataSource ds = dbPool.getDataSource();

        var mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        var authHandler = new AuthHandler(ds, sql, jwt);
        var userHandler = new UserHandler(ds, sql, jwt);
        var postHandler = new PostHandler(ds, sql, jwt);
        var commentHandler = new CommentHandler(ds, sql, jwt);
        var likeHandler = new LikeHandler(ds, sql, jwt);

        int port = 8081;
        String portEnv = System.getenv("PORT");
        if (portEnv != null && !portEnv.isEmpty()) {
            port = Integer.parseInt(portEnv);
        }

        var app = Javalin.create(config -> {
            config.useVirtualThreads = true;
            config.jsonMapper(new JavalinJackson(mapper, false));
            config.showJavalinBanner = false;
        });

        // Auth routes
        app.post("/auth/login", authHandler::login);
        app.get("/auth/me", authHandler::me);

        // User routes
        app.post("/users", userHandler::create);
        app.get("/users", userHandler::list);
        app.get("/users/{user_id}", userHandler::get);
        app.put("/users/{user_id}", userHandler::update);
        app.delete("/users/{user_id}", userHandler::delete);

        // Post routes
        app.post("/posts", postHandler::create);
        app.get("/posts", postHandler::list);
        app.get("/posts/{post_id}", postHandler::get);
        app.delete("/posts/{post_id}", postHandler::delete);

        // Comment routes
        app.post("/posts/{post_id}/comments", commentHandler::create);
        app.get("/posts/{post_id}/comments", commentHandler::list);

        // Like routes
        app.post("/posts/{post_id}/like", likeHandler::like);
        app.delete("/posts/{post_id}/like", likeHandler::unlike);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            app.stop();
            dbPool.close();
        }));

        app.start(port);
    }
}
