# Dissasembling next.js imlpementation

Explanation of the ideas put together from next.js imlementation.

## Explanation

Below is the rough architectural layout, which enables all of this to work:

```txt
app.mts
|
|-- http.server (express() server)
|   |
|   |-- app.get(/.*/)
|       |
|       |-- (details):
|           |-- map request to entrypoint key
|           |-- import server page component from dist/server/
|
|-- resolveEntries()
|   |
|   |-- put together entries from ./src folder
|   |-- each `page.tsx` is a page component
|
|-- rspack() multi compiler
|   |
|   |-- clientCompiler
|   |   |-- writes to disk
|   |
|   |-- serverCompiler
|   |   |-- writes to disk
|   |
|   |-- hook writes page entrypoint files to manifest
```

### Run `tsx` server files on the fly

We can use the command line interface tool `tsx` to run the scripts, server, and anything else as `tsx` files: `./node_modules/.bin/tsx scripts/index.tsx`.

This is very convenient and would allow us to write server side code in `tsx` format, without having to use monorepo or compile `tsx` modules to `js` and only then importing them.

### In-Memory nodejs pages:

We can discard using the disk file system, for the current imlpementation, but we would need to execute server components to retrieve their export from the compiled component source code.

The issue is that i dont know how would it handle externals, like node_modules dependencies.

### Client side hydration:

There are two parts, a loader and bootstrap hydrator of the page.

The high level idea without implementation details: The loader runs for each entrypoint (page) and it receives the absolute path of the page to be imported and the page route. The rendered page gets both information on the client side, during an initial server side render. The code in the loader runs on the client side, and it provides a factory:

```ts
type Factory = () => { default: React.ComponentType<any> };
type Entry = [route: string, factory?: Factory];
```

The remaining work is to turn the `window.__FRAMEWORK_P__` into a queue by replacing `window.__FRAMEWORK_P__.push` with our custom registry function. Before doing so, it registers initially provided components, then clears them out, and replaces push with custom `register` function.

The following are in detail explanations of the loader and the bootstrap hydrator function.

#### Loader

The loader is applied to the client configuration, and it's idea is based to match the one from next.js loader: `next-client-pages-loader` <https://github.com/vercel/next.js/blob/canary/packages/next/src/build/webpack/loaders/next-client-pages-loader.ts>

I think, essentially, this loader replaces entries, which would be actual entry page, with client side route and factory for the actual page. It provides foundation for the client side bootstrap, to load the page component, and then hydrate it.

```tsx
const config: Configuration = {
  resolveLoader: {
    alias: {
      'client-page-loader': path.resolve(
        root,
        'lib',
        'loader',
        'client-page-loader.ts',
      ),
    },
  },
};
```

We had to help rspack understand where to find the client-page-loader <https://rspack.rs/config/resolve-loader#example>.

Below is the implementation of the loader, at the time of writing or latest updating of this markdown file. Also the code below is also at the latest time of updating this markdown file. Neither may need to match the actula implementation in this repository.

```tsx
import type { LoaderDefinitionFunction } from '@rspack/core';
import z from 'zod';

const LoaderOptionsSchema = z.object({
  pageAbsolutePath: z.string(),
  pageRoute: z.string(),
});

type ClientPageLoaderOptions = z.infer<typeof LoaderOptionsSchema>;

const loader: LoaderDefinitionFunction = function () {
  const { pageAbsolutePath, pageRoute } = LoaderOptionsSchema.parse(
    this.getOptions(),
  );

  const route = JSON.stringify(pageRoute);
  const path = JSON.stringify(pageAbsolutePath);

  // todo: maybe we can replace with `import`
  return `
  (window.__FRAMEWORK_P__ = window.__FRAMEWORK_P__ || []).push([
    ${route},
    function () {
      return require(${path});
    }
  ]);
  if (module.hot) {
    module.hot.dispose(function () {
      // HMR path, registering route without factory, triggers delete
      window.__FRAMEWORK_P__.push([${route}]);
    });
  }
  `;
};

export default loader;
export type { ClientPageLoaderOptions };
```

#### Bootstrap hydrator:

An essential part that made this work was enabling dependency between entries. Each entry specifies that it depnds on the bootstrap entry. Doing so, made writing manifest a bit harder, but not significantly harder.

The following is the snippet of entry creation:

```tsx
const clientEntry = {
  main: path.resolve(root, 'lib', 'client', 'bootstrap.tsx'),
  ...(Object.entries(sharedEntry) as [LocalEntryKey, LocalEntryValue][]).reduce(
    (acc, [key, value]) => {
      const parsed = parseFilePath({ filePath: value, srcPath });

      const params = {
        pageRoute: parsed.route,
        pageAbsolutePath: parsed.importPath,
      };

      const entryDescription: EntryDescription = {
        import: `client-page-loader?${query.stringify(params)}!`,
        dependOn: 'main',
      };

      return {
        ...acc,
        [key]: entryDescription,
      };
    },
    {} as Record<LocalEntryKey, LocalEntryValue>,
  ),
};
```

As you can see, each entry specifies `dependOn: 'main'` and we explicitly add single main entry `main: path.resolve(root, 'lib', 'client', 'bootstrap.tsx')`.

We used the library `import query from 'query-string';` to create query parameters that the loader needs.

Below is the code for the bootstrap functionality.

```tsx
import { hydrateRoot } from 'react-dom/client';

type Factory = () => { default: React.ComponentType<any> };
type Entry = [route: string, factory?: Factory];

declare global {
  interface Window {
    __INITIAL_DATA__: Record<string, unknown>;
    __FRAMEWORK_P__: Entry[];
  }
}

const registered = new Map<string, Factory>();
const waiting = new Map<string, (f: Factory) => void>();

function register([route, factory]) {
  // HMR path, registering route without factory, triggers delete
  if (!factory) {
    // in case it was registered, but new factory not provided
    registered.delete(route);
    return;
  }
  registered.set(route, factory);
  const resolve = waiting.get(route);
  if (resolve) {
    waiting.delete(route);
    resolve(factory);
  }
}

function whenPage(route: string): Promise<Factory> {
  const existing = registered.get(route);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    waiting.set(route, resolve);
  });
}

const queue = (window.__FRAMEWORK_P__ = window.__FRAMEWORK_P__ || []);
// register each existing page from the queue
queue.forEach(register);
// then clear the queue by setting length to 0
queue.length = 0;
// replace each future push with register function
queue.push = register as any;

async function bootstrap() {
  const data = window.__INITIAL_DATA__;
  const Page = (await whenPage(data.pageRoute as string))().default;
  hydrateRoot(document, <Page />);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap page', error);
});
```

### Incomplete implementation details

For example, i haven't fully implemented route to entry key, route to module path, and so on. Next.js uses Watchpack <https://github.com/webpack/watchpack> to rebuild, statically, on newly discovered pages. I haven't implemented that. Retrieving pages by request, would be much easier if i had added this.

Alternative implementation would have been to have one `<App />` component, instead of file system paths. The downside would be bundling every other page, for a single page request.
