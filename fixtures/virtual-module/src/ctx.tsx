import { createContext, use, lazy } from 'react';

const Ctx = createContext<((id: string) => void) | null>(null);

export function useCtx() {
  const ctx = use(Ctx);

  return ctx;
}

export const CtxProvider = Ctx.Provider;

export function loadable(
  factory: () => Promise<{
    default: React.ComponentType<any>;
  }>,
  id: string,
) {
  const Inner = lazy(factory);

  return function Loadable(props: any) {
    const ctx = useCtx();

    // This runs only during server-side rendering: we propagate the imported
    // module's id upwards, to the provider.
    //
    // This relies on a convention: the `id` and the `webpackChunkName` must be
    // the same value. For now I supply that information by hand, because writing
    // a small code-transform plugin for SWC (which only supports WASM builds)
    // wasn't something I wanted to spend time on. Such a plugin would insert the
    // `id` and the `webpackChunkName` comment automatically, using the same,
    // more unique value derived from the path of the lazy-loaded component.
    //
    // The chunks a component needs are emitted during streaming hydration,
    // following the hydrate/dehydrate pattern.
    if (ctx) {
      ctx(id);
    }

    return <Inner {...props} />;
  };
}
