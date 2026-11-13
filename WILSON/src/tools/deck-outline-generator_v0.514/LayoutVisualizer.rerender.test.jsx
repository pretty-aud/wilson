/** @vitest-environment jsdom */
// =============================================================================
// LayoutVisualizer.rerender.test.jsx — the slide preview draws once (F4,
// 2026-11-13; the review's dog-otter C3 and OUTSTANDING P1-16).
//
// The measurement and the pin are one test (the brief's list item 1e):
//
//   1. THE PLACEHOLDERS. Ten keystrokes in a field beside the preview (its own
//      props untouched) and the two placeholder components are counted by the
//      render spy: how often each was MOUNTED, how often the preview ran, and
//      whether the placed picture is still the same <img> element afterwards.
//   2. P1-16. The preview mounted as the duplicate resolver mounts it, with no
//      `placementAssets` at all, watched for 150 ms: how many times React
//      committed it, and whether React said "Maximum update depth exceeded".
//
// MEASURED BEFORE F4's change (2026-11-13, this file at the brief's tip
// a71cd144, both tests red): ten keystrokes ran the preview 10 times and
// mounted ImagePlaceholder 10 times and IconLogoPlaceholder 10 times (one of
// each on the slide: a new component type per render, so React builds each
// again), and the placed picture's <img> was a different element afterwards;
// the resolver's mount committed 98 to 115 times in 150 ms over five runs and
// React logged "Maximum update depth exceeded" once or twice each run: P1-16
// reproduced.
//
// AFTER (the commit that put the two placeholders above the component, gave
// placementAssets one default list, memoized the parse and put the preview
// under React.memo): ten keystrokes run the preview 0 times and mount neither
// placeholder; the resolver's mount settles in a handful of commits and React
// says nothing. The rest of this file is what the change must not cost: the
// preview still follows its own props (a theme, the slide's words, a
// picture's measured shape), and a placed picture has one object URL for as
// long as a frame shows it.
// =============================================================================
import { renderSpy } from '../../lib/renderSpy'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The parse, counted: every importer of parseSlideContent gets this one, the preview among them.
const parses = vi.hoisted(() => ({ count: 0 }))
vi.mock('./parser', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, parseSlideContent: (...args) => { parses.count++; return real.parseSlideContent(...args) } }
})

const { default: LayoutVisualizer } = await import('./LayoutVisualizer')
const here = dirname(fileURLToPath(import.meta.url))

// One slide in the generator's own format: a picture (placed, by its
// <<file>> marker) and a logo, on the default Title and Body layout.
const SLIDE = [
  'SLIDE #2 — [LAYOUT TYPE: Title and Body]',
  '▸ TITLE:',
  '  The lighthouse at dusk',
  '▸ SUBTITLE: Five pages',
  '▸ LAYOUT STRUCTURE:',
  '  Text on the left, the image on the right',
  '▸ COPY/TEXT CONTENT:',
  '  • The first point',
  '  • The second point',
  '▸ REQUIRED ASSETS:',
  '  • [Image | 16:9] - Hero shot of the lamp room <<lamp-room.png>>',
  '  • [Icon/Logo] - The keeper\'s mark',
].join('\n')

// A one-pixel PNG, as D.O.G. holds an attached picture (base64, no data: prefix).
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const ASSETS = [{ file: { name: 'lamp-room.png' }, type: 'image', mediaType: 'image/png', content: PIXEL }]

function Bench({ assets = ASSETS }) {
  const [typed, setTyped] = useState('')
  return (
    <div>
      <input aria-label="beside the preview" value={typed} onChange={(e) => setTyped(e.target.value)} />
      <LayoutVisualizer content={SLIDE} placementAssets={assets} />
    </div>
  )
}

const quiet = () => {
  // The preview logged every parse until F4 (two lines a render); the counts below do not need them.
  vi.spyOn(console, 'log').mockImplementation(() => {})
}

