package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/pprof"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

var (
	DATABASE_URL       = os.Getenv("DATABASE_URL")
	JWT_SECRET         = os.Getenv("JWT_SECRET")
	JWT_EXPIRE_MINUTES = getenvInt("JWT_EXPIRE_MINUTES", 60)
)

func getenvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return i
}

func loadSQL(relative string) (string, error) {
	if base := os.Getenv("QUERIES_DIR"); base != "" {
		b, err := os.ReadFile(filepath.Join(base, relative))
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	cwd, _ := os.Getwd()
	repoRoot := filepath.Clean(filepath.Join(cwd, "..", ".."))
	path := filepath.Join(repoRoot, "database", "queries", relative)
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("SQL file not found: %s", path)
	}
	return string(b), nil
}

var (
	SQL_LOGIN          string
	SQL_ME             string
	SQL_CREATE_USER    string
	SQL_GET_USER       string
	SQL_LIST_USERS     string
	SQL_UPDATE_USER    string
	SQL_DELETE_USER    string
	SQL_CREATE_POST    string
	SQL_LIST_POSTS     string
	SQL_GET_POST       string
	SQL_GET_POST_AUTH  string
	SQL_DELETE_POST    string
	SQL_CREATE_COMMENT string
	SQL_LIST_COMMENTS  string
	SQL_LIKE_EXISTS    string
	SQL_CREATE_LIKE    string
	SQL_DELETE_LIKE    string
)

func mustLoadSQL() {
	var err error
	if SQL_LOGIN, err = loadSQL("auth/login.sql"); err != nil {
		panic(err)
	}
	if SQL_ME, err = loadSQL("auth/me.sql"); err != nil {
		panic(err)
	}
	if SQL_CREATE_USER, err = loadSQL("users/create.sql"); err != nil {
		panic(err)
	}
	if SQL_GET_USER, err = loadSQL("users/get.sql"); err != nil {
		panic(err)
	}
	if SQL_LIST_USERS, err = loadSQL("users/list.sql"); err != nil {
		panic(err)
	}
	if SQL_UPDATE_USER, err = loadSQL("users/update.sql"); err != nil {
		panic(err)
	}
	if SQL_DELETE_USER, err = loadSQL("users/delete.sql"); err != nil {
		panic(err)
	}
	if SQL_CREATE_POST, err = loadSQL("posts/create.sql"); err != nil {
		panic(err)
	}
	if SQL_LIST_POSTS, err = loadSQL("posts/list.sql"); err != nil {
		panic(err)
	}
	if SQL_GET_POST, err = loadSQL("posts/get.sql"); err != nil {
		panic(err)
	}
	if SQL_GET_POST_AUTH, err = loadSQL("posts/get_author.sql"); err != nil {
		panic(err)
	}
	if SQL_DELETE_POST, err = loadSQL("posts/delete.sql"); err != nil {
		panic(err)
	}
	if SQL_CREATE_COMMENT, err = loadSQL("comments/create.sql"); err != nil {
		panic(err)
	}
	if SQL_LIST_COMMENTS, err = loadSQL("comments/list.sql"); err != nil {
		panic(err)
	}
	if SQL_LIKE_EXISTS, err = loadSQL("likes/exists.sql"); err != nil {
		panic(err)
	}
	if SQL_CREATE_LIKE, err = loadSQL("likes/create.sql"); err != nil {
		panic(err)
	}
	if SQL_DELETE_LIKE, err = loadSQL("likes/delete.sql"); err != nil {
		panic(err)
	}
}

type LoginCredentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type CreateUser struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type UpdateUser struct {
	Bio *string `json:"bio"`
}

type PostCreate struct {
	Content string `json:"content"`
}

type CommentCreate struct {
	Content string `json:"content"`
}

func getTokenFromHeader(c *fiber.Ctx) (string, error) {
	auth := c.Get("Authorization")
	if auth == "" {
		return "", fiber.ErrUnauthorized
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 {
		return "", fiber.ErrUnauthorized
	}
	return parts[1], nil
}

func decodeToken(tokenStr string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		return []byte(JWT_SECRET), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !token.Valid {
		return nil, fiber.ErrUnauthorized
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fiber.ErrUnauthorized
	}
	return claims, nil
}

func requireAdmin(claims jwt.MapClaims) error {
	if v, ok := claims["is_admin"]; ok {
		if b, ok2 := v.(bool); ok2 && b {
			return nil
		}
	}
	return fiber.ErrForbidden
}

func shapeUserRow(row pgx.Row) (map[string]any, error) {
	var id any
	var username, email string
	var bio *string
	var createdAt time.Time
	if err := row.Scan(&id, &username, &email, &bio, &createdAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":        uuidToString(id),
		"username":  username,
		"email":     email,
		"bio":       bio,
		"createdAt": createdAt,
	}, nil
}

func shapePostRow(row pgx.Row) (map[string]any, error) {
	var idVal, authorVal any
	var content string
	var createdAt time.Time
	var likeCount int32
	if err := row.Scan(&idVal, &authorVal, &content, &createdAt, &likeCount); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":        uuidToString(idVal),
		"authorId":  uuidToString(authorVal),
		"content":   content,
		"likeCount": int(likeCount),
		"createdAt": createdAt,
	}, nil
}

