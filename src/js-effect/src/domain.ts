import { Schema } from 'effect';

export const UserId = Schema.UUID.pipe(Schema.brand('UserId'));
export type UserId = Schema.Schema.Type<typeof UserId>;

export const PostId = Schema.UUID.pipe(Schema.brand('PostId'));
export type PostId = Schema.Schema.Type<typeof PostId>;

export const CommentId = Schema.UUID.pipe(Schema.brand('CommentId'));
export type CommentId = Schema.Schema.Type<typeof CommentId>;

export const UserSchemaDb = Schema.Struct({
  id: UserId,
  username: Schema.String,
  email: Schema.String,
  bio: Schema.OptionFromNullOr(Schema.String),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(
    Schema.fromKey('created_at')
  ),
});

export const PostSchemaDb = Schema.Struct({
  id: PostId,
  authorId: Schema.propertySignature(UserId).pipe(Schema.fromKey('author_id')),
  content: Schema.String,
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(
    Schema.fromKey('created_at')
  ),
});

export const PostSchemaDbWithLikesCount = PostSchemaDb.pipe(
  Schema.extend(
    Schema.Struct({
      likesCount: Schema.propertySignature(Schema.Number).pipe(
        Schema.fromKey('likes_count')
      ),
    })
  )
);

export const CommentSchemaDb = Schema.Struct({
  id: CommentId,
  authorId: Schema.propertySignature(UserId).pipe(Schema.fromKey('author_id')),
  postId: Schema.propertySignature(PostId).pipe(Schema.fromKey('post_id')),
  content: Schema.String,
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(
    Schema.fromKey('created_at')
  ),
});
