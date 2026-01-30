// Password utility that works with both Bun and Node.js
import { Effect } from 'effect';

// Check if we're running on Bun
const isBun = typeof Bun !== 'undefined';

// Lazy load bcryptjs for Node.js (ES module compatible)
let bcryptjs: typeof import('bcryptjs') | null = null;
const getBcrypt = async () => {
  if (!bcryptjs && !isBun) {
    bcryptjs = await import('bcryptjs');
  }
  return bcryptjs;
};

export const verifyPassword = (
  password: string,
  hash: string
): Effect.Effect<boolean, Error> => {
  if (isBun) {
    return Effect.promise(() =>
      Bun.password.verify(password, hash, 'bcrypt')
    );
  } else {
    // Node.js: use bcryptjs
    return Effect.promise(async () => {
      const bcrypt = await getBcrypt();
      if (!bcrypt) {
        throw new Error('bcryptjs not available');
      }
      return bcrypt.compare(password, hash);
    });
  }
};

export const hashPassword = (
  password: string
): Effect.Effect<string, Error> => {
  if (isBun) {
    return Effect.promise(() =>
      Bun.password.hash(password, {
        algorithm: 'bcrypt',
      })
    );
  } else {
    // Node.js: use bcryptjs
    return Effect.promise(async () => {
      const bcrypt = await getBcrypt();
      if (!bcrypt) {
        throw new Error('bcryptjs not available');
      }
      return bcrypt.hash(password, 8);
    });
  }
};
