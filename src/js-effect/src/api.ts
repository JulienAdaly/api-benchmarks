import { HttpApi, HttpApiEndpoint, HttpApiGroup } from '@effect/platform';
import { Schema } from 'effect';
import { CommentId, PostId, UserId } from './domain.js';
import {
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  NotFoundError,
  ConflictError,
  PersistenceError,
} from './errors.js';
import { AuthMiddleware } from './auth.js';

const NewUserSchema = Schema.Struct({
  username: Schema.String,
  email: Schema.String,
  password: Schema.String,
});

const UserSchema = Schema.Struct({
  id: UserId,
  username: Schema.String,
  email: Schema.String,
  bio: Schema.OptionFromNullOr(Schema.String),
  createdAt: Schema.Date,
});

const LoginSchema = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
});

const LoginResponseSchema = Schema.Struct({
  accessToken: Schema.String,
});

const NewCommentSchema = Schema.Struct({
  content: Schema.String,
});

const CommentSchema = Schema.Struct({
  id: CommentId,
  authorId: UserId,
  postId: PostId,
  content: Schema.String,
  createdAt: Schema.Date,
});

const UsersQuerySchema = Schema.Struct({
  limit: Schema.NumberFromString.pipe(Schema.optional),
  offset: Schema.NumberFromString.pipe(Schema.optional),
});

const PostsQuerySchema = Schema.Struct({
  limit: Schema.NumberFromString.pipe(Schema.optional),
  offset: Schema.NumberFromString.pipe(Schema.optional),
});

const AuthApiGroup = HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.post('login', '/auth/login')
      .setPayload(LoginSchema)
      .addSuccess(LoginResponseSchema, { status: 200 })
      .addError(UnauthorizedError)
  )
  .add(
    HttpApiEndpoint.get('me', '/auth/me')
      .addSuccess(UserSchema)
      .addError(UnauthorizedError)
      .middleware(AuthMiddleware)
  )
  .addError(PersistenceError);

const UserApiGroup = HttpApiGroup.make('users')
  .add(
    HttpApiEndpoint.post('createUser', '/users')
      .setPayload(NewUserSchema)
      .addSuccess(UserSchema, { status: 201 })
      .addError(BadRequestError)
      .addError(NotFoundError)
      .addError(UnauthorizedError)
      .addError(ForbiddenError)
  )
  .add(
    HttpApiEndpoint.get('getUsers', '/users')
      .addSuccess(Schema.Array(UserSchema))
      .setUrlParams(UsersQuerySchema)
      .addError(UnauthorizedError)
      .addError(ForbiddenError)
  )
  .add(
    HttpApiEndpoint.get('getUser', '/users/:userId')
      .setPath(Schema.Struct({ userId: UserId }))
      .addSuccess(UserSchema)
      .addError(NotFoundError)
      .addError(UnauthorizedError)
      .addError(ForbiddenError)
  )
  .add(
    HttpApiEndpoint.put('updateUser', '/users/:userId')
      .setPath(Schema.Struct({ userId: UserId }))
      .setPayload(
        Schema.Struct({ bio: Schema.OptionFromNullOr(Schema.String) })
      )
      .addSuccess(UserSchema)
      .addError(UnauthorizedError)
      .addError(ForbiddenError)
      .addError(NotFoundError)
  )
  .add(
    HttpApiEndpoint.del('deleteUser', '/users/:userId')
      .setPath(Schema.Struct({ userId: UserId }))
      .addSuccess(Schema.Void, { status: 204 })
      .addError(NotFoundError)
      .addError(UnauthorizedError)
      .addError(ForbiddenError)
  )
  .middleware(AuthMiddleware)
  .addError(PersistenceError);

const NewPostSchema = Schema.Struct({
  content: Schema.String,
});

const PostSchema = Schema.Struct({
  id: PostId,
  authorId: UserId,
  content: Schema.String,
  createdAt: Schema.Date,
});

const PostApiGroup = HttpApiGroup.make('posts')
  .add(
    HttpApiEndpoint.post('createPost', '/posts')
      .setPayload(NewPostSchema)
      .addSuccess(PostSchema, { status: 201 })
      .addError(BadRequestError)
      .addError(UnauthorizedError)
      .middleware(AuthMiddleware)
  )
  .add(
    HttpApiEndpoint.get('getPosts', '/posts')
      .addSuccess(Schema.Array(PostSchema))
      .setUrlParams(PostsQuerySchema)
  )
  .add(
    HttpApiEndpoint.get('getPost', '/posts/:postId')
      .setPath(Schema.Struct({ postId: PostId }))
      .addSuccess(PostSchema)
      .addError(NotFoundError)
  )
  .add(
    HttpApiEndpoint.del('deletePost', '/posts/:postId')
      .addSuccess(Schema.Void, { status: 204 })
      .setPath(Schema.Struct({ postId: PostId }))
      .addError(NotFoundError)
      .addError(ForbiddenError)
      .middleware(AuthMiddleware)
  )
  .addError(PersistenceError);

const CommentApiGroup = HttpApiGroup.make('comments')
  .add(
    HttpApiEndpoint.post('createComment', '/posts/:postId/comments')
      .setPayload(NewCommentSchema)
      .setPath(Schema.Struct({ postId: PostId }))
      .addSuccess(CommentSchema, { status: 201 })
      .addError(BadRequestError)
      .addError(UnauthorizedError)
      .middleware(AuthMiddleware)
  )
  .add(
    HttpApiEndpoint.get('getComments', '/posts/:postId/comments')
      .addSuccess(Schema.Array(CommentSchema))
      .setPath(Schema.Struct({ postId: PostId }))
      .addError(NotFoundError)
  )
  .addError(PersistenceError);

const LikeApiGroup = HttpApiGroup.make('likes')
  .add(
    HttpApiEndpoint.post('likePost', '/posts/:postId/like')
      .addSuccess(Schema.Void, { status: 204 })
      .setPath(Schema.Struct({ postId: PostId }))
      .addError(BadRequestError)
      .addError(ConflictError)
      .addError(UnauthorizedError)
      .middleware(AuthMiddleware)
  )
  .add(
    HttpApiEndpoint.del('unlikePost', '/posts/:postId/like')
      .addSuccess(Schema.Void, { status: 204 })
      .setPath(Schema.Struct({ postId: PostId }))
      .addError(NotFoundError)
      .addError(UnauthorizedError)
      .middleware(AuthMiddleware)
  )
  .addError(PersistenceError);

export const Api = HttpApi.make('Api')
  .add(AuthApiGroup)
  .add(UserApiGroup)
  .add(PostApiGroup)
  .add(CommentApiGroup)
  .add(LikeApiGroup);