// This DOM loads no pictures, and its object URLs are whatever the runtime under it makes. A test that
// counts either gives the page its own.
const made = { urls: [], revoked: [] }
const realUrls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
function withObjectUrls() {
  made.urls = []; made.revoked = []
  URL.createObjectURL = (blob) => { const url = `blob:test/${made.urls.length + 1}`; made.urls.push({ url, type: blob.type, size: blob.size }); return url }
  URL.revokeObjectURL = (url) => { made.revoked.push(url) }
}
const realImage = window.Image
/** Every picture the preview measures "loads" a turn later, at this shape. */
function picturesLoadAt(width, height) {
  window.Image = class { set src(_value) { this.naturalWidth = width; this.naturalHeight = height; setTimeout(() => this.onload?.(), 0) } }
}
const turn = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })

afterEach(async () => {
  cleanup()
  // A picture's URL is let go a turn after its last frame is gone: that turn, before the next test counts.
  await new Promise((resolve) => setTimeout(resolve, 5))
  vi.restoreAllMocks(); renderSpy.reset()
  URL.createObjectURL = realUrls.create; URL.revokeObjectURL = realUrls.revoke
  window.Image = realImage
})

async function typeTen(input) {
  for (let i = 1; i <= 10; i++) {
    await act(async () => { fireEvent.change(input, { target: { value: 'lighthouse'.slice(0, i) } }) })
  }
}

describe('the slide preview across ten keystrokes beside it', () => {
  it('draws the slide: one picture frame, one logo mark, the placed picture in its frame', () => {
    quiet()
    const view = render(<Bench />)
    expect(renderSpy.mounts('ImagePlaceholder')).toBe(1)
    expect(renderSpy.mounts('IconLogoPlaceholder')).toBe(1)
    const img = view.container.querySelector('img[alt="lamp-room.png"]')
    expect(img).not.toBeNull()
    expect(view.container.textContent).toContain('The lighthouse at dusk')
  })

  it('the two placeholders are mounted ONCE: ten keystrokes mount neither again, and the preview does not run', async () => {
    quiet()
    const view = render(<Bench />)
    const picture = view.container.querySelector('img[alt="lamp-room.png"]')
    const mark = renderSpy.mark()
    await typeTen(view.getByLabelText('beside the preview'))
    expect(view.getByLabelText('beside the preview').value).toBe('lighthouse')
    expect(renderSpy.renders('Bench', mark)).toBe(10)                 // the keystrokes did render the parent
    expect({
      previewRuns: renderSpy.renders('LayoutVisualizer', mark),
      pictureMounts: renderSpy.mounts('ImagePlaceholder', mark),
      logoMounts: renderSpy.mounts('IconLogoPlaceholder', mark),
      // The placed picture is the element it was: not built and decoded again.
      samePicture: view.container.querySelector('img[alt="lamp-room.png"]') === picture,
    }).toEqual({ previewRuns: 0, pictureMounts: 0, logoMounts: 0, samePicture: true })
  })
})

// ── When the preview IS drawn again ──────────────────────────────────────────
// React.memo keeps the preview from running for somebody else's change. For
// its OWN changes (another theme, the slide's words edited) it must run, and
// then the frames on the slide are the frames they were: that is what the two
// placeholders standing above the component buys, and the memo alone does not.
const THEME_A = ['#1c1917', '#fafaf9', '#fb923c', '#a8a29e']
const THEME_B = ['#0c0a09', '#fef3c7', '#f59e0b', '#78716c']
const picture = () => ({ file: { name: 'lamp-room.png' }, type: 'image', mediaType: 'image/png', content: PIXEL })
const NO_PICTURE = SLIDE.replace(' <<lamp-room.png>>', '')

