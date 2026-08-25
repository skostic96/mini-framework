import {
  type ExternalItem,
  type Configuration,
  type RuleSetRule,
  type Compiler,
  type EntryDescription,
  rspack,
} from '@rspack/core';
import path from 'node:path';
import nodeExternals from 'webpack-node-externals';
import express from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import url from 'node:url';
import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import query from 'query-string';
import serialize from 'serialize-javascript';

const app = express();

const root = import.meta.dirname;
const srcDir = 'src';
const distDir = 'dist';
const clientDir = 'client';
const serverDir = 'server';
const distDirPath = path.resolve(root, distDir);
const clientDirPath = path.resolve(distDirPath, clientDir);
const serverDirPath = path.resolve(distDirPath, serverDir);
const dev = process.env['NODE_ENV'] !== 'production';
const mode = dev ? 'development' : 'production';
const context = root;

function parseFilePath({
  filePath,
  srcPath,
  indexFileName = 'page',
}: {
  filePath: string;
  srcPath: string;
  indexFileName?: string;
}) {
  const parsedFilepath = path.parse(filePath);

  const normalizedFilepath =
    parsedFilepath.dir.split(path.sep).join('/') + '/' + parsedFilepath.base;

  const relative = path.relative(srcPath, filePath);
  const parsed = path.parse(relative);

  if (parsed.dir === '.' && parsed.name === indexFileName) {
    return {
      route: '/',
      entryKey: '/' + parsed.name,
      importPath: normalizedFilepath,
    };
  }

  const segments = parsed.dir.split(path.sep).filter(Boolean);

  const route =
    parsed.name === indexFileName
      ? '/' + segments.join('/')
      : '/' + [...segments, parsed.name].join('/');

  const entryKey = [...segments, parsed.name]
    .join('/')
    .replace(/\[/g, '_')
    .replace(/\]/g, '_');

  return { route, entryKey, importPath: normalizedFilepath };
}

async function resolveEntries() {
  const srcPath = path.resolve(root, srcDir);

  const paths = await fs.readdir(srcPath, {
    recursive: true,
    withFileTypes: true,
  });

  const sharedEntry = paths
    .filter((p) => {
      // todo: (ai ignore) non page.tsx files should also become page
      const filename = path.basename(p.name);
      const isPage = /^page\.(tsx?|jsx?)$/.test(filename);
      return p.isFile() && isPage;
    })
    .reduce((acc, cur) => {
      const fullPath = path.resolve(cur.parentPath, cur.name);

      const parsed = parseFilePath({ filePath: fullPath, srcPath });

      const entry = { [parsed.entryKey]: fullPath };

      return { ...acc, ...entry };
    }, {});

  type LocalEntry = typeof sharedEntry;
  type LocalEntryKey = keyof LocalEntry;
  type LocalEntryValue = LocalEntry[LocalEntryKey];

  const clientEntry = {
    main: path.resolve(root, 'lib', 'client', 'bootstrap.tsx'),
    ...(
      Object.entries(sharedEntry) as [LocalEntryKey, LocalEntryValue][]
    ).reduce(
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

  const result = {
    server: sharedEntry,
    client: clientEntry,
  };

  return result;
}

function swc(): RuleSetRule {
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
            },
          },
        },
      },
    },
  };
}

let manifest: Record<string, string[]> = {};

class PageEntrypointsPlugin {
  PLUGIN = 'PageEntrypointsPlugin';
  apply = (compiler: Compiler) => {
    compiler.hooks.compilation.tap(this.PLUGIN, (compilation) => {
      const { Compilation } = compiler.webpack;

      compilation.hooks.processAssets.tap(
        {
          name: this.PLUGIN,
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        () => {
          for (const [name, entrypoint] of compilation.entrypoints) {
            const files = new Set<string>();
            entrypoint.getFiles().forEach((file) => files.add(file));
            // entries with dependOn declare those as parent entries
            // an entrypoint depends on entryfiles from its parent entry as
            // well
            // there may be some duplicate entrypoint files, so we have to use
            // a set to avoid adding same entrypoint file multiple times
            for (const parent of entrypoint.getParents()) {
              parent.getFiles().forEach((file) => files.add(file));
            }
            manifest[name] = [...files];
          }
        },
      );
    });
  };
}

const clientConfig: Configuration = {
  name: 'client',
  mode,
  context,
  entry: async () => {
    // (ai ignore) i think this has to be a function, to keep dynamic entry evaluation
    return (await resolveEntries()).client;
  },
  output: {
    path: clientDirPath,
    clean: true,
    filename: '[name].js',
    chunkFilename: '[name].js',
  },
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
    rules: [swc()],
  },
  plugins: [new PageEntrypointsPlugin()],
};

