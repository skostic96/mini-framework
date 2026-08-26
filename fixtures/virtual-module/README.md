# A single shared component for the server and client

A fixture, code, and explanation, of the single component, rendered on the server and the clien.

## Explanation

The code implements single, catch all, route that performs Streaming Server Side Rendering.

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

The plugin follows a simple idea, only v1 through v6 of typescript compiler, can generate `.d.ts` file, from a single file, programmatically. Typescript implemented v7 using GO, and removed public programmatic compiler api. They are introducing a new public copmiler api, but they have published compatibility version until then.

```ts
import * as ts from '@typescript/typescript6';
```

This means that we can generate `index.d.ts` file, from an entrypoint, a component rendered on the server, and the client.

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

The callback, receives a filename and the content of the file, and we can write a single type declaration file, from an input file.

This provides us with fully typed import, when we import the component on the server, for server side rendering:

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

Unfortunately, after some changes, i ESM import cache was an issue, and a big one. It causes hydration missmatches after editing a component rendered on the server and client. That's a problem.

That additionally, caused an issue of having to replace import with require. Using require doesn't pull in the type of module being imported, and i decided to take an easy way out, and use a type cast.

Maybe a type guard would have been a better option, for additional insurance, but this works for now and it's fine for this example.

### Cache busting (avoid hydration missmatch)

I don't really understand why, but `require` is defined in the `index.tsx`. I think `require` is not defined in ESM modules, but somehow it is defined in the file. Maybe because `tsx` uses esbuild to compile modules on the fly (if that's true at all...).

However, being able to use require to bust cache has solved a major headache of mine. Hydration issues were no longer an issue.

Additionally, i could split runtime from application code, via webpack optimization configuration options. The reason for doing so is because it's easier to inspect the application code in a single bundled file. Additionally, if for any reason, files get split (maybe lazy loading?), the cache busting mechanism should still work. Because the server does not expect a single bundled file.

Below is a snippet of cache busting for the required, compiled, imported module:

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

### Important notes

There are some important notes to keep in mind with this sample implementation.

The implementation does not implement a data fetching strategy that works with react streaming server side rendering. Such strategy requires us to emit data for each emited html chunk, that's about to get hydrated.

Additionally, there is no a standard way to implement css to work. Modules should work out of the box, but imports such as `import ./styles.css` i am not sure. If an imported module simply relies on classnames, maybe it's fine to leave those css files to the client. Alternatively, the server could pick up those `import ./styles.css` and inject them on the server side in the header, via `style` element. This approach would ensure the styles are delivered on the first page parse by the browser.
