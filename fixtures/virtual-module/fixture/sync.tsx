// repro-failing.tsx — the ORIGINAL bug: sync per-chunk injection
// run with: pnpm exec tsx repro-failing.tsx  → always exits 1
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

// fake "state ready to inject" — refilled on every chunk, like a query
// cache that keeps resolving during the burst
let pendingState: string | null = null;
const drain = () => {
  const s = pendingState;
  pendingState = null;
  return s;
};

let n = 0;
const scriptFor = () => `<script>/*__MARKER_${n++}__*/</script>`;

const injector = new stream.Transform({
  writableHighWaterMark: 64,
  readableHighWaterMark: 64,
  transform(chunk, _enc, cb) {
    pendingState ??= 'x';
    this.push(chunk);
    // ORIGINAL SERVER CODE: inject right here, between arbitrary
    // ~2KB slices of React's internal buffer → lands mid-tag
    const s = drain();
    if (s) this.push(scriptFor());
    cb();
  },
  flush(cb) {
    const s = drain();
    if (s) this.push(scriptFor());
    cb();
  },
});

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

slowSink.on('finish', () => {
  const html = Buffer.concat(out).toString();
  const re = /<script>\/\*__MARKER_(\d+)__\*\/<\/script>/g;
  let m: RegExpExecArray | null;
  let corrupted = 0;
  let total = 0;
  while ((m = re.exec(html))) {
    total++;
    const before = html.slice(0, m.index);
    if (before.lastIndexOf('<') > before.lastIndexOf('>')) {
      corrupted++;
      console.log(
        `MARKER_${m[1]} @ ${m.index}: SPLITS A TAG\n  …${html.slice(Math.max(0, m.index - 80), m.index)}|`,
      );
    }
  }
  console.log(
    corrupted
      ? `VERDICT: ${corrupted}/${total} corrupted injection(s) — INVALID HTML`
      : 'VERDICT: no mid-tag splits this run',
  );
  process.exitCode = corrupted ? 1 : 0;
});

const { pipe } = renderToPipeableStream(<App />, {
  onShellReady() {
    pipe(injector).pipe(slowSink);
  },
  onShellError(e) {
    console.error('SHELL ERROR', e);
  },
  onError(e) {
    console.error('RENDER ERROR', e);
  },
});
