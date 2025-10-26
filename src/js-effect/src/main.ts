import { Config, Effect, Layer } from 'effect';
import { BunRuntime, BunHttpServer } from '@effect/platform-bun';
import { HttpApiBuilder } from '@effect/platform';
import { ApplicationLive } from './application.js';
import { AuthMiddlewareLive, AuthService } from './auth.js';
import { KyselySqlServiceLive } from './kysely.js';

const HttpLive = Config.number('PORT').pipe(
  Config.withDefault(3000),
  Effect.map(port =>
    BunHttpServer.layer({ port, idleTimeout: 0 }).pipe(
      Layer.tap(() => Effect.logInfo(`Listening at http://localhost:${port}`))
    )
  ),
  Layer.unwrapEffect
);

const program = Layer.launch(
  HttpApiBuilder.serve().pipe(
    Layer.provide(ApplicationLive),
    Layer.provide(HttpLive)
  )
);

const layers = Layer.mergeAll(
  KyselySqlServiceLive,
  AuthMiddlewareLive,
  AuthService.Default
);

program.pipe(Effect.provide(layers), BunRuntime.runMain);
