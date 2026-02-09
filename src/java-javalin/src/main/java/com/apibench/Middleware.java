package com.apibench;

import io.javalin.http.Context;
import io.javalin.http.HttpStatus;
import io.jsonwebtoken.Claims;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;

public final class Middleware {

  public static Claims requireAuth(Context ctx, JwtUtil jwt) {
    String auth = ctx.header("Authorization");
    if (auth == null || !auth.startsWith("Bearer ")) {
      ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", "Unauthorized"));
      return null;
    }
    String token = auth.substring(7);
    try {
      return jwt.verify(token);
    } catch (Exception e) {
      ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", "Unauthorized"));
      return null;
    }
  }

  public static boolean requireAdmin(Context ctx, Claims claims) {
    Object isAdmin = claims.get("is_admin");
    if (isAdmin instanceof Boolean b && b) {
      return true;
    }
    ctx.status(HttpStatus.FORBIDDEN).json(Map.of("error", "Forbidden"));
    return false;
  }

  public static Map<String, Object> shapeUser(ResultSet rs)
    throws SQLException {
    var map = new LinkedHashMap<String, Object>();
    map.put("id", rs.getObject("id").toString());
    map.put("username", rs.getString("username"));
    map.put("email", rs.getString("email"));
    map.put("bio", rs.getString("bio"));
    map.put("createdAt", rs.getTimestamp("created_at").toInstant());
    return map;
  }

  public static Map<String, Object> shapePost(ResultSet rs)
    throws SQLException {
    var map = new LinkedHashMap<String, Object>();
    map.put("id", rs.getObject("id").toString());
    map.put("authorId", rs.getObject("author_id").toString());
    map.put("content", rs.getString("content"));
    map.put("likeCount", rs.getInt("like_count"));
    map.put("createdAt", rs.getTimestamp("created_at").toInstant());
    return map;
  }

  public static Map<String, Object> shapeComment(ResultSet rs)
    throws SQLException {
    var map = new LinkedHashMap<String, Object>();
    map.put("id", rs.getObject("id").toString());
    map.put("authorId", rs.getObject("author_id").toString());
    map.put("post_id", rs.getObject("post_id").toString());
    map.put("content", rs.getString("content"));
    map.put("createdAt", rs.getTimestamp("created_at").toInstant());
    return map;
  }
}
