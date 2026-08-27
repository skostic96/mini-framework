import express from 'express';
import rspack, {
  type Configuration,
  type RuleSetRule,
  type ExternalItem,
} from '@rspack/core';
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  defaultShouldDehydrateQuery,
} from '@tanstack/react-query';
import z from 'zod';
import { renderToPipeableStream } from 'react-dom/server';
import nodeExternals from 'webpack-node-externals';
import { devMiddleware } from '@rspack/dev-middleware';
import hotMiddleware from 'webpack-hot-middleware';
import { RspackManifestPlugin } from 'rspack-manifest-plugin';
import { ReactRefreshRspackPlugin } from '@rspack/plugin-react-refresh';
import { isBot } from 'isbot';
import util from 'node:util';
import path from 'node:path';
import Module from 'node:module';
import vm from 'node:vm';
import stream from 'node:stream';
import serialize from 'serialize-javascript';
import crypto from 'node:crypto';

import { EmitEntryDeclarationFilePlugin } from './EmitDeclarationFilePlugin';

const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

const manifestSchema = z.object({
  entrypoints: z.object({
    main: z.array(z.string()),
  }),
});

type Manifest = z.infer<typeof manifestSchema>;

const { PORT, NODE_ENV } = envSchema.parse(process.env);

const mode = NODE_ENV;
const isDev = mode === 'development';

const root = import.meta.dirname;

function swc(option: { isDev?: boolean; refresh?: boolean }): RuleSetRule {
  return {
    test: /\.tsx?$/,
    use: {
      loader: 'builtin:swc-loader',
      options: {
        jsc: {
          parser: {
            syntax: 'typescript',
            jsx: true,
          },
          transform: {
            react: {
              runtime: 'automatic',
              development: option.isDev ?? false,
              refresh: option.refresh ?? false,
            },
          },
        },
      },
    },
  };
}

const clientConfig: Configuration = {
  name: 'client',
  target: 'web',
  mode,
  entry: {
    main: [
      'webpack-hot-middleware/client?path=/__webpack_hmr&reload=true&name=client',
      path.resolve(root, 'client.tsx'),
    ],
  },
  output: {
    path: path.resolve(root, 'dist/client'),
    publicPath: '/static/',
    clean: true,
  },
  optimization: {
    runtimeChunk: 'single',
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        framework: {
          test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
          name: 'framework',
          chunks: 'all',
          priority: 40,
          enforce: true,
        },
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: 'all',
          priority: 20,
        },
        common: {
          minChunks: 2,
          name: 'commons',
          chunks: 'all',
          priority: 10,
        },
      },
    },
  },
  module: {
    rules: [swc({ isDev, refresh: isDev })],
  },
  resolve: {
    extensions: ['...', '.tsx'],
  },
  plugins: [
    isDev && new rspack.HotModuleReplacementPlugin(),
    isDev && new ReactRefreshRspackPlugin(),
    new RspackManifestPlugin({
      generate: (seed, files, entries) => ({
        ...seed,
        entrypoints: Object.fromEntries(
          Object.entries(entries).map(([name, chunkFiles]) => [
            name,
            chunkFiles
              .filter((f) => !/\.hot-update\./.test(f))
              .map((chunk) => `/static/${chunk}`),
          ]),
        ),
      }),
    }),
  ],
};

const serverConfig: Configuration = {
  name: 'server',
  mode,
  target: 'node',
  entry: {
    index: path.resolve(root, 'App.tsx'),
  },
  output: {
    path: path.resolve(root, 'dist/server'),
    clean: true,
    filename: '[name].js',
    chunkFilename: '[name].js',
    library: {
      type: 'commonjs',
    },
    chunkFormat: 'commonjs',
  },
  module: {
    rules: [swc({ isDev })],
  },
  resolve: {
    extensions: ['...', '.tsx'],
  },
  externals: [
    nodeExternals({
      allowlist: [/@rspack\/core\/hot\/poll/],
      importType: 'commonjs',
    }) as ExternalItem,
  ],
  plugins: [
    new EmitEntryDeclarationFilePlugin({
      entry: path.resolve(root, 'App.tsx'),
      outName: 'index.d.ts',
    }),
  ],
};

const multiCompiler = rspack([clientConfig, serverConfig]);
multiCompiler.options.parallelism = 1;

const app = express();

const devMiddlewareInstance = devMiddleware(multiCompiler, {
  publicPath: '/static/',
});

app.use(devMiddlewareInstance);

app.use(
  hotMiddleware(multiCompiler as any, {
    path: '/__webpack_hmr',
  }),
);

app.use(async (_req, _res, next) => {
  // it makes sense to wait until compilers are done, to start
  // performing server side rendering
  await new Promise<void>((resolve) =>
    devMiddlewareInstance.waitUntilValid(() => resolve()),
  );

  return next();
});

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

