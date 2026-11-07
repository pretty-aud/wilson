// =============================================================================
// storage/patiently.js — MO1 (0120): one more try, for the two things that pass.
//
// storage-presign's budget is a fixed window of a clock minute, and a move's copy through a company's own bucket
// spends up to five calls: its get, put and look, and its picture's get and put. A big batch reaches 240 a minute
// in about 50 files, and left to throw it would abort the whole move at that file, and its clean-up would meet the
// same refusal. So wait the window out, once. A server or a bucket that did not answer gets one try too. A refusal
// is an answer, and is not tried again: nothing here turns a 403 into a wait.
// =============================================================================

const WINDOW_MS = 60_000
const FAULT_WAIT_MS = 2_000

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

export async function patiently(fn, { wait = sleep, now = () => Date.now() } = {}) {
  try {
    return await fn()
  } catch (err) {
    const status = err?.status
    if (status === 429) await wait(WINDOW_MS - (now() % WINDOW_MS) + 500)
    else if (status === 0 || status >= 500) await wait(FAULT_WAIT_MS)
    else throw err
    return fn()
  }
}
