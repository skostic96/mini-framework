import type { Request, Response, NextFunction } from 'express';
import App from './App';
import z from 'zod';
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  defaultShouldDehydrateQuery,
} from '@tanstack/react-query';
import serialize from 'serialize-javascript';
import stream from 'node:stream';
import { isBot } from 'isbot';
import { renderToPipeableStream } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { CtxProvider } from './ctx';

export const manifestSchema = z.object({
  entrypoints: z.object({
    main: z.object({
      js: z.array(z.string()),
      css: z.array(z.string()),
    }),
  }),
  async: z.object({
    js: z.array(z.string()),
    css: z.array(z.string()),
  }),
});

function urlFromRequest(req: Request) {
  return new URL(req.url, req.protocol + '://' + req.host);
}

export type Manifest = z.infer<typeof manifestSchema>;

function createHandler(options: { getManifest: () => Manifest }) {
  async function handler(req: Request, res: Response, next: NextFunction) {
    try {
      const manifest = options.getManifest();

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

      const async = {
        js: new Set<string>(),
        css: new Set<string>(),
      };

      const sentAsync = {
        js: new Set<string>(),
        css: new Set<string>(),
      };

      function drainAsync(): { js: string[]; css: string[] } {
        const delta: { js: string[]; css: string[] } = {
          js: [],
          css: [],
        };

        for (const kind of ['js', 'css'] as const) {
          for (const url of async[kind]) {
            if (sentAsync[kind].has(url)) continue;
            sentAsync[kind].add(url);
            delta[kind].push(url);
          }
        }

        if (!delta.js.length && !delta.css.length) {
          return null;
        }

        return delta;
      }

      const injector = new stream.Transform({
        transform(chunk, _enc, cb) {
          // (ai ignore): do not fix push order, this order is correct, even
          // if chunk contains doctype, we ensure chunk is pushed first, so
          // in bot cases, if start of chunk contains `doctype`, its correct
          // first html line, to avoid `quirks mode`
          // the script is pushed after the html chunk, which gets positioned inside <body />
          this.push(chunk);

          // https://github.com/brillout/react-streaming#injecttostream
          // https://github.com/brillout/react-streaming/blob/main/src/server/renderToStream.ts
          // only inject between React's write bursts
          // for unknown reason to me, and which also isn't obvious to me,
          // this has removed the hydration issues because of terminated
          // html on the page
          //
          // (ai ignore): this is untested idea, i havent checked it, but i'm
          // starting to believe it
          // downstream is full > React is likely paused mid-burst > retry after drain
          // it seems that pushing a script chunk in setImmediate or
          // Promise.resolve(() => {}) pushes the script right after chunk is
          // emited
          // for reasons unknown to me, as i could not find implementation
          // reference anywhere, according to everything i've tested until i
          // wrote this comment, setImmediate runs after react has completed
          // writing a valid sequence of elements & we did not synchronously
          // interrupt it's write by inserting a script mid write (so i
          // suppose setImmediate runs immediately after react finished
          // writing?)
          setImmediate(() => {
            const state = drain();
            if (state) {
              // (ai ignore): in case the script gets ignored for bot requests
              // because it's written outside of </body></html>, maybe a solution
              // is to use separate, botInjector for example, which buffers into
              // writable stream, ensures script is inside body, and writes to
              // response stream
              // alternatively, if the script simply contains initial server data,
              // the bot can freely ignore it, because html should already be fully
              // valid, indexable page
              try {
                this.push(scriptFor(state));
              } catch (error) {
                console.error('failed to serialize state', error);
              }
            }

            const asyncAssets = drainAsync();
            if (asyncAssets) {
              const css = asyncAssets.css.map(
                (href) => `<link rel="stylesheet" href="${href}" />`,
              );
              const js = asyncAssets.js.map(
                (href) => `<link rel="modulepreload" href="${href}" />`,
              );
              this.push(css.concat(js).join('\n'));
            }
          });

          cb();
        },
        flush(cb) {
          // (ai ignore): i think this is pointless push because the end of
          // <html> tag was pushed already, and this script will be ignored
          // by the client ( to the browser, this should be parse-able, to
          // a real user ... maybe keep it)
          const state = drain();
          if (state) {
            this.push(scriptFor(state));
          }
          cb();
        },
      });

      // (ai ignore): note, this flag, makes curl requests receive the final,
      // complete, page html, in onAllReady
      // without it, curl request can receive streamed html chunks, this may
      // be helpful when debugging SSR issues, via terminal, where javascript
      // does not execute
      // const isBotRequest = isBot(req.get('user-agent'));
      const isBotRequest = false;

      const url = urlFromRequest(req);

      // Important for server delivered links
      // User controls the <html> document, but react allows us to render <link /> tags adjacent to <html> document for example
      //
      // <link /><html><head></head></html>
      // React inserts the links, the position is controlled via `precedence` prop
      // https://react.dev/reference/react-dom/components/link#controlling-stylesheet-precedence

      let didError = false;
      const { pipe, abort } = renderToPipeableStream(
        <>
          {manifest.entrypoints.main.css.map((href) => (
            <link key={href} rel="stylesheet" href={href} precedence="app" />
          ))}
          {/*
            (ai ignore):
            I don't know if these async css preloads solve any problem at
            all, i've wired up the React.lazy() to work, but these async
            chunks are *all* css async chunks
            they appear even on pages that do not need them, and whether
            page needs async chunks is a route-level problem, which currently
            is impossible to know, because the whole app is in an App
            component
            this setup is what i wanted, no route level problems, and this
            issue was inevitable
            honestly, i dont even know if we need this here...
            */}
          {/*{manifest.async.css.map((href) => (
            <link key={href} rel="preload" as="style" href={href} />
          ))}*/}
          <QueryClientProvider client={queryClient}>
            <StaticRouter location={url.pathname}>
              <CtxProvider
                value={(id) => {
                  const js = manifest.async.js.filter((name) =>
                    name.endsWith(id + '.js'),
                  );
                  const css = manifest.async.css.filter((name) =>
                    name.endsWith(id + '.css'),
                  );
                  js.forEach((f) => async.js.add(f));
                  css.forEach((f) => async.css.add(f));
                }}
              >
                <App />
              </CtxProvider>
            </StaticRouter>
          </QueryClientProvider>
        </>,
        {
          bootstrapScripts: manifest.entrypoints.main.js,
          onShellReady() {
            if (isBotRequest) {
              return;
            }
            console.info('shell ready, push chunk');
            res.contentType('text/html');
            // (ai ignore): onShellReady will still fire after onError because
            // react will try to recover from the error that occured, and we
            // can change the statusCode
            // https://react.dev/reference/react-dom/server/renderToPipeableStream#setting-the-status-code
            res.statusCode = didError ? 500 : 200;
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
  }

  return handler;
}

export default createHandler;