func shapeCommentRow(row pgx.Row) (map[string]any, error) {
	var idVal, authorVal, postVal any
	var content string
	var createdAt time.Time
	if err := row.Scan(&idVal, &authorVal, &postVal, &content, &createdAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":        uuidToString(idVal),
		"authorId":  uuidToString(authorVal),
		"post_id":   uuidToString(postVal),
		"content":   content,
		"createdAt": createdAt,
	}, nil
}

// uuidToString converts various pgx-decoded UUID forms into a canonical string.
func uuidToString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		if len(t) == 16 {
			return uuidFrom16Bytes(t)
		}
		return string(t)
	case [16]byte:
		return uuidFrom16Bytes(t[:])
	default:
		return fmt.Sprint(v)
	}
}

func uuidFrom16Bytes(b []byte) string {
	// 8-4-4-4-12 hex format
	dst := make([]byte, 36)
	hex.Encode(dst[0:8], b[0:4])
	dst[8] = '-'
	hex.Encode(dst[9:13], b[4:6])
	dst[13] = '-'
	hex.Encode(dst[14:18], b[6:8])
	dst[18] = '-'
	hex.Encode(dst[19:23], b[8:10])
	dst[23] = '-'
	hex.Encode(dst[24:36], b[10:16])
	return string(dst)
}

