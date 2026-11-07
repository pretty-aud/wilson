// =============================================================================
// storage/patiently.js — MO1 (0120): one more try, for the two things that pass.
//
// storage-presign's budget is a fixed window of a clock minute, and a move's copy through a company's own bucket
// spends up to five calls: its get, put and look, and its picture's get and put. A big batch reaches 240 a minute
// in about 50 files, and left to throw it would abort the whole move at that file, and its clean-up would meet the
// same refusal. So wait the window out, once. A presign or a look that the server could not answer gets one try too
// (only those carry a status: a bucket's own failed PUT or GET does not, and is the caller's to say). A refusal is an
// answer, and is not tried again: nothing here turns a 403 into a wait.
//
// The wait is a whole window and a bit, not the rest of this one: the window is the server's clock (0028), and a fast
// clock here would retry inside it and be refused again.
// =============================================================================

const WINDOW_MS = 60_000
const FAULT_WAIT_MS = 2_000

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

export async function patiently(fn, { wait = sleep } = {}) {
  try {
    return await fn()
  } catch (err) {
    const status = err?.status
    if (status === 429) await wait(WINDOW_MS + 500)
    else if (status === 0 || status >= 500) await wait(FAULT_WAIT_MS)
    else throw err
    return fn()
  }
}
