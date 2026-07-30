import { useAtomValue } from "@effect/atom-react";
import type { DesktopBridge, ForkUpdateState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Atom } from "effect/unstable/reactivity";

type ForkUpdateBridge = Pick<DesktopBridge, "getForkUpdateState" | "onForkUpdateState">;

const INITIAL_STATE_READ_ATTEMPT_COUNT = 3;

export class ForkUpdateStateReadError extends Schema.TaggedErrorClass<ForkUpdateStateReadError>()(
  "ForkUpdateStateReadError",
  {
    attemptCount: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read the initial fork update state after ${this.attemptCount} attempts.`;
  }
}

function getForkUpdateBridge(): ForkUpdateBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = window.desktopBridge;
  // The fork bridge methods only exist on fork builds; a stock desktop build
  // exposes desktopBridge without them.
  if (!bridge || typeof bridge.getForkUpdateState !== "function") return undefined;
  return bridge;
}

export function createForkUpdateStateAtom(getBridge: () => ForkUpdateBridge | undefined) {
  const updates = Stream.callback<ForkUpdateState | null>((queue) =>
    Effect.gen(function* () {
      const bridge = getBridge();
      if (!bridge) {
        Queue.offerUnsafe(queue, null);
        return yield* Effect.never;
      }

      let receivedUpdate = false;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          bridge.onForkUpdateState((state) => {
            receivedUpdate = true;
            Queue.offerUnsafe(queue, state);
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      );

      const initialState = yield* Effect.tryPromise({
        try: () => bridge.getForkUpdateState(),
        catch: (cause) =>
          new ForkUpdateStateReadError({
            attemptCount: INITIAL_STATE_READ_ATTEMPT_COUNT,
            cause,
          }),
      }).pipe(
        Effect.retry({ times: INITIAL_STATE_READ_ATTEMPT_COUNT - 1 }),
        Effect.catchTags({
          ForkUpdateStateReadError: (error) =>
            Effect.logError(error.message, {
              error,
              errorTag: error._tag,
              attemptCount: error.attemptCount,
            }).pipe(Effect.as(null)),
        }),
      );
      if (!receivedUpdate && initialState !== null) {
        Queue.offerUnsafe(queue, initialState);
      }

      return yield* Effect.never;
    }),
  );

  return Atom.make(updates, { initialValue: null }).pipe(
    Atom.keepAlive,
    Atom.withLabel("desktop:fork-update-state"),
  );
}

const forkUpdateStateAtom = createForkUpdateStateAtom(getForkUpdateBridge);

export function useForkUpdateState(): ForkUpdateState | null {
  return AsyncResult.getOrElse(useAtomValue(forkUpdateStateAtom), () => null);
}
