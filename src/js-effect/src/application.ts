import { HttpApiBuilder } from '@effect/platform';
import { Api } from './api.js';
import { Effect, Either, Layer, Option } from 'effect';
import { SqlServiceTag } from './sql.js';
import { AuthService, CurrentSession } from './auth.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from './errors.js';
import { UserId } from './domain.js';
import { verifyPassword, hashPassword } from './password.js';

const AuthApiLive = HttpApiBuilder.group(Api, 'auth', handlers =>
  handlers
    .handle('login', ({ payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const credentials = yield* sql
          .login(payload.email)
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new UnauthorizedError({ detail: 'Unauthorized' })
              )
            )
          );
        const check = yield* verifyPassword(
          payload.password,
          credentials.password_hash
        );
        if (!check) {
          return yield* new UnauthorizedError({ detail: 'Unauthorized' });
        }
        const token = yield* AuthService.signToken({
          userId: UserId.make(credentials.id),
          role: credentials.is_admin ? 'admin' : 'user',
        });
        return { accessToken: token };
      })
    )
    .handle('me', () =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        const result = yield* sql
          .me(session.userId)
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new UnauthorizedError({ detail: 'Unauthorized' })
              )
            )
          );
        return result;
      })
    )
);

const UserApiLive = HttpApiBuilder.group(Api, 'users', handlers =>
  handlers
    .handle('createUser', ({ payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        if (session.role !== 'admin') {
          return yield* new ForbiddenError({ detail: 'Forbidden' });
        }
        const hash = yield* hashPassword(payload.password);
        const userId = yield* sql
          .createUser({
            username: payload.username,
            email: payload.email,
            password_hash: hash,
          })
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new BadRequestError({ detail: 'Failed to create user' })
              )
            )
          );
        const user = yield* sql
          .getUser(userId)
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new NotFoundError({ detail: 'User not found' })
              )
            )
          );
        return user;
      })
    )
    .handle('getUsers', ({ urlParams }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        if (session.role !== 'admin') {
          return yield* new ForbiddenError({ detail: 'Forbidden' });
        }
        const users = yield* sql.listUsers(
          urlParams.limit ?? 20,
          urlParams.offset ?? 0
        );
        return users;
      })
    )
    .handle('getUser', ({ path }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        if (session.role !== 'admin') {
          return yield* new ForbiddenError({ detail: 'Forbidden' });
        }
        const user = yield* sql
          .getUser(path.userId)
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new NotFoundError({ detail: 'User not found' })
              )
            )
          );
        return user;
      })
    )
    .handle('updateUser', ({ path, payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        if (session.role !== 'admin') {
          return yield* new ForbiddenError({ detail: 'Forbidden' });
        }
        const user = yield* sql
          .updateUser(path.userId, Option.getOrNull(payload.bio))
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new NotFoundError({ detail: 'User not found' })
              )
            )
          );
        return user;
      })
    )
    .handle('deleteUser', ({ path }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        if (session.role !== 'admin') {
          return yield* new ForbiddenError({ detail: 'Forbidden' });
        }
        const result = yield* sql.deleteUser(path.userId);
        if (!result) {
          return yield* new NotFoundError({ detail: 'User not found' });
        }
      })
    )
);

const PostApiLive = HttpApiBuilder.group(Api, 'posts', handlers =>
  handlers
    .handle('createPost', ({ payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        const post = yield* sql
          .createPost(session.userId, payload.content)
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new BadRequestError({ detail: 'Failed to create post' })
              )
            )
          );
        return post;
      })
    )
    .handle('getPosts', ({ urlParams }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const posts = yield* sql.listPosts(
          urlParams.limit ?? 20,
          urlParams.offset ?? 0
        );
        return posts;
      })
    )
    .handle('getPost', ({ path }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const post = yield* sql
          .getPost(path.postId)
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () => new NotFoundError({ detail: 'Post not found' })
              )
            )
          );
        return post;
      })
    )
    .handle('deletePost', ({ path }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const result = yield* sql.deletePost(path.postId);
        if (!result) {
          return yield* new NotFoundError({ detail: 'Post not found' });
        }
      })
    )
);

const CommentApiLive = HttpApiBuilder.group(Api, 'comments', handlers =>
  handlers
    .handle('createComment', ({ path, payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        const comment = yield* sql
          .createComment(session.userId, path.postId, payload.content)
          .pipe(
            Effect.flatMap(
              Either.fromOption(
                () =>
                  new BadRequestError({ detail: 'Failed to create comment' })
              )
            )
          );
        return comment;
      })
    )
    .handle('getComments', ({ path }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const comments = yield* sql.listComments(path.postId);
        return comments;
      })
    )
);

const LikeApiLive = HttpApiBuilder.group(Api, 'likes', handlers =>
  handlers
    .handle('likePost', ({ path }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        const result = yield* sql.createLike(session.userId, path.postId);
        if (!result) {
          return yield* new BadRequestError({ detail: 'Failed to like post' });
        }
      })
    )
    .handle('unlikePost', ({ path }) =>
      Effect.gen(function* () {
        const sql = yield* SqlServiceTag;
        const session = yield* CurrentSession;
        const result = yield* sql.deleteLike(session.userId, path.postId);
        if (!result) {
          return yield* new NotFoundError({ detail: 'Like not found' });
        }
      })
    )
);

export const ApplicationLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(
    Layer.mergeAll(
      AuthApiLive,
      UserApiLive,
      PostApiLive,
      CommentApiLive,
      LikeApiLive
    )
  )
);
