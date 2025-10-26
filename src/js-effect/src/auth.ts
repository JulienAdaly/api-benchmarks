import { Config, Context, Effect, flow, Layer, Redacted, Schema } from 'effect';
import { HttpApiMiddleware, HttpApiSecurity } from '@effect/platform';
import { UnauthorizedError } from './errors.js';
import { jwtVerify, SignJWT } from 'jose';
import { UserId } from './domain.js';

const JwtPayload = Schema.Struct({
  sub: UserId,
  role: Schema.Literal('admin', 'user'),
});
type Session = {
  userId: UserId;
  role: 'admin' | 'user';
};
export class CurrentSession extends Context.Tag('CurrentSession')<
  CurrentSession,
  Session
>() {}

export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()(
  'AuthMiddleware',
  {
    failure: UnauthorizedError,
    provides: CurrentSession,
    security: {
      bearer: HttpApiSecurity.bearer,
    },
  }
) {}

const checkToken =
  (encodedSecret: Uint8Array) => (token: Redacted.Redacted<string>) =>
    Effect.tryPromise({
      try: () => jwtVerify(Redacted.value(token), encodedSecret),
      catch: e => new UnauthorizedError({ detail: `Unauthorized: ${e}` }),
    }).pipe(
      Effect.map(({ payload }) => payload),
      Effect.flatMap(
        flow(
          Schema.decodeUnknown(JwtPayload),
          Effect.mapError(
            () => new UnauthorizedError({ detail: 'Invalid payload' })
          )
        )
      ),
      Effect.map(session => ({
        userId: session.sub,
        role: session.role,
      }))
    );

export const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const jwtSecret = yield* Config.string('JWT_SECRET').pipe(
      Config.withDefault('dev-secret')
    );
    const encodedSecret = new TextEncoder().encode(jwtSecret);
    return {
      bearer: checkToken(encodedSecret),
    } as const;
  })
);

export class AuthService extends Effect.Service<AuthService>()('AuthService', {
  accessors: true,
  effect: Effect.gen(function* () {
    const jwtSecret = yield* Config.string('JWT_SECRET').pipe(
      Config.withDefault('dev-secret')
    );
    const secret = new TextEncoder().encode(jwtSecret);
    const signToken = (payload: Session) =>
      Effect.promise(() =>
        new SignJWT({ sub: payload.userId, role: payload.role })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('1h')
          .sign(secret)
      );
    return {
      signToken,
    } as const;
  }),
}) {}
