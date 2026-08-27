# **AI GENERATED REPRODUCIBLE PROBLEM OF CHUNK WRITING MID HTML CHUNK**

Why the deferred inject never corrupts here

I claimed backpressure could pause React "mid-burst" and let your nextTick land between two mid-tag chunk slices. Watch what actually happens in this topology:

React writes its burst — each write() is one flushed ~2KB view.
Your transform's cb() is synchronous, so Node drains the entire queued write backlog in the same tick. Every React chunk written so far passes through transform() and gets pushed before any nextTick callback runs.
When React hits backpressure (write() → false), it stops issuing more data — but the data it already wrote ends at the end of a flush pass, which is always a complete-boundary edge. The mid-tag splits only exist between chunks inside the backlog, and your inject can never get between those because they're all processed synchronously.
So by the time nextTick fires, the last pushed byte is at a safe boundary. Every time. writableNeedDrain = true just meant "buffers are full," not "React is mid-tag" — I over-read that signal.

Conclusion: deferring past the sync stack is sufficient in this pipeline (sync transform cb → response). The writableNeedDrain retry I pushed on you is optional hardening for exotic topologies (async cb), not a correctness requirement for yours. Your 0/20 is the fix passing.

```bash
$fails = 0
1..20 | ForEach-Object {
  $out = pnpm exec tsx .\fixtures\virtual-module\fixture\terminated-html.tsx 2>&1
  if ($out -match 'INVALID HTML') { $fails++ }
  if (-not ($out -match 'VERDICT')) { Write-Warning "run $_ produced no verdict"; $out | Write-Host }
}
"corrupted in $fails / 20 runs"
```
