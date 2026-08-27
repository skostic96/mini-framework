// repro.tsx — run with: npx tsx repro.tsx
import React, { Suspense, use } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import stream from 'node:stream';

// big boundary => one flush burst of ~300KB, way over our buffers
const data = new Promise<number[]>((r) =>
  setTimeout(() => r(Array.from({ length: 5000 }, (_, i) => i)), 50),
);
function Big() {
  const rows = use(data);
  return (
    <ul>
      {rows.map((i) => (
        <li key={i} className="row-item-long-classname">
          row {i}
        </li>
      ))}
    </ul>
  );
}
function App() {
  return (
    <html>
      <body>
        <div id="shell">shell</div>
        <Suspense fallback={<p>loading</p>}>
          <Big />
        </Suspense>
      </body>
    </html>
  );
}

// fake "state ready to inject" — becomes non-null right when the burst starts
let pendingState: string | null = null;
const drain = () => {
  const s = pendingState;
  pendingState = null;
  return s;
};

// give each injection a unique, findable marker
let n = 0;
const scriptFor = () => `<script>/*__MARKER_${n++}__*/</script>`;

let scheduled = false;
const injector = new stream.Transform({
  writableHighWaterMark: 64, // <-- tiny: React sees write() === false quickly
  readableHighWaterMark: 64,
  transform(chunk, _enc, cb) {
    pendingState ??= 'x'; // pretend a query resolved during the burst
    this.push(chunk);
    if (!scheduled) {
      scheduled = true;
      process.nextTick(() => {
        // the UNGUARDED version (no writableNeedDrain check — injects mid-burst)
        scheduled = false;
        // harness plumbing, NOT the fix under test: don't push after flush()
        // has already ended the stream, or Node kills the pipeline with
        // ERR_STREAM_PUSH_AFTER_EOF and `finish` never fires
        if (injector.writableEnded || injector.destroyed) return;
        console.log('inject; writableNeedDrain =', injector.writableNeedDrain);
        const s = drain();
        if (s) this.push(scriptFor());
      });
    }
    cb();
  },
  flush(cb) {
    // mirror the real server: final drain at end-of-render
    const s = drain();
    if (s) this.push(scriptFor());
    cb();
  },
});

// slow consumer with a tiny buffer — this is what creates backpressure
const out: Buffer[] = [];
const slowSink = new stream.Writable({
  highWaterMark: 64,
  write(chunk, _enc, cb) {
    out.push(chunk);
    setTimeout(cb, 5);
  },
});

injector.on('error', (e) => console.error('injector error', e));
slowSink.on('error', (e) => console.error('sink error', e));
slowSink.on('close', () => console.log('sink closed'));

slowSink.on('finish', () => {
  const html = Buffer.concat(out).toString();
  const re = /<script>\/\*__MARKER_(\d+)__\*\/<\/script>/g;
  let m: RegExpExecArray | null;
  let corrupted = 0;
  while ((m = re.exec(html))) {
    const before = html.slice(0, m.index);
    const lastOpen = before.lastIndexOf('<');
    const lastClose = before.lastIndexOf('>');
    const midTag = lastOpen > lastClose;
    console.log(
      `MARKER_${m[1]} @ ${m.index}: ${midTag ? '💥 SPLITS A TAG' : 'between tags'}`,
    );
    console.log('  …' + html.slice(Math.max(0, m.index - 100), m.index) + '▮');
    if (midTag) corrupted++;
  }
  console.log(
    corrupted
      ? `VERDICT: ${corrupted} corrupted injection(s) — INVALID HTML`
      : 'VERDICT: no mid-tag splits this run',
  );
  process.exitCode = corrupted ? 1 : 0;
});

const { pipe } = renderToPipeableStream(<App />, {
  onShellReady() {
    console.log('shell ready, piping');
    pipe(injector).pipe(slowSink);
  },
  onShellError(e) {
    console.error('SHELL ERROR', e);
  },
  onError(e) {
    console.error('RENDER ERROR', e);
  },
  onAllReady() {
    console.log('all ready');
  },
});

process.on('beforeExit', () => console.log('process exiting, finish fired?'));