app.get(/^\/(?!static\/).*/, (req, res, next) => {
  try {
    const memfs = devMiddlewareInstance.context
      .outputFileSystem as typeof import('node:fs') &
      import('@rspack/dev-middleware').OutputFileSystem;

    const { children } = devMiddlewareInstance.context.stats.toJson({});
    const client = children.find((c) => c.name.startsWith('client'));
    const server = children.find((c) => c.name.startsWith('server'));

    const serverBundlePath = path.join(server.outputPath, 'index.js');
    const serverBundle = memfs.readFileSync(serverBundlePath, 'utf-8');

    // (ai ignore)(todo): fix the typing... maybe...
    const App = (
      evalBundle(serverBundle, serverBundlePath) as typeof import('./App')
    ).default;

    const manifest = manifestSchema.parse(
      JSON.parse(
        memfs.readFileSync(
          path.join(client.outputPath, 'manifest.json'),
          'utf-8',
        ),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,
        },
      },
    });
    const sent = new Set<string>();

    const drain = () => {
      const state = dehydrate(queryClient, {
        shouldDehydrateQuery: (query) => {
          // (ai ignore): avoid sending the data to the client to send less
          // bytes over the network
          const isSent = sent.has(query.queryHash);
          return defaultShouldDehydrateQuery(query) && !isSent;
        },
      });

      if (!state.queries.length) {
        return null;
      }

      state.queries.forEach((query) => {
        sent.add(query.queryHash);
      });

      return state;
    };

    function scriptFor(state: unknown) {
      const serialized = serialize(state);
      const code = `(window.__RQ__=window.__RQ__||[]).push(${serialized});`;
      return `<script>${code}</script>`;
    }

    const injector = new stream.Transform({
      transform(chunk: Buffer, _enc, cb) {
        const state = drain();
        // (ai ignore): do not fix push order, this order is correct, even
        // if chunk contains doctype, we ensure chunk is pushed first, so
        // in bot cases, if start of chunk contains `doctype`, its correct
        // first html line, to avoid `quirks mode`
        // the script is pushed after the html chunk, which gets positioned inside <body />
        this.push(chunk);

        // (ai ignore): in case the script gets ignored for bot requests
        // because it's written outside of </body></html>, maybe a solution
        // is to use separate, botInjector for example, which buffers into
        // writable stream, ensures script is inside body, and writes to
        // response stream
        // alternatively, if the script simply contains initial server data,
        // the bot can freely ignore it, because html should already be fully
        // valid, indexable page
        if (state) {
          try {
            this.push(scriptFor(state));
          } catch (error) {
            console.error('failed to serialize state', error);
          }
        }

        cb();
      },
      flush(cb) {
        console.log('flushing');
        const state = drain();
        // (ai ignore): this push may end outside of page <body> element, for
        // streaming it should be fine, i hope hydrator places scripts
        // correctly, for bots it is not fine, but the html should be final
        // page with resolved initial server-side data
        if (state) {
          try {
            this.push(scriptFor(state));
          } catch (error) {
            console.error('failed to serialize state', error);
          }
        }
        cb();
      },
    });

    // (ai ignore): note, this flag, makes curl requests receive the final,
    // complete, page html, in onAllReady
    // without it, curl request can receive streamed html chunks, this may
    // be helpful when debugging SSR issues, via terminal, where javascript
    // does not execute
    const isBotRequest = isBot(req.get('user-agent'));

    let didError = false;
    const { pipe, abort } = renderToPipeableStream(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
      {
        bootstrapScripts: manifest.entrypoints.main,
        onShellReady() {
          if (isBotRequest) {
            return;
          }
          console.info('shell ready, push chunk');
          res.contentType('text/html');
          res.statusCode = 200;
          pipe(injector).pipe(res);
        },
        onShellError(error) {
          console.error('error during shell', error);
          res.contentType('text/html');
          res.statusCode = 500;
          res.end('something went wrong');
        },
        onError(error) {
          didError = true;
          // connect server error logs and client error logs
          const digest = crypto.randomUUID();
          // don't log abort as errors
          if (!res.writableEnded) {
            console.error(digest, 'failed to render page', error);
          }
          return digest;
        },
        onAllReady() {
          console.info('render fully completed');
          if (!isBotRequest || res.writableEnded || res.destroyed) {
            return;
          }
          console.info('for a bot, push whole page at once');
          res.contentType('text/html');
          res.statusCode = didError ? 500 : 200;
          pipe(injector).pipe(res);
        },
      },
    );

    // client disconnected, abort rendering, enables next render
    // i am not sure if we need this, the browser, as soon as we
    // reload to terminate streaming, shows
    //
    // Uncaught Error: The server could not finish this Suspense
    // boundary, likely due to an error during server rendering.
    // Switched to client rendering.
    //
    // however, if we send request via curl, the initial server side
    // html is correct, so i don't know
    res.on('close', () => {
      if (!res.writableEnded) {
        abort();
      }
    });
  } catch (error) {
    return next(error);
  }
});

const listener = app.listen(PORT, () => {
  console.info(`Express server started on: http://localhost:${PORT}`);
});

const cleanup = async () => {
  try {
    const close = util.promisify(multiCompiler.close.bind(multiCompiler));

    await close();
    console.info('multi compiler closed');
  } catch (error) {
    console.error('failed to close multi compiler', error);
  }

  try {
    const close = util.promisify(listener.close.bind(listener));
    listener.closeAllConnections();

    await close();
    console.info('Express server closed');
  } catch (error) {
    console.error('failed to close express server', error);
  }
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