func main() {
	// Enable CPU profiling if requested
	if os.Getenv("CPU_PROFILE") != "" {
		f, err := os.Create(os.Getenv("CPU_PROFILE"))
		if err != nil {
			log.Fatalf("could not create CPU profile: %v", err)
		}
		defer f.Close()
		if err := pprof.StartCPUProfile(f); err != nil {
			log.Fatalf("could not start CPU profile: %v", err)
		}
		defer pprof.StopCPUProfile()
	}

	if DATABASE_URL == "" || JWT_SECRET == "" {
		log.Fatal("DATABASE_URL and JWT_SECRET must be set")
	}
	mustLoadSQL()

	config, err := pgxpool.ParseConfig(DATABASE_URL)
	if err != nil {
		log.Fatalf("failed to parse db config: %v", err)
	}
	config.MaxConns = 50
	config.MinConns = 10
	config.MaxConnIdleTime = 300 * time.Second
	config.MaxConnLifetime = 1800 * time.Second

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		log.Fatalf("failed to create db pool: %v", err)
	}
	defer pool.Close()

	app := fiber.New(fiber.Config{DisableStartupMessage: true})

	app.Post("/auth/login", func(c *fiber.Ctx) error {
		var body LoginCredentials
		if err := c.BodyParser(&body); err != nil {
			return fiber.NewError(http.StatusBadRequest, "Invalid body")
		}
		ctx := c.Context()
		// Cast id to text to ensure we always get a UUID string
		row := pool.QueryRow(ctx, "SELECT id::text, password_hash, is_admin FROM users WHERE email = $1", body.Email)
		var idStr string
		var passwordHash string
		var isAdmin bool
		if err := row.Scan(&idStr, &passwordHash, &isAdmin); err != nil {
			return fiber.NewError(http.StatusUnauthorized, "Invalid credentials")
		}
		if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)) != nil {
			return fiber.NewError(http.StatusUnauthorized, "Invalid credentials")
		}
		claims := jwt.MapClaims{
			"sub":      idStr,
			"is_admin": isAdmin,
			"exp":      time.Now().Add(time.Duration(JWT_EXPIRE_MINUTES) * time.Minute).Unix(),
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		signed, err := token.SignedString([]byte(JWT_SECRET))
		if err != nil {
			return fiber.NewError(http.StatusInternalServerError, "Token error")
		}
		return c.JSON(fiber.Map{"accessToken": signed})
	})

	app.Get("/auth/me", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		ctx := c.Context()
		id := fmt.Sprint(claims["sub"])
		row := pool.QueryRow(ctx, SQL_ME, id)
		user, err := shapeUserRow(row)
		if err != nil {
			return fiber.NewError(http.StatusUnauthorized, "Unauthorized")
		}
		return c.JSON(user)
	})

	app.Post("/users", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		if err := requireAdmin(claims); err != nil {
			return err
		}

		var body CreateUser
		if err := c.BodyParser(&body); err != nil {
			return fiber.NewError(http.StatusBadRequest, "Invalid body")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		if err != nil {
			return fiber.NewError(http.StatusInternalServerError, "Hash error")
		}
		ctx := c.Context()
		var newID any
		if err := pool.QueryRow(ctx, SQL_CREATE_USER, body.Username, body.Email, string(hash), nil).Scan(&newID); err != nil {
			return fiber.NewError(http.StatusBadRequest, "Failed to create user")
		}
		row := pool.QueryRow(ctx, SQL_GET_USER, newID)
		user, err := shapeUserRow(row)
		if err != nil {
			return fiber.NewError(http.StatusNotFound, "User not found")
		}
		return c.Status(http.StatusCreated).JSON(user)
	})

	app.Get("/users", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		if err := requireAdmin(claims); err != nil {
			return err
		}

		limit, _ := strconv.Atoi(c.Query("limit", "20"))
		offset, _ := strconv.Atoi(c.Query("offset", "0"))
		ctx := c.Context()
		rows, err := pool.Query(ctx, SQL_LIST_USERS, limit, offset)
		if err != nil {
			return fiber.NewError(http.StatusInternalServerError, "Query error")
		}
		defer rows.Close()
		list := make([]map[string]any, 0)
		for rows.Next() {
			user, err := shapeUserRow(rows)
			if err != nil {
				return fiber.NewError(http.StatusInternalServerError, "Scan error")
			}
			list = append(list, user)
		}
		return c.JSON(list)
	})

	app.Put("/users/:user_id", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		if err := requireAdmin(claims); err != nil {
			return err
		}

		userID := c.Params("user_id")
		var body UpdateUser
		if err := c.BodyParser(&body); err != nil {
			return fiber.NewError(http.StatusBadRequest, "Invalid body")
		}
		ctx := c.Context()
		row := pool.QueryRow(ctx, SQL_UPDATE_USER, userID, body.Bio)
		user, err := shapeUserRow(row)
		if err != nil {
			return fiber.NewError(http.StatusNotFound, "User not found")
		}
		return c.JSON(user)
	})

	app.Delete("/users/:user_id", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		if err := requireAdmin(claims); err != nil {
			return err
		}

		userID := c.Params("user_id")
		ctx := c.Context()
		cmd, err := pool.Exec(ctx, SQL_DELETE_USER, userID)
		if err != nil || cmd.RowsAffected() != 1 {
			return fiber.NewError(http.StatusNotFound, "User not found")
		}
		return c.SendStatus(http.StatusNoContent)
	})

	app.Post("/posts", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}

		var body PostCreate
		if err := c.BodyParser(&body); err != nil {
			return fiber.NewError(http.StatusBadRequest, "Invalid body")
		}
		userID := fmt.Sprint(claims["sub"])
		ctx := c.Context()
		row := pool.QueryRow(ctx, SQL_CREATE_POST, userID, body.Content)
		var idVal, authorVal any
		var content string
		var createdAt time.Time
		if err := row.Scan(&idVal, &authorVal, &content, &createdAt); err != nil {
			return fiber.NewError(http.StatusBadRequest, "Failed to create post")
		}
		return c.Status(http.StatusCreated).JSON(fiber.Map{
			"id":        uuidToString(idVal),
			"authorId":  uuidToString(authorVal),
			"content":   content,
			"createdAt": createdAt,
			"likeCount": 0,
		})
	})

	app.Get("/posts", func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit", "20"))
		offset, _ := strconv.Atoi(c.Query("offset", "0"))
		ctx := c.Context()
		rows, err := pool.Query(ctx, SQL_LIST_POSTS, limit, offset)
		if err != nil {
			return fiber.NewError(http.StatusInternalServerError, "Query error")
		}
		defer rows.Close()
		list := make([]map[string]any, 0)
		for rows.Next() {
			post, err := shapePostRow(rows)
			if err != nil {
				return fiber.NewError(http.StatusInternalServerError, "Scan error")
			}
			list = append(list, post)
		}
		return c.JSON(list)
	})

	app.Get("/posts/:post_id", func(c *fiber.Ctx) error {
		postID := c.Params("post_id")
		ctx := c.Context()
		row := pool.QueryRow(ctx, SQL_GET_POST, postID)
		post, err := shapePostRow(row)
		if err != nil {
			return fiber.NewError(http.StatusNotFound, "Post not found")
		}
		return c.JSON(post)
	})

	app.Delete("/posts/:post_id", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}

		postID := c.Params("post_id")
		ctx := c.Context()
		var authorID any
		if err := pool.QueryRow(ctx, SQL_GET_POST_AUTH, postID).Scan(&authorID); err != nil {
			return fiber.NewError(http.StatusNotFound, "Post not found")
		}
		if uuidToString(authorID) != fmt.Sprint(claims["sub"]) {
			if err := requireAdmin(claims); err != nil {
				return err
			}
		}
		if _, err := pool.Exec(ctx, SQL_DELETE_POST, postID); err != nil {
			return fiber.NewError(http.StatusNotFound, "Post not found")
		}
		return c.SendStatus(http.StatusNoContent)
	})

	app.Post("/posts/:post_id/comments", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		postID := c.Params("post_id")
		ctx := c.Context()
		// Ensure post exists
		var one int
		if err := pool.QueryRow(ctx, "SELECT 1 FROM posts WHERE id = $1", postID).Scan(&one); err != nil {
			return fiber.NewError(http.StatusNotFound, "Post not found")
		}
		var body CommentCreate
		if err := c.BodyParser(&body); err != nil {
			return fiber.NewError(http.StatusBadRequest, "Invalid body")
		}
		row := pool.QueryRow(ctx, SQL_CREATE_COMMENT, fmt.Sprint(claims["sub"]), postID, body.Content)
		comment, err := shapeCommentRow(row)
		if err != nil {
			return fiber.NewError(http.StatusBadRequest, "Failed to create comment")
		}
		return c.Status(http.StatusCreated).JSON(comment)
	})

	app.Get("/posts/:post_id/comments", func(c *fiber.Ctx) error {
		postID := c.Params("post_id")
		ctx := c.Context()
		// Ensure post exists
		var one int
		if err := pool.QueryRow(ctx, "SELECT 1 FROM posts WHERE id = $1", postID).Scan(&one); err != nil {
			return fiber.NewError(http.StatusNotFound, "Post not found")
		}
		rows, err := pool.Query(ctx, SQL_LIST_COMMENTS, postID)
		if err != nil {
			return fiber.NewError(http.StatusInternalServerError, "Query error")
		}
		defer rows.Close()
		list := make([]map[string]any, 0)
		for rows.Next() {
			comment, err := shapeCommentRow(rows)
			if err != nil {
				return fiber.NewError(http.StatusInternalServerError, "Scan error")
			}
			list = append(list, comment)
		}
		return c.JSON(list)
	})

	app.Post("/posts/:post_id/like", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		postID := c.Params("post_id")
		ctx := c.Context()
		// Ensure post exists
		var one int
		if err := pool.QueryRow(ctx, "SELECT 1 FROM posts WHERE id = $1", postID).Scan(&one); err != nil {
			return fiber.NewError(http.StatusNotFound, "Post not found")
		}
		var exists int
		if err := pool.QueryRow(ctx, SQL_LIKE_EXISTS, fmt.Sprint(claims["sub"]), postID).Scan(&exists); err == nil {
			return fiber.NewError(http.StatusConflict, "Post already liked")
		}
		if _, err := pool.Exec(ctx, SQL_CREATE_LIKE, fmt.Sprint(claims["sub"]), postID); err != nil {
			return fiber.NewError(http.StatusInternalServerError, "Failed to like")
		}
		return c.SendStatus(http.StatusNoContent)
	})

	app.Delete("/posts/:post_id/like", func(c *fiber.Ctx) error {
		tok, err := getTokenFromHeader(c)
		if err != nil {
			return err
		}
		claims, err := decodeToken(tok)
		if err != nil {
			return err
		}
		postID := c.Params("post_id")
		ctx := c.Context()
		// Ensure post exists
		var one int
		if err := pool.QueryRow(ctx, "SELECT 1 FROM posts WHERE id = $1", postID).Scan(&one); err != nil {
			return fiber.NewError(http.StatusNotFound, "Post not found")
		}
		cmd, err := pool.Exec(ctx, SQL_DELETE_LIKE, fmt.Sprint(claims["sub"]), postID)
		if err != nil || cmd.RowsAffected() != 1 {
			return fiber.NewError(http.StatusNotFound, "Post or like not found")
		}
		return c.SendStatus(http.StatusNoContent)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port

	// Create a channel to listen for interrupts
	graceful := make(chan os.Signal, 1)
	signal.Notify(graceful, os.Interrupt, syscall.SIGTERM)

	// Start server in a goroutine
	go func() {
		if err := app.Listen(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	<-graceful
	log.Println("Shutting down gracefully...")

	// Gracefully shutdown the server
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := app.ShutdownWithContext(ctx); err != nil {
		log.Printf("Shutdown error: %v", err)
	}

	log.Println("Server stopped")
}
