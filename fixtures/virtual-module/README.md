# A single shared component for the server and client

A fixture, code, and explanation of the single component, rendered on the server and the client.

## TODO

- Isomorphic data fetching
- Tailwind integration
- CSS imports `import ./styles.css`

## Explanation

The code implements a single, catch-all route that performs streaming server-side rendering.

### Type the component on the server

The plugin that performs the typing is as follows:

```ts
import type { Compiler } from '@rspack/core';
import path from 'node:path';
// This import is required for compatibility reasons, typescript 7 dropped
// compiler api completely
// https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
import * as ts from '@typescript/typescript6';

export class EmitEntryDeclarationFilePlugin {
  entry: string;
  outName: string;

  constructor(option: { entry: string; outName: string }) {
    this.entry = option.entry;
    this.outName = option.outName;
  }

  apply(compiler: Compiler) {
    const { Compilation, sources } = compiler.rspack;

    compiler.hooks.thisCompilation.tap(
      'EmitEntryDeclarationFilePlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'EmitEntryDeclarationFilePlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
          },
          () => {
            const file = this.entry;

            const configPath = ts.findConfigFile(
              path.dirname(file),
              ts.sys.fileExists,
            );

            if (!configPath) {
              compilation.errors.push(
                new Error(
                  `EmitEntryDeclarationFilePlugin: unable to find tsconfig file.`,
                ),
              );
              return;
            }

            const parsed = ts.getParsedCommandLineOfConfigFile(
              configPath,
              {
                declaration: true,
                emitDeclarationOnly: true,
                noEmit: false,
              },
              {
                ...ts.sys,
                onUnRecoverableConfigFileDiagnostic: (d) => {
                  compilation.errors.push(
                    new Error(
                      `EmitEntryDeclarationFilePlugin: ${String(d.messageText)}`,
                    ),
                  );
                },
              },
            );

            const program = ts.createProgram([file], parsed.options);

            const sourceFile = program.getSourceFile(file);
            if (!sourceFile) {
              compilation.errors.push(
                new Error(
                  `EmitEntryDeclarationFilePlugin: ${file} not in program.`,
                ),
              );
              return;
            }

            program.emit(
              sourceFile,
              (_, text) => {
                compilation.emitAsset(
                  this.outName,
                  new sources.RawSource(text),
                );
              },
              undefined,
              true,
            );
          },
        );
      },
    );
  }
}
```

The plugin follows a simple idea: only v1 through v6 of the TypeScript compiler can generate a `.d.ts` file from a single file programmatically. TypeScript implemented v7 in Go and removed the public programmatic compiler API. They are introducing a new public compiler API, but until then they have published a compatibility version.

```ts
import * as ts from '@typescript/typescript6';
```

This means that we can generate an `index.d.ts` file from an entrypoint: a component rendered on both the server and the client.

```ts
const program = ts.createProgram([file], {
  // typescript compiler options...
});

const sourceFile = program.getSourceFile(file);
if (!sourceFile) {
  compilation.errors.push(
    new Error(`EmitEntryDeclarationFilePlugin: ${file} not in program.`),
  );
  return;
}

program.emit(
  sourceFile,
  (_, text) => {
    compilation.emitAsset(this.outName, new sources.RawSource(text));
  },
  undefined,
  true,
);
```

The callback receives a filename and the content of the file, so we can write a single type declaration file from an input file.

This provides us with a fully typed import when we import the component on the server for server-side rendering:

```tsx
app.get(/^\/(?!static\/).*/, async (req, res, next) => {
  try {
    const App = (await import('./dist/server')).default;

    const { pipe } = renderToPipeableStream(<App />, {
      // ...
    });
  } catch (error) {
    return next(error);
  }
});
```

Unfortunately, after some changes, the ESM import cache turned out to be an issue, and a big one. It causes hydration mismatches after editing a component that is rendered on both the server and the client. That's a problem.

That in turn forced me to replace `import` with `require`. Using `require` doesn't pull in the type of the module being imported, so I took the easy way out and used a type cast.

Maybe a type guard would have been a better option for additional insurance, but this works for now and it's fine for this example.

### Cache busting (avoid hydration mismatch)

I don't really understand why, but `require` is defined in `index.tsx`. I think `require` is not defined in ESM modules, but somehow it is defined in this file. Maybe because tsx uses esbuild to compile modules on the fly (if that's true at all...).

Additionally, I could split the runtime from the application code through webpack's optimization configuration options. The reason for doing so is that it's easier to inspect the application code in a single bundled file. And if the files do get split for any reason (lazy loading, maybe?), the cache busting mechanism should still work, because the server does not expect a single bundled file.

Below is a snippet of the cache busting for the required, compiled, imported module:

```tsx
const serverEntry = path.resolve(root, 'dist/server');
if (isDev) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(serverEntry)) {
      console.debug('Clear require cache: ' + key);
      delete require.cache[key];
    }
  }
}

const App = (require(serverEntry) as typeof import('./dist/server')).default;
```

### Server-Side data fetching with <Suspense />

The core of state collection on the server is this small bit of code. For each HTML chunk sent to the client, inside a `transform()`, it collects **ALL** the state so far, which is why we have to filter out the state we have already sent to the client via `<script>` tags.

```tsx
const sent = new Set<string>();

const state = dehydrate(queryClient, {
  shouldDehydrateQuery: (query) => {
    // (ai ignore): avoid sending the data to the client to send fewer
    // bytes over the network
    const isSent = sent.has(query.queryHash);
    return defaultShouldDehydrateQuery(query) && !isSent;
  },
});
```

The transformer looks something like this:

```tsx
const injector = new stream.Transform({
  transform(chunk, enc, cb) {
    const data = dehydrate(queryClient, {
      shouldDehydrateQuery(query) {
        // I don't know what this one does, but it works...
        return defaultShouldDehydrateQuery(query);
      },
    });
    cb();
  },
});
```

This small bit of code receives `chunk`, which is an HTML page chunk: a buffer. We can inspect its content using `chunk.toString()`.

We can pipe this data through the transformer like this:

```tsx
// import provider, client, etc...
import {} from '@tanstack/react-query';

const queryClient = new QueryClient();

const tree = (
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

const treeStream = renderToPipeableStream(tree, {
  onShellReady() {
    treeStream.pipe(injector).pipe(res);
  },
});
```

I additionally introduced bot checking using a library:

```tsx
import { isBot } from 'isbot';
const isBotRequest = isBot(req.get('user-agent'));
```

The library covers the vast majority of the useful bots we should care about. I don't want to manually list every crawler, LLM, or whatever else we should serve the HTML content of our page to.

There are also things to cover, such as early aborted requests: making sure the server handles those aborts by closing the stream correctly, avoiding multiple `pipe()` calls on the `res` (response) object, and so on.

### Important notes

There are some important notes to keep in mind with this sample implementation.

The implementation does not implement a data fetching strategy that works with React streaming server-side rendering. Such a strategy requires us to emit data for each emitted HTML chunk that's about to get hydrated.

Additionally, there is no standard way to get CSS working here. CSS modules should work out of the box, but I'm not sure about imports such as `import './styles.css'`. If an imported module simply relies on class names, maybe it's fine to leave those CSS files to the client. Alternatively, the server could pick up those `import './styles.css'` statements and inject them on the server side in the header, via a `style` element. This approach would ensure the styles are delivered on the browser's first parse of the page.
