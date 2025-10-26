import { Config, Effect, Layer, Option, Schema } from 'effect';
import { FileSystem, Path } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import {
  PostId,
  UserId,
  UserSchemaDb,
  PostSchemaDb,
  PostSchemaDbWithLikesCount,
  CommentSchemaDb,
} from './domain.js';
import { PersistenceError } from './errors.js';
import { SqlServiceTag } from './sql.js';
import { PgClient } from '@effect/sql-pg';

const PostgresLive = PgClient.layerConfig({
  url: Config.redacted('DATABASE_URL'),
  maxConnections: Config.number('DB_POOL_MAX').pipe(Config.withDefault(10)),
});

const loadSql = (relativePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDirEnv = yield* Config.string('QUERIES_DIR').pipe(Config.option);
    const queriesPath = path.join(
      import.meta.dirname,
      '../../../database/queries'
    );
    const baseDir = Option.getOrElse(baseDirEnv, () => queriesPath);
    const sqlPath = path.join(baseDir, relativePath);
    return yield* fileSystem.readFileString(sqlPath);
  });

export const PostgresSqlServiceLive = Layer.effect(
  SqlServiceTag,
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;

    const loginSql = yield* loadSql('auth/login.sql');
    const login = (email: string) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly password_hash: string;
          readonly is_admin: boolean;
        }>(loginSql, [email]);
        return Option.fromNullable(result[0]);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const meSql = yield* loadSql('auth/me.sql');
    const me = (id: UserId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly username: string;
          readonly email: string;
          readonly bio: string | null;
          readonly created_at: Date;
        }>(meSql, [id]);
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(UserSchemaDb)
        )(result[0]);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const createUserSql = yield* loadSql('users/create.sql');
    const createUser = ({
      username,
      email,
      password_hash,
    }: {
      readonly username: string;
      readonly email: string;
      readonly password_hash: string;
    }) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
        }>(createUserSql, [username, email, password_hash, null]);
        return yield* Schema.decodeEither(Schema.OptionFromUndefinedOr(UserId))(
          result[0]?.id
        );
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const getUserSql = yield* loadSql('users/get.sql');
    const getUser = (id: UserId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly username: string;
          readonly email: string;
          readonly bio: string | null;
          readonly created_at: Date;
        }>(getUserSql, [id]);
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(UserSchemaDb)
        )(result[0]);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const listUsersSql = yield* loadSql('users/list.sql');
    const listUsers = (limit: number, offset: number) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly username: string;
          readonly email: string;
          readonly bio: string | null;
          readonly created_at: Date;
        }>(listUsersSql, [limit, offset]);
        return yield* Schema.decodeEither(Schema.Array(UserSchemaDb))(result);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const updateUserSql = yield* loadSql('users/update.sql');
    const updateUser = (id: UserId, bio: string | null) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly username: string;
          readonly email: string;
          readonly bio: string | null;
          readonly created_at: Date;
        }>(updateUserSql, [id, bio]);
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(UserSchemaDb)
        )(result[0]);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const deleteUserSql = yield* loadSql('users/delete.sql');
    const deleteUser = (id: UserId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe(deleteUserSql, [id]);
        return result.length === 1;
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const createPostSql = yield* loadSql('posts/create.sql');
    const createPost = (authorId: UserId, content: string) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly author_id: string;
          readonly content: string;
          readonly created_at: Date;
        }>(createPostSql, [authorId, content]);
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(PostSchemaDb)
        )(result[0]);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const listPostsSql = yield* loadSql('posts/list.sql');
    const listPosts = (limit: number, offset: number) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly author_id: string;
          readonly content: string;
          readonly created_at: Date;
          readonly likes_count: number;
        }>(listPostsSql, [limit, offset]);
        return yield* Schema.decodeEither(
          Schema.Array(PostSchemaDbWithLikesCount)
        )(result);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const getPostSql = yield* loadSql('posts/get.sql');
    const getPost = (id: PostId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly author_id: string;
          readonly content: string;
          readonly created_at: Date;
          readonly likes_count: number;
        }>(getPostSql, [id]);
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(PostSchemaDbWithLikesCount)
        )(result[0]);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const getPostAuthorSql = yield* loadSql('posts/get_author.sql');
    const getPostAuthor = (id: PostId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly author_id: string;
        }>(getPostAuthorSql, [id]);
        return yield* Schema.decodeEither(Schema.OptionFromUndefinedOr(UserId))(
          result[0]?.author_id
        );
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const deletePostSql = yield* loadSql('posts/delete.sql');
    const deletePost = (id: PostId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe(deletePostSql, [id]);
        return result.length === 1;
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    // Comment queries
    const createCommentSql = yield* loadSql('comments/create.sql');
    const createComment = (authorId: UserId, postId: PostId, content: string) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly author_id: string;
          readonly post_id: string;
          readonly content: string;
          readonly created_at: Date;
        }>(createCommentSql, [authorId, postId, content]);
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(CommentSchemaDb)
        )(result[0]);
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const listCommentsSql = yield* loadSql('comments/list.sql');
    const listComments = (postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe<{
          readonly id: string;
          readonly author_id: string;
          readonly post_id: string;
          readonly content: string;
          readonly created_at: Date;
        }>(listCommentsSql, [postId]);
        return yield* Schema.decodeEither(Schema.Array(CommentSchemaDb))(
          result
        );
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const likeExistsSql = yield* loadSql('likes/exists.sql');
    const likeExists = (userId: UserId, postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe(likeExistsSql, [userId, postId]);
        return result.length > 0;
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const createLikeSql = yield* loadSql('likes/create.sql');
    const createLike = (userId: UserId, postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe(createLikeSql, [userId, postId]);
        return result.length === 1;
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    const deleteLikeSql = yield* loadSql('likes/delete.sql');
    const deleteLike = (userId: UserId, postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* client.unsafe(deleteLikeSql, [userId, postId]);
        return result.length === 1;
      }).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));

    return {
      login,
      me,
      createUser,
      getUser,
      listUsers,
      updateUser,
      deleteUser,
      createPost,
      listPosts,
      getPost,
      getPostAuthor,
      deletePost,
      createComment,
      listComments,
      likeExists,
      createLike,
      deleteLike,
    } as const;
  })
).pipe(Layer.provide(PostgresLive));