// TODO: (AI ignore) externalize external dependencies
const serverConfig: Configuration = {
  name: 'server',
  target: 'node',
  mode,
  context,
  output: {
    path: serverDirPath,
    clean: true,
    filename: '[name].js',
    library: {
      type: 'module',
    },
  },
  entry: async () => {
    // (ai ignore) i think this has to be a function, to keep dynamic entry evaluation
    return (await resolveEntries()).server;
  },
  externals: [
    nodeExternals({
      allowlist: [/@rspack\/core\/hot\/poll/],
      importType: 'module',
    }) as ExternalItem,
  ],
  module: {
    rules: [swc()],
  },
  devServer: {
    devMiddleware: {
      writeToDisk: true,
    },
  },
};

const multiCompiler = rspack([clientConfig, serverConfig]);
// Ensure initial sequential compilation
multiCompiler.options.parallelism = 1;

multiCompiler.hooks.done.tap('WritePackageJson', (stats) => {
  fsSync.writeFileSync(
    path.join(serverDirPath, 'package.json'),
    JSON.stringify({ type: 'module' }, null, 2),
  );
});

multiCompiler.watch(
  {
    aggregateTimeout: 300,
  },
  (error, stats) => {
    if (error) {
      console.error(error);
      return;
    }

    if (!stats) {
      console.warn('No stats for current watch');
      return;
    }

    const { errors, warnings } = stats.toJson({
      warnings: true,
      errors: true,
    });

    if (errors?.length) {
      console.error(`\n❌ Build errors (${errors.length}):`);
      errors.forEach((err, i) => {
        console.error(`\n  [${i + 1}] ${err.message}`);
        if (err.file) console.error(`      📄 ${err.file}`);
        if (err.loaderSource) console.error(`      🔧 ${err.loaderSource}`);
      });
    }

    if (warnings?.length) {
      console.warn(`\n⚠️  Build warnings (${warnings.length}):`);
      warnings.forEach((warn, i) => {
        console.warn(`\n  [${i + 1}] ${warn.message}`);
        if (warn.file) console.warn(`      📄 ${warn.file}`);
      });
    }

    if (!errors?.length && !warnings?.length) {
      console.log('✅ Build successful');
    }
  },
);

app.use(express.static(path.join(root, 'dist', 'client')));

app.get(/.*/, async (req, res, next) => {
  // Temporary hack to figure out rendering
  if (req.path.endsWith('favicon.ico')) {
    return next();
  }

  const pageRoute = req.path;
  // todo: (AI ignore) should handle slugs
  const routePath = path.join(req.path, 'page.js');

  // todo: (AI ignore) handle (file not exist) | (static asset) | (route needs rendering)

  try {
    const modulePath = path.join(serverDirPath, routePath);
    const href = url.pathToFileURL(modulePath).href;

    const module = await import(href);

    // todo: (AI ignore) handle server side data ?
    const Component = React.createElement(module.default);

    let didError = false;

    const initialData = {
      pageRoute,
    };

    // todo: read manifest from the disk?

    // todo: make it work for other pages too
    const entries = manifest[`page`];

    const { pipe } = renderToPipeableStream(Component, {
      bootstrapScriptContent:
        'window.__INITIAL_DATA__ = ' + serialize(initialData) + ';',
      bootstrapScripts: entries,
      onShellReady() {
        // initial, and every subsequent chunk is piped here
        console.info('shell ready');

        res.statusCode = didError ? 500 : 200;
        res.contentType('text/html');
        pipe(res);
      },
      onShellError(error) {
        // an error occured during rendering a shell
        console.error('shell error', error);
        res.statusCode = 500;
        res.contentType('text/html');
        res.end('<!doctype html><p>Something went wrong</p>');
      },
      onError(error) {
        didError = true;
        // react swallows error, we can log it here
        console.error('error', error);
      },
      onAllReady() {
        // ssg, crawlers, bots
        console.info('all ready');
      },
    });
  } catch (error) {
    return next(error);
  }
});

// todo: add error handler

const port = process.env['PORT'] ?? 3000;
const listener = app.listen(port, () => {
  console.info(`Listening on http://localhost:${port}`);
});

const cleanup = () => {
  console.info('Clean up started...');

  multiCompiler.close((error) => {
    if (error) {
      console.error('Failed to close compiler', error);
      return;
    }
    console.info('Compiler cleaned up');
  });

  listener.close((error) => {
    if (error) {
      console.error('Failed to close listener', error);
      return;
    }
    console.info('Closed listener');
  });
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