describe('the preview drawn again for a change of its own', () => {
  it('another theme: the preview runs once, no frame is mounted again, the placed picture is the element it was, and the slide is not parsed again', () => {
    quiet()
    const assets = [picture()]
    const view = render(<LayoutVisualizer content={SLIDE} placementAssets={assets} overrideColors={THEME_A} />)
    const img = view.container.querySelector('img[alt="lamp-room.png"]')
    const parsedBefore = parses.count
    const mark = renderSpy.mark()
    view.rerender(<LayoutVisualizer content={SLIDE} placementAssets={assets} overrideColors={THEME_B} />)
    expect({
      previewRuns: renderSpy.renders('LayoutVisualizer', mark),
      pictureMounts: renderSpy.mounts('ImagePlaceholder', mark),
      logoMounts: renderSpy.mounts('IconLogoPlaceholder', mark),
      samePicture: view.container.querySelector('img[alt="lamp-room.png"]') === img,
      parses: parses.count - parsedBefore,
    }).toEqual({ previewRuns: 1, pictureMounts: 0, logoMounts: 0, samePicture: true, parses: 0 })
  })

  it('the frames follow the theme: an empty frame is drawn in the new theme\'s ink on its ground', () => {
    quiet()
    const view = render(<LayoutVisualizer content={NO_PICTURE} overrideColors={THEME_A} />)
    const frame = () => view.container.querySelector('.border-dashed.flex-col')
    const before = { border: frame().style.borderColor, ground: frame().style.backgroundColor }
    view.rerender(<LayoutVisualizer content={NO_PICTURE} overrideColors={THEME_B} />)
    const after = { border: frame().style.borderColor, ground: frame().style.backgroundColor }
    expect(before.border).not.toBe('')
    expect(after.border).not.toBe(before.border)
    expect(after.ground).not.toBe(before.ground)
  })

  it('the slide\'s words edited: parsed once more, and the new words are on the slide', () => {
    quiet()
    const view = render(<LayoutVisualizer content={SLIDE} placementAssets={ASSETS} />)
    const parsedBefore = parses.count
    view.rerender(<LayoutVisualizer content={SLIDE.replace('The lighthouse at dusk', 'The lighthouse at dawn')} placementAssets={ASSETS} />)
    expect(parses.count - parsedBefore).toBe(1)
    expect(view.container.textContent).toContain('The lighthouse at dawn')
    expect(view.container.textContent).not.toContain('The lighthouse at dusk')
  })

  it('a placed picture\'s frame takes the picture\'s own shape once it is measured (the shapes reach the frames)', async () => {
    quiet()
    picturesLoadAt(400, 100)
    const view = render(<LayoutVisualizer content={SLIDE} placementAssets={[picture()]} />)
    const frame = () => view.container.querySelector('img[alt="lamp-room.png"]').parentElement
    expect(frame().style.aspectRatio).toBe('16/9')              // the slide's own word for it, until the picture is measured
    await turn()
    expect(frame().style.aspectRatio).toBe('400/100')
  })
})

// ── A placed video (review round 1) ─────────────────────────────────────────
// A frame is kept across renders now, and the video thumbnail in it keeps the
// first frame it read: handed another video it showed the first one's picture
// under the second one's name. It is keyed by its video: another video is
// another thumbnail, the same video across a redraw is the one it was.
const videoSlide = (file) => SLIDE.replace('[Image | 16:9] - Hero shot of the lamp room <<lamp-room.png>>', `[Video | 16:9] - The lamp turning <<${file}>>`)
const video = (name) => ({ file: { name }, type: 'video', mediaType: 'video/mp4', content: btoa(`the bytes of ${name}`) })

describe('a placed video (review round 1)', () => {
  it('another video in the same frame is another thumbnail; the same video across a redraw is kept', () => {
    quiet()
    const assets = [video('a.mp4'), video('b.mp4')]
    const view = render(<LayoutVisualizer content={videoSlide('a.mp4')} placementAssets={assets} overrideColors={THEME_A} />)
    expect(renderSpy.mounts('VideoThumbnail')).toBe(1)
    expect(view.container.textContent).toContain('a.mp4')
    let mark = renderSpy.mark()
    view.rerender(<LayoutVisualizer content={videoSlide('a.mp4')} placementAssets={assets} overrideColors={THEME_B} />)
    expect(renderSpy.renders('LayoutVisualizer', mark)).toBe(1)                // the preview did draw again
    expect(renderSpy.mounts('VideoThumbnail', mark)).toBe(0)
    mark = renderSpy.mark()
    view.rerender(<LayoutVisualizer content={videoSlide('b.mp4')} placementAssets={assets} overrideColors={THEME_B} />)
    expect(view.container.textContent).toContain('b.mp4')
    expect(renderSpy.mounts('ImagePlaceholder', mark)).toBe(0)                 // the frame is the frame it was
    expect(renderSpy.mounts('VideoThumbnail', mark)).toBe(1)                   // and its thumbnail is b's own
  })
})

