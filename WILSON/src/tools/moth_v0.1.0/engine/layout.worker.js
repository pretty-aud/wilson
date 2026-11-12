// The layout worker (MO2a): the protocol lives in layoutWorkerCore.js; this
// file only wires it to the worker's global. Loaded by layoutClient.js as a
// module worker, so Vite emits it as its own chunk.
import { createLayoutWorkerCore } from './layoutWorkerCore.js'

const core = createLayoutWorkerCore({
  post: (message, transfer) => self.postMessage(message, transfer),
  schedule: (fn) => setTimeout(fn, 0),
  now: () => performance.now(),
})
self.onmessage = (event) => core.handle(event.data)
