import { HttpApiSchema } from '@effect/platform';
import { SqlError } from '@effect/sql/SqlError';
import { Schema } from 'effect';
import { ParseError } from 'effect/ParseResult';

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>(
  'UnauthorizedError'
)(
  'UnauthorizedError',
  { detail: Schema.String },
  HttpApiSchema.annotations({ status: 401 })
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>(
  'NotFoundError'
)(
  'NotFoundError',
  { detail: Schema.String },
  HttpApiSchema.annotations({ status: 404 })
) {}

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>(
  'ForbiddenError'
)(
  'ForbiddenError',
  { detail: Schema.String },
  HttpApiSchema.annotations({ status: 403 })
) {}

export class BadRequestError extends Schema.TaggedError<BadRequestError>(
  'BadRequestError'
)(
  'BadRequestError',
  { detail: Schema.String },
  HttpApiSchema.annotations({ status: 400 })
) {}

export class ConflictError extends Schema.TaggedError<ConflictError>(
  'ConflictError'
)(
  'ConflictError',
  { detail: Schema.String },
  HttpApiSchema.annotations({ status: 409 })
) {}

export class PersistenceError extends Schema.TaggedError<PersistenceError>(
  'PersistenceError'
)(
  'PersistenceError',
  { detail: Schema.String },
  HttpApiSchema.annotations({ status: 500 })
) {
  static fromSqlOrParseError(error: SqlError | ParseError): PersistenceError {
    return new PersistenceError({ detail: error.message });
  }
  static fromUnknownError(error: unknown): PersistenceError {
    return new PersistenceError({
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
