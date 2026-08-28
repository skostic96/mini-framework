import express from 'express';
import rspack from '@rspack/core';
import type {
  GeneratorOptionsByModuleType,
  ParserOptionsByModuleType,
  ExternalItem,
  RuleSetRule,
  Configuration,
} from '@rspack/core';
import z from 'zod';
import nodeExternals from 'webpack-node-externals';
import { devMiddleware } from '@rspack/dev-middleware';
import hotMiddleware from 'webpack-hot-middleware';
import { RspackManifestPlugin } from 'rspack-manifest-plugin';
import { ReactRefreshRspackPlugin } from '@rspack/plugin-react-refresh';
import util from 'node:util';
import path from 'node:path';
import Module from 'node:module';
import vm from 'node:vm';

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

const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

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

/**
 * Enables loading css moduled, automatically deduced whether it's .module
 * or .css file.
 */
function css(): RuleSetRule {
  return {
    test: /\.css$/i,
    type: 'css/auto',
  };
}

/**
 * Enables `import styles from './App.module.css'` instead of named exports
 * or `import * as styles from ''`
 */
function parser(): ParserOptionsByModuleType {
  return {
    'css/auto': {
      namedExports: false,
    },
  };
}

// https://rspack.rs/config/module-generator
function generator(): GeneratorOptionsByModuleType {
  return {
    'css/auto': {
      // using [local] causes hydration missmatch (i don't know why), but
      // using hash is fine
      localIdentName: '[uniqueName]_[id]_[hash:5]',
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
      path.resolve(root, 'src/client.tsx'),
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
    rules: [swc({ isDev, refresh: isDev }), css()],
    parser: parser(),
    generator: generator(),
  },
  resolve: {
    extensions: ['...', '.tsx', '.ts'],
  },
  plugins: [
    isDev && new rspack.HotModuleReplacementPlugin(),
    isDev && new ReactRefreshRspackPlugin(),
    new RspackManifestPlugin({
      generate: (seed, files, entries) => {
        return {
          ...seed,
          entrypoints: Object.fromEntries(
            Object.entries(entries).map(([name, chunkFiles]) => {
              const filteredFiles = chunkFiles
                .filter((f) => !/\.hot-update\./.test(f))
                .map((chunk) => `/static/${chunk}`);
              const isJs = (chunk: string) => /\.js$/.test(chunk);
              const isCss = (chunk: string) => /\.css$/.test(chunk);
              return [
                name,
                {
                  js: filteredFiles.filter(isJs),
                  css: filteredFiles.filter(isCss),
                },
              ];
            }),
          ),
        };
      },
    }),
  ],
};

const serverConfig: Configuration = {
  name: 'server',
  mode,
  target: 'node',
  entry: {
    index: path.resolve(root, 'src/server.tsx'),
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
    rules: [swc({ isDev }), css()],
    parser: parser(),
    generator: generator(),
  },
  resolve: {
    extensions: ['...', '.tsx', '.ts'],
  },
  externals: [
    nodeExternals({
      allowlist: [/@rspack\/core\/hot\/poll/],
      importType: 'commonjs',
    }) as ExternalItem,
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

app.get(/^\/(?!static\/).*/, async (req, res, next) => {
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
    const bundleExports = evalBundle(
      serverBundle,
      serverBundlePath,
    ) as typeof import('./src/server');

    const createHandler = bundleExports.default;

    const manifest = bundleExports.manifestSchema.parse(
      JSON.parse(
        memfs.readFileSync(
          path.join(client.outputPath, 'manifest.json'),
          'utf-8',
        ),
      ),
    );

    return await createHandler({ getManifest: () => manifest })(req, res, next);
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
