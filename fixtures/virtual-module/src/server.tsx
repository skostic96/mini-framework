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

export const manifestSchema = z.object({
  entrypoints: z.object({
    main: z.array(z.string()),
  }),
});

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
      const isBotRequest = isBot(req.get('user-agent'));

      const url = new URL(req.url, req.protocol + '://' + req.host);

      let didError = false;
      const { pipe, abort } = renderToPipeableStream(
        <QueryClientProvider client={queryClient}>
          <StaticRouter location={url.pathname}>
            <App />
          </StaticRouter>
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
  }

  return handler;
}

export default createHandler;
