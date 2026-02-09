// Password utility that works with both Bun and Node.js
import { Effect } from 'effect';
import { InternalServerError } from './errors.js';

const catchError = (e: unknown) => InternalServerError.fromError(e);

const impl: {
  verify: (password: string, hash: string) => Promise<boolean>;
  hash: (password: string) => Promise<string>;
} =
  typeof Bun !== 'undefined'
    ? {
        verify: (password, hash) =>
          Bun.password.verify(password, hash, 'bcrypt'),
        hash: password => Bun.password.hash(password, { algorithm: 'bcrypt' }),
      }
    : await import('bcryptjs').then(bcrypt => ({
        verify: (password, hash) => bcrypt.compare(password, hash),
        hash: password => bcrypt.hash(password, 8),
      }));

export const verifyPassword = (
  password: string,
  hash: string
): Effect.Effect<boolean, InternalServerError> =>
  Effect.tryPromise({
    try: () => impl.verify(password, hash),
    catch: catchError,
  });

export const hashPassword = (
  password: string
): Effect.Effect<string, InternalServerError> =>
  Effect.tryPromise({ try: () => impl.hash(password), catch: catchError });
