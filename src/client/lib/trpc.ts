import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../server/trpc';

/** Type-only import above keeps the server runtime out of the client bundle. */
export const trpc = createTRPCReact<AppRouter>();

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/trpc',
        fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
      }),
    ],
  });
}