// ── A placed picture's URL ───────────────────────────────────────────────────
describe('a placed picture: one object URL, for as long as a frame shows it', () => {
  it('the frame is given an object URL of the picture\'s bytes and type, not its base64 text', () => {
    quiet(); withObjectUrls()
    const view = render(<LayoutVisualizer content={SLIDE} placementAssets={[picture()]} />)
    expect(made.urls).toEqual([{ url: 'blob:test/1', type: 'image/png', size: atob(PIXEL).length }])
    expect(view.container.querySelector('img[alt="lamp-room.png"]').getAttribute('src')).toBe('blob:test/1')
  })

  it('ONE for the picture: the preview drawn again makes no other, and a second preview of the same picture shares it', async () => {
    quiet(); withObjectUrls()
    const assets = [picture()]
    const one = render(<LayoutVisualizer content={SLIDE} placementAssets={assets} overrideColors={THEME_A} />)
    one.rerender(<LayoutVisualizer content={SLIDE} placementAssets={assets} overrideColors={THEME_B} />)
    one.rerender(<LayoutVisualizer content={SLIDE.replace('dusk', 'dawn')} placementAssets={assets} overrideColors={THEME_B} />)
    const two = render(<LayoutVisualizer content={SLIDE} placementAssets={assets} compact />)
    expect(made.urls).toHaveLength(1)
    expect(two.container.querySelector('img[alt="lamp-room.png"]').getAttribute('src')).toBe('blob:test/1')
    // One of the two goes: the other still shows it, so it is kept.
    two.unmount()
    await turn()
    expect(made.revoked).toEqual([])
    // The last one goes: revoked, once.
    one.unmount()
    await turn()
    expect(made.revoked).toEqual(['blob:test/1'])
  })

  it('a picture taken off the slide lets its URL go; put back, it is given a new one', async () => {
    quiet(); withObjectUrls()
    const assets = [picture()]
    const view = render(<LayoutVisualizer content={SLIDE} placementAssets={assets} />)
    view.rerender(<LayoutVisualizer content={NO_PICTURE} placementAssets={assets} />)
    await turn()
    expect(made.revoked).toEqual(['blob:test/1'])
    view.rerender(<LayoutVisualizer content={SLIDE} placementAssets={assets} />)
    expect(made.urls.map((u) => u.url)).toEqual(['blob:test/1', 'blob:test/2'])
    expect(view.container.querySelector('img[alt="lamp-room.png"]').getAttribute('src')).toBe('blob:test/2')
  })

  it('a dev build mounts everything twice (StrictMode): still one URL, and it is not revoked under the frame that shows it', async () => {
    quiet(); withObjectUrls()
    const view = render(<StrictMode><LayoutVisualizer content={SLIDE} placementAssets={[picture()]} /></StrictMode>)
    await turn()
    expect(made.urls).toHaveLength(1)
    expect(made.revoked).toEqual([])
    expect(view.container.querySelector('img[alt="lamp-room.png"]').getAttribute('src')).toBe('blob:test/1')
  })

  it('where the page cannot make one, the frame is given the data: URL it was given before', () => {
    quiet()
    URL.createObjectURL = undefined
    const view = render(<LayoutVisualizer content={SLIDE} placementAssets={[picture()]} />)
    expect(view.container.querySelector('img[alt="lamp-room.png"]').getAttribute('src')).toBe(`data:image/png;base64,${PIXEL}`)
  })

  it('a picture whose text is not base64 is given the data: URL too, and nothing throws', () => {
    quiet(); withObjectUrls()
    const odd = { ...picture(), content: 'not base64 !!' }
    const view = render(<LayoutVisualizer content={SLIDE} placementAssets={[odd]} />)
    expect(made.urls).toEqual([])
    expect(view.container.querySelector('img[alt="lamp-room.png"]').getAttribute('src')).toBe('data:image/png;base64,not base64 !!')
  })
})

