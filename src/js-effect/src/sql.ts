import { Context, Effect, Option, Schema } from 'effect';
import {
  PostId,
  UserId,
  UserSchemaDb,
  CommentSchemaDb,
  PostSchemaDb,
  PostSchemaDbWithLikesCount,
} from './domain.js';
import { ConflictError, PersistenceError } from './errors.js';

export interface SqlService {
  login: (email: string) => Effect.Effect<
    Option.Option<{
      readonly id: string;
      readonly password_hash: string;
      readonly is_admin: boolean;
    }>,
    PersistenceError,
    never
  >;
  me: (
    id: UserId
  ) => Effect.Effect<
    Option.Option<Schema.Schema.Type<typeof UserSchemaDb>>,
    PersistenceError,
    never
  >;
  createUser: (user: {
    readonly username: string;
    readonly email: string;
    readonly password_hash: string;
  }) => Effect.Effect<Option.Option<UserId>, PersistenceError, never>;
  getUser: (
    id: UserId
  ) => Effect.Effect<
    Option.Option<Schema.Schema.Type<typeof UserSchemaDb>>,
    PersistenceError,
    never
  >;
  listUsers: (
    limit: number,
    offset: number
  ) => Effect.Effect<
    readonly Schema.Schema.Type<typeof UserSchemaDb>[],
    PersistenceError,
    never
  >;
  updateUser: (
    id: UserId,
    bio: string | null
  ) => Effect.Effect<
    Option.Option<Schema.Schema.Type<typeof UserSchemaDb>>,
    PersistenceError,
    never
  >;
  deleteUser: (id: UserId) => Effect.Effect<boolean, PersistenceError, never>;
  createPost: (
    authorId: UserId,
    content: string
  ) => Effect.Effect<
    Option.Option<Schema.Schema.Type<typeof PostSchemaDb>>,
    PersistenceError,
    never
  >;
  listPosts: (
    limit: number,
    offset: number
  ) => Effect.Effect<
    readonly Schema.Schema.Type<typeof PostSchemaDbWithLikesCount>[],
    PersistenceError,
    never
  >;
  getPost: (
    id: PostId
  ) => Effect.Effect<
    Option.Option<Schema.Schema.Type<typeof PostSchemaDbWithLikesCount>>,
    PersistenceError,
    never
  >;
  getPostAuthor: (
    id: PostId
  ) => Effect.Effect<Option.Option<UserId>, PersistenceError, never>;
  deletePost: (id: PostId) => Effect.Effect<boolean, PersistenceError, never>;
  createComment: (
    authorId: UserId,
    postId: PostId,
    content: string
  ) => Effect.Effect<
    Option.Option<Schema.Schema.Type<typeof CommentSchemaDb>>,
    PersistenceError,
    never
  >;
  listComments: (
    postId: PostId
  ) => Effect.Effect<
    readonly Schema.Schema.Type<typeof CommentSchemaDb>[],
    PersistenceError,
    never
  >;
  likeExists: (
    userId: UserId,
    postId: PostId
  ) => Effect.Effect<boolean, PersistenceError, never>;
  createLike: (
    userId: UserId,
    postId: PostId
  ) => Effect.Effect<boolean, PersistenceError | ConflictError, never>;
  deleteLike: (
    userId: UserId,
    postId: PostId
  ) => Effect.Effect<boolean, PersistenceError, never>;
}

export class SqlServiceTag extends Context.Tag('SqlServiceTag')<
  SqlServiceTag,
  SqlService
>() {}
