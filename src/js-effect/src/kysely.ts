import { Config, Effect, Layer, Option, Schema } from 'effect';
import { Kysely, PostgresDialect } from 'kysely';
import { DB } from './kysely_schema.js';
import { DatabaseError, Pool } from 'pg';
import { SqlServiceTag } from './sql.js';
import { ConflictError, PersistenceError } from './errors.js';
import {
  PostId,
  UserId,
  UserSchemaDb,
  PostSchemaDb,
  PostSchemaDbWithLikesCount,
  CommentSchemaDb,
} from './domain.js';

class DatabaseLive extends Effect.Service<DatabaseLive>()('DatabaseLive', {
  scoped: Effect.gen(function* () {
    const connectionString = yield* Config.string('DATABASE_URL');
    // Standardized DB pool configuration (can be overridden via environment variables)
    // Note: pg Pool doesn't support min connections, only max
    const maxConnections = yield* Config.number('DB_POOL_MAX').pipe(
      Config.withDefault(50)
    );
    const idleTimeoutMillis = (yield* Config.number('DB_POOL_IDLE_TIMEOUT').pipe(
      Config.withDefault(300)
    )) * 1000; // Convert seconds to milliseconds
    const connectionTimeoutMillis = (yield* Config.number('DB_POOL_ACQUIRE_TIMEOUT').pipe(
      Config.withDefault(10)
    )) * 1000; // Convert seconds to milliseconds
    const dialect = new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: maxConnections,
        idleTimeoutMillis,
        connectionTimeoutMillis,
      }),
    });
    return yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new Kysely<DB>({
            dialect,
          })
      ),
      db => Effect.sync(() => db.destroy())
    );
  }),
}) {}

export const KyselySqlServiceLive = Layer.effect(
  SqlServiceTag,
  Effect.gen(function* () {
    const db = yield* DatabaseLive;

    const login = (email: string) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('users')
              .where('email', '=', email)
              .select(['id', 'password_hash', 'is_admin'])
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return Option.fromNullable(result);
      });

    const me = (id: UserId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('users')
              .where('id', '=', id)
              .select(['id', 'username', 'email', 'bio', 'created_at'])
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(UserSchemaDb)
        )(result).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

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
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .insertInto('users')
              .values({
                username,
                email,
                password_hash,
                bio: null,
              })
              .returning('id')
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(Schema.OptionFromUndefinedOr(UserId))(
          result?.id
        ).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const getUser = (id: UserId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('users')
              .where('id', '=', id)
              .select(['id', 'username', 'email', 'bio', 'created_at'])
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(UserSchemaDb)
        )(result).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const listUsers = (limit: number, offset: number) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('users')
              .select(['id', 'username', 'email', 'bio', 'created_at'])
              .limit(limit)
              .offset(offset)
              .execute(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(Schema.Array(UserSchemaDb))(
          result
        ).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const updateUser = (id: UserId, bio: string | null) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .updateTable('users')
              .set({ bio })
              .where('id', '=', id)
              .returning(['id', 'username', 'email', 'bio', 'created_at'])
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(UserSchemaDb)
        )(result).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const deleteUser = (id: UserId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => db.deleteFrom('users').where('id', '=', id).execute(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return result.length === 1;
      });

    const createPost = (authorId: UserId, content: string) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .insertInto('posts')
              .values({
                author_id: authorId,
                content,
              })
              .returning(['id', 'author_id', 'content', 'created_at'])
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(PostSchemaDb)
        )(result).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const listPosts = (limit: number, offset: number) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('posts')
              .select([
                'id',
                'author_id',
                'content',
                'created_at',
                'likes_count',
              ])
              .limit(limit)
              .offset(offset)
              .execute(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(
          Schema.Array(PostSchemaDbWithLikesCount)
        )(result).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const getPost = (id: PostId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('posts')
              .where('id', '=', id)
              .select([
                'id',
                'author_id',
                'content',
                'created_at',
                'likes_count',
              ])
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(PostSchemaDbWithLikesCount)
        )(result).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const getPostAuthor = (id: PostId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('posts')
              .where('id', '=', id)
              .select('author_id')
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(Schema.OptionFromUndefinedOr(UserId))(
          result?.author_id
        ).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const deletePost = (id: PostId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => db.deleteFrom('posts').where('id', '=', id).execute(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return result.length === 1;
      });

    const createComment = (authorId: UserId, postId: PostId, content: string) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .insertInto('comments')
              .values({
                author_id: authorId,
                post_id: postId,
                content,
              })
              .returning([
                'id',
                'author_id',
                'post_id',
                'content',
                'created_at',
              ])
              .executeTakeFirst(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(
          Schema.OptionFromUndefinedOr(CommentSchemaDb)
        )(result).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const listComments = (postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('comments')
              .where('post_id', '=', postId)
              .select(['id', 'author_id', 'post_id', 'content', 'created_at'])
              .execute(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return yield* Schema.decodeEither(Schema.Array(CommentSchemaDb))(
          result
        ).pipe(Effect.mapError(PersistenceError.fromSqlOrParseError));
      });

    const likeExists = (userId: UserId, postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom('post_likes')
              .where('user_id', '=', userId)
              .where('post_id', '=', postId)
              .select('user_id')
              .execute(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return result.length > 0;
      });

    const createLike = (userId: UserId, postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .insertInto('post_likes')
              .values({
                user_id: userId,
                post_id: postId,
              })
              .execute(),
          catch: error => {
            if (error instanceof DatabaseError) {
              if (error.code === '23505') {
                return new ConflictError({ detail: 'Post already liked' });
              }
            }
            return PersistenceError.fromUnknownError(error);
          },
        });
        return result.length === 1;
      });

    const deleteLike = (userId: UserId, postId: PostId) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            db
              .deleteFrom('post_likes')
              .where('user_id', '=', userId)
              .where('post_id', '=', postId)
              .execute(),
          catch: error => PersistenceError.fromUnknownError(error),
        });
        return result.length === 1;
      });

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
).pipe(Layer.provide(DatabaseLive.Default));
