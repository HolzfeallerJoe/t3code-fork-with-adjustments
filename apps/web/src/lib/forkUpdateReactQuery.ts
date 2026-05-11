import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ForkUpdateState } from "@t3tools/contracts";

export const forkUpdateQueryKeys = {
  all: ["desktop", "fork-update"] as const,
  state: () => ["desktop", "fork-update", "state"] as const,
};

export const setForkUpdateStateQueryData = (
  queryClient: QueryClient,
  state: ForkUpdateState | null,
) => queryClient.setQueryData(forkUpdateQueryKeys.state(), state);

export function forkUpdateStateQueryOptions() {
  return queryOptions({
    queryKey: forkUpdateQueryKeys.state(),
    queryFn: async () => {
      const bridge = window.desktopBridge;
      if (!bridge || typeof bridge.getForkUpdateState !== "function") return null;
      return bridge.getForkUpdateState();
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useForkUpdateState() {
  const queryClient = useQueryClient();
  const query = useQuery(forkUpdateStateQueryOptions());

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.onForkUpdateState !== "function") return;

    return bridge.onForkUpdateState((nextState) => {
      setForkUpdateStateQueryData(queryClient, nextState);
    });
  }, [queryClient]);

  return query;
}
