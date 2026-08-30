# A single shared component for the server and client

A fixture, code, and explanation of the single component, rendered on the server and the client.

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

### A nice streaming library to look at

<https://github.com/brillout/react-streaming/tree/main>

This library may not be mainstream due to low download count, but is an awesome reference on how to use & manage streaming server side rendering using react.

### WARNING - different module import instances

```ts
/**
 * WARNING!!!!!!!!!!!!!!!!!!!
 * THIS MODULE MUST NEVER IMPORT MODULES THAT ARE IMPORTED BY THE
 * ISOMORPHIC `APP`. IF A MODULE IS SHARED, IT MUST BE COMPILED,
 * AND RETRIEVED THROUGH COMPILED BUNDLE.
 *
 * THE REASON FOR THAT IS TWO DIFFERENT INSTANCES OF THE SAME IMPORT.
 *
 * EXAMPLE:
 *
 * APP.tsx
 *
 * import Context from './context'
 *
 * index.tsx
 *
 * import Context from './context'
 *
 * const App = evalBundle().default
 * <Context.Provider>
 *   <App />
 * </Context.Provider>
 *
 * WARNING: INDEX.TSX AND APP.TSX HAVE A DIFFERENT INSTANCE OF CONTEXT MODULE.
 *
 * WARNING: ALL SHARED DEPENDENCIES BETWEEN ISOMORPHIC BUNDLE AND INDEX.TSX,
 * TO COME INTO INDEX.TSX MUST BE RETRIEVED VIA COMPILED BUNDLE - OR IMPORT
 * MUST HAPPEN THROUGH THE BUNDLE ( MAYBE CREATE REQUIRE BUNDLE PATH ? )
 *
 * THIS IS A PROBLEM BECAUSE VALUE PROVIDED THROUGH A PROVIDER, WILL **NOT**
 * REACH A CONSUMER AND IS HARD TO DEBUG CRYPTIC BUG.
 */
```

### Code-Splitting with `React.lazy()`

Explanation of the implementation of code-splitting feature on the client and server side.

#### Implementation

Writing to disk made it easier to see the bundle actually being split by React.lazy(), on both the server and the client side:

```tsx
const devMiddlewareInstance = devMiddleware(multiCompiler, {
  publicPath: '/static/',
  // **WARNING** -- nice for debugging - causes lots of issues --
  //
  // enabling disk writing causes HMR to reload every page on
  // every modification to the code, this is nice for debugging, and tempting
  // to use to avoid inlining whole server bundle into a single file, so the
  // server bundle is required from the disk ( - which causes a set of whole
  // other problems - )
  //
  // writeToDisk: true,
});
```

However, as the comment notes, it caused HMR issues - which is a separate problem from the one that followed.

The real issue is that the server bundle is evaluated in memory, but every require inside it resolves against the real file system:

```tsx
function evalBundle(src: string, filename: string) {
  const _module = { exports: {} };
  const _require = Module.createRequire(filename);
  const fun = vm.compileFunction(
    src,
    ['exports', 'require', 'module', '__filename', '__dirname'],
    { filename },
  );
  fun(_module.exports, _require, _module, filename, path.dirname(filename));
  return _module.exports;
}
```

So when a lazy chunk is requested, require looks for a file that only exists in memfs, and fails.

One solution would have been to keep the chunk lookups inside the bundle - for example by using a dedicated path or prefix - or to write a custom require that resolves against memfs:

```tsx
const memfs = devMiddlewareInstance.context
  .outputFileSystem as typeof import('node:fs') &
  import('@rspack/dev-middleware').OutputFileSystem;
```

That probably would have been enough, but since performance isn't part of this fixture, I went with the simpler option: inline everything into a single server bundle.

```tsx
const serverConfig: Configuration = {
  name: 'server',
  target: 'node',
  entry: {
    index: path.resolve(root, 'src/server.tsx'),
  },
  plugins: [
    // on the server ignore every React.lazy() import and put everything in one
    // file because we evaluate bundle in memory and require imports files from
    // the file system, because externals are not included in the server bundle
    new rspack.optimize.LimitChunkCountPlugin({
      maxChunks: 1,
    }),
  ],
};
```

And that's pretty much it - on the client it just works. I'm fairly sure I still need a deeper understanding of how it works, why it works, how it's wired up, and what should be linked on each page. For now, though, I've hit all the exploration points I set out to cover, and I'm happy with that.

#### Loader

Libraries:

- magic-string
- acorn
- acorn-walk

The implementation turned out to be more touchy than it seemed before I started.

`magic-string` is used because it makes it easy to manipulate the source, insert comments at known offsets, check whether the source was actually changed, and return a result based on that.

Three problems came up.

##### 1. Deciding whether an imported `loadable` is ours

The loader must only transform calls to _our_ `loadable`. A user may well have their own function by that name that does something else entirely, and we must leave it alone.

An absolute import is easy to check, since the specifier is enough on its own:

```js
import { loadable } from '@/ctx-loadable';
```

A relative import isn't, and the user is of course free to write one. To resolve it we need three pieces of information:

- The location of the importing file
- The location of the imported `loadable`
- The location of our framework-internal `loadable`

With those we can resolve the specifier to an absolute path, compare it against our own, and then either insert the magic comment or skip the call.

##### 2. Recognizing the call and inferring the chunk name

While iterating call expressions, we have to decide whether each one is a `loadable` call. If it is, we walk the factory's inner AST to find the `import()` expression. Whether we can extract its specifier depends on the form of the factory.

The second argument — the module id — has the same limitation: it's only inferable when it's a string literal or a template literal. Anything more complex, a function or an arbitrary expression, would require evaluating it, which I don't see a good way to do.

The easy way out is to define the conditions under which we can infer the chunk name, and require the user to supply their own magic comment and module id if they step outside them:

```js
import(/* webpackChunkName: "some-chunk-name" */ './module');
```

##### 3. The variety of factory forms

There are many ways to declare or define a factory within a single module, and it's hard to enumerate them all up front. The AST parser gets us as far as iterating every call expression; the rest of the logic comes from working through the forms case by case.

### Important notes

There are some important notes to keep in mind with this sample implementation.

The implementation does not implement a data fetching strategy that works with React streaming server-side rendering. Such a strategy requires us to emit data for each emitted HTML chunk that's about to get hydrated.

Additionally, there is no standard way to get CSS working here. CSS modules should work out of the box, but I'm not sure about imports such as `import './styles.css'`. If an imported module simply relies on class names, maybe it's fine to leave those CSS files to the client. Alternatively, the server could pick up those `import './styles.css'` statements and inject them on the server side in the header, via a `style` element. This approach would ensure the styles are delivered on the browser's first parse of the page.