// ── The source ───────────────────────────────────────────────────────────────
describe('the source', () => {
  const visualizer = readFileSync(resolve(here, 'LayoutVisualizer.jsx'), 'utf8')
  const parser = readFileSync(resolve(here, 'parser.js'), 'utf8')
  const dog = readFileSync(resolve(here, 'DeckOutlineGenerator.jsx'), 'utf8')
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the two placeholders are declared once each, at the top of the module and not inside the component', () => {
    expect(visualizer.match(/^function ImagePlaceholder\(/gm)).toHaveLength(1)
    expect(visualizer.match(/^function IconLogoPlaceholder\(/gm)).toHaveLength(1)
    expect(code(visualizer)).not.toMatch(/^[ \t]+(const|function) (ImagePlaceholder|IconLogoPlaceholder)\b/m)
    // And before the component, which is the last thing the module declares.
    expect(visualizer.indexOf('function IconLogoPlaceholder(')).toBeLessThan(visualizer.indexOf('const LayoutVisualizer = ('))
  })

  it('placementAssets defaults to one list for the module, and the component is exported under React.memo', () => {
    expect(visualizer).toMatch(/^const NO_ASSETS = Object\.freeze\(\[\]\);$/m)
    expect(visualizer).toMatch(/placementAssets = NO_ASSETS,/)
    expect(code(visualizer)).not.toMatch(/placementAssets = \[\]/)
    expect(visualizer).toMatch(/^export default memo\(LayoutVisualizer\);$/m)
  })

  it('neither the preview nor the parser logs', () => {
    expect(code(visualizer)).not.toMatch(/console\.log/)
    expect(code(parser)).not.toMatch(/console\.log/)
  })

  it('D.O.G. hands the preview no function or object written in its tag (each would be a new prop at every render)', () => {
    const tag = dog.slice(dog.indexOf('<LayoutVisualizer'), dog.indexOf('/>', dog.indexOf('<LayoutVisualizer')))
    expect(tag.length).toBeGreaterThan(300)
    const props = [...tag.matchAll(/^\s+([A-Za-z]+)=\{(.*)\}$/gm)].map((m) => [m[1], m[2]])
    expect(props.map(([name]) => name)).toEqual(['content', 'overrideColors', 'onRefreshColors', 'onCycleTheme', 'themeName', 'themeIndex', 'themeCount', 'isGeneratingTheme', 'onContentChange', 'onTextContextMenu', 'placementAssets', 'zoomLevel'])
    for (const [name, value] of props) expect(value, name).not.toMatch(/=>|^\{|^\[|\bfunction\b/)
    expect(dog).toMatch(/onContentChange=\{handleVisualizerContentChange\}/)
    expect(dog).toMatch(/const handleVisualizerContentChange = useCallback\(/)
  })
})

describe('P1-16: the preview as the duplicate resolver mounts it (no placementAssets)', () => {
  it('settles: a handful of commits in 150 ms, and React says nothing about update depth', async () => {
    quiet()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Outside act, on purpose: inside it a preview that never settles would
    // never hand control back. React's own scheduler runs the loop here, and
    // the wait below lets it.
    const wasAct = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const mark = renderSpy.mark()
    try {
      root.render(<LayoutVisualizer content={SLIDE} compact />)
      await new Promise((resolve) => setTimeout(resolve, 150))
    } finally {
      root.unmount()
      host.remove()
      globalThis.IS_REACT_ACT_ENVIRONMENT = wasAct
    }
    const commits = renderSpy.since(mark).filter((commit) => commit.some((entry) => entry.name === 'LayoutVisualizer')).length
    const depthWarnings = errors.mock.calls.filter((call) => String(call[0]).includes('Maximum update depth exceeded')).length
    expect(depthWarnings, `React logged "Maximum update depth exceeded" (the preview committed ${commits} times in 150 ms)`).toBe(0)
    expect(commits, 'commits of the preview in 150 ms').toBeLessThanOrEqual(3)
  })
})
