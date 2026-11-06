// =============================================================================
// authContrast.test.js — Session 43's colour rule, in executable form.
//
// Audrey, 2026-08-10, in capitals: "DO NOT USE GRAY TEXT AGAINST ORANGE AS IT
// IS HARD TO SEE ONLY WHITE OR BLACK" / "keep the orange make the light text
// black instead."
//
// 🚨 The auth surfaces render on the LIGHT orange well (#f4a261), not on the
// dark orange bars — AuthShell paints #f4a261 across the middle and centres
// the content in it. That is easy to misread from a screenshot, and it
// inverts the correct answer: white measures 2.06:1 there. The screens shipped
// white for eighteen sessions.
//
// This asserts the MEASURED ratio of the actual exported tokens, so flipping
// AUTH_INK back to '#fff' fails a test instead of shipping. A comment saying
// "must be black" would not have caught it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  AUTH_INK, AUTH_ERROR_INK, AUTH_TEXT_STYLE,
  AUTH_BUTTON_STYLE, AUTH_BUTTON_QUIET_STYLE,
} from './AuthShell'

// The two surfaces auth content can sit on. AuthShell owns both.
const WELL = '#f4a261'   // light orange — the content area between the bars
const BARS = '#ea580c'   // dark orange — the panels themselves

function luminance(hex) {
  let n = hex.replace('#', '')
  // Expand #fff → #ffffff. Without this the slices below yield NaN and every
  // ratio silently becomes NaN, which fails an assertion in a way that looks
  // like a contrast problem rather than a parsing one. (It did exactly that.)
  if (n.length === 3) n = n.split('').map((c) => c + c).join('')
  if (n.length !== 6) throw new Error(`unparseable colour: ${hex}`)
  const parts = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const [r, g, b] = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

describe('the auth ink survives the surface it actually sits on', () => {
  it('AUTH_INK clears AA on the light-orange well', () => {
    expect(contrast(AUTH_INK, WELL)).toBeGreaterThanOrEqual(4.5)
  })

  it('AUTH_TEXT_STYLE.color IS AUTH_INK — the style is what components spread', () => {
    // Asserting the constant alone would pass while the style object carried
    // something else. The style object is the thing that reaches the DOM.
    expect(AUTH_TEXT_STYLE.color).toBe(AUTH_INK)
  })

  it('white would NOT clear it — this is why the rule exists', () => {
    // The control. Without it, "AUTH_INK passes" proves nothing about whether
    // the threshold is meaningful on this background.
    expect(contrast('#ffffff', WELL)).toBeLessThan(3)
  })

  it('the error ink clears AA on the well, where #ef4444 does not', () => {
    expect(contrast(AUTH_ERROR_INK, WELL)).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ef4444', WELL)).toBeLessThan(3)
  })

  it('the primary button label clears AA on its own fill', () => {
    // Audrey, 2026-08-10: "lets round the corners. lets also make it a
    // different darker orange. not the same as the header and footer."
    //
    // Asserting the RATIO rather than the hex: whichever fill is chosen, the
    // label has to survive on it. Going darker is what flipped the label back
    // to white — see the control below.
    expect(AUTH_BUTTON_STYLE.border).toBe('none')
    expect(contrast(AUTH_BUTTON_STYLE.color, AUTH_BUTTON_STYLE.background))
      .toBeGreaterThanOrEqual(4.5)
  })

  it('the button fill is NOT the bar orange — it must read as a distinct surface', () => {
    // The literal instruction. #ea580c is the header/footer.
    expect(AUTH_BUTTON_STYLE.background).not.toBe(BARS)
    // And it must actually be darker, not merely different.
    expect(luminance(AUTH_BUTTON_STYLE.background)).toBeLessThan(luminance(BARS))
  })

  it('the label choice is forced by the fill, not by taste — the control', () => {
    // On the BAR orange white fails (3.56:1) and black passes; on the darker
    // button fill it inverts. Pinning both directions means a future fill
    // change cannot quietly keep a label that no longer works.
    expect(contrast('#ffffff', BARS)).toBeLessThan(4.5)
    expect(contrast(AUTH_INK, AUTH_BUTTON_STYLE.background)).toBeLessThan(4.5)
  })

  it('no auth button is a white block', () => {
    // The earlier instruction, still in executable form, for both tokens.
    for (const style of [AUTH_BUTTON_STYLE, AUTH_BUTTON_QUIET_STYLE]) {
      expect(['#fff', '#ffffff', 'white']).not.toContain(String(style.background).toLowerCase())
    }
  })

  it('the secondary button is distinguishable from the primary', () => {
    // Now that the primary is filled, the secondary carries the outline. If
    // they ever converge, one of them is not doing its job.
    expect(AUTH_BUTTON_QUIET_STYLE.background).not.toBe(AUTH_BUTTON_STYLE.background)
    expect(AUTH_BUTTON_QUIET_STYLE.color).toBe(AUTH_INK)
    expect(contrast(AUTH_BUTTON_QUIET_STYLE.color, WELL)).toBeGreaterThanOrEqual(4.5)
  })

  it('AUTH_INK also clears AA on the dark orange bars', () => {
    // Nothing renders auth text on the bars today, but SPLIT_BAR_HEIGHT is a
    // tuned number and content that grows past the well lands here. One ink
    // that works on both surfaces means overflow degrades to ugly, not
    // invisible.
    expect(contrast(AUTH_INK, BARS)).toBeGreaterThanOrEqual(4.5)
  })
})

// =============================================================================
// UI overhaul D2 — the extension.
//
// The ten cases above are Session 43's and are untouched, deliberately: the
// plan says "extend `authContrast.test.js` rather than editing it", and the
// review's first risk is that a session quietly rewrites assertions which
// correctly encode Audrey's verbatim instructions. Everything below is new.
//
// Two differences from the block above, both on purpose:
//
//   - it imports the arithmetic from `src/ui/contrast.js` instead of carrying
//     a fourth copy. That module exists because this file's own three-digit
//     `#fff` bug had to be fixed in three places; the block above keeps its
//     private copy so its assertions are provably unchanged, and everything
//     new uses the shared one.
//   - it needs `over()`. Half the token set is alpha — rules, wells, tints,
//     the banner's own ground — and an alpha's real contrast is against the
//     blend, never against the raw channel values.
//
// Every ratio below was measured from these exact tokens before being written
// down. Each group ends with a FAILING CONTROL, because "the value passes"
// proves nothing about whether the threshold means anything on that ground.
// =============================================================================

import {
  AUTH_TITLE_STYLE, AUTH_LABEL_STYLE, AUTH_INPUT_STYLE, AUTH_HINT_STYLE,
  AUTH_LINK_STYLE, AUTH_PROSE_STYLE, AUTH_ERROR_STYLE, AUTH_FIELD_WIDTH,
  AUTH_BUTTON_BUSY_STYLE, AUTH_LINK_BUSY_STYLE, AUTH_GAP_WITHIN_FIELD,
  AUTH_GAP_BETWEEN_FIELDS, AUTH_GAP_BETWEEN_BLOCKS,
} from './AuthShell'
import {
  INK, INK_2, INK_3, PAPER, PAPER_RAISED, WARNING, INK_LIGHT, RULE_LIGHT,
  TYPE, TYPE_FLOOR,
} from '../../ui/tokens'
import { contrast as ratio, over } from '../../ui/contrast'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const authShellSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AuthShell.jsx'), 'utf8',
)

describe('the auth type kit sits on the scale and inside the case rule', () => {
  // Every role that carries a size, with the step it is supposed to be on.
  const ROLES = [
    ['AUTH_TITLE_STYLE', AUTH_TITLE_STYLE, TYPE.h1],
    ['AUTH_LABEL_STYLE', AUTH_LABEL_STYLE, TYPE.label],
    ['AUTH_INPUT_STYLE', AUTH_INPUT_STYLE, TYPE.body],
    ['AUTH_HINT_STYLE', AUTH_HINT_STYLE, TYPE.caption],
    ['AUTH_LINK_STYLE', AUTH_LINK_STYLE, TYPE.caption],
    ['AUTH_ERROR_STYLE', AUTH_ERROR_STYLE, TYPE.dense],
    ['AUTH_BUTTON_STYLE', AUTH_BUTTON_STYLE, TYPE.body],
    ['AUTH_BUTTON_QUIET_STYLE', AUTH_BUTTON_QUIET_STYLE, TYPE.body],
    ['AUTH_TEXT_STYLE', AUTH_TEXT_STYLE, TYPE.body],
    ['AUTH_PROSE_STYLE', AUTH_PROSE_STYLE, TYPE.body],
  ]
  const px = (s) => Number(String(s).replace('px', ''))

  it.each(ROLES)('%s is on its scale step and above the 11px floor', (_n, style, step) => {
    expect(px(style.fontSize)).toBe(step)
    expect(px(style.fontSize)).toBeGreaterThanOrEqual(TYPE_FLOOR)
  })

  it('the control: three of these used to be 10px, which the floor now rejects', () => {
    // AUTH_LINK_STYLE, AUTH_HINT_STYLE and AUTH_BUTTON_QUIET_STYLE were all
    // 10px before this session. If the floor were not enforced the loop above
    // would happily pass on a 10 that is not a step at all.
    expect(Object.values(TYPE)).not.toContain(10)
    expect(TYPE_FLOOR).toBe(11)
  })

  it('only the Label role is uppercase, and only it is letterspaced (Q2)', () => {
    // Six of the eight exports were uppercase and tracked, which is why a
    // title, a label, a button and a link all read as one typographic object.
    for (const [name, style] of ROLES) {
      if (name === 'AUTH_LABEL_STYLE') {
        expect(style.textTransform).toBe('uppercase')
        expect(style.letterSpacing).toBe('0.06em')
      } else if (name === 'AUTH_TITLE_STYLE') {
        // The H1 step's own +0.01em, which is optical, not a voice.
        expect(style.textTransform).toBeUndefined()
        expect(style.letterSpacing).toBe('0.01em')
      } else {
        expect(style.textTransform, name).toBeUndefined()
        expect(style.letterSpacing, name).toBeUndefined()
      }
    }
  })

  it('every weight is 400 or 600 — the face declares no others (Q3)', () => {
    for (const [name, style] of ROLES) {
      expect([400, 600, undefined], name).toContain(style.fontWeight)
    }
  })

  it('AUTH_TEXT_STYLE declares no font family (AUTH-02)', () => {
    // It carried the ONLY sans-serif declaration in the application, and it
    // was Apple-first on a Windows product. Deleting the key — rather than
    // repointing it — is what makes auth inherit the one app face.
    expect(AUTH_TEXT_STYLE).not.toHaveProperty('fontFamily')
    for (const [name, style] of ROLES) {
      expect(style, name).not.toHaveProperty('fontFamily')
    }
  })

  it('the ONE family the file still names is the mono token, and it is a token', () => {
    // AUTH-02 keeps the mono stack inside AuthPasswordInput's metrics
    // "because that one is load-bearing for caret alignment, and pin it to the
    // chosen Geist Mono stack in the same edit". A hand-written stack there is
    // a third face in an app that declares two.
    expect(authShellSrc).toContain('fontFamily: FONT_MONO')
    expect(authShellSrc).not.toMatch(/ui-monospace|SFMono-Regular|Menlo|Liberation Mono/)
    expect(authShellSrc).not.toMatch(/-apple-system|BlinkMacSystemFont/)
  })
})

describe('one field measure, one gap scale', () => {
  it('the field width is px on the 4px scale, not ch (AUTH-22)', () => {
    // `ch` is one advance of the ELEMENT'S OWN font, so a monospace 22ch and a
    // sans 22ch are different widths — that is the bug that made the password
    // rule 4px longer than the username rule. It was also 22ch here and 24ch
    // on the welcome wizard: two measures for one control.
    expect(AUTH_FIELD_WIDTH).toMatch(/^\d+px$/)
    expect(Number(AUTH_FIELD_WIDTH.replace('px', '')) % 4).toBe(0)
    expect(AUTH_INPUT_STYLE.width).toBe(AUTH_FIELD_WIDTH)
    expect(String(AUTH_INPUT_STYLE.width)).not.toContain('ch')
  })

  it('the three gaps are on the 4px base and strictly increasing (AUTH-09)', () => {
    const g = [AUTH_GAP_WITHIN_FIELD, AUTH_GAP_BETWEEN_FIELDS, AUTH_GAP_BETWEEN_BLOCKS]
      .map((v) => Number(String(v).replace('px', '')))
    for (const v of g) expect(v % 4).toBe(0)
    expect(g[0]).toBeLessThan(g[1])
    expect(g[1]).toBeLessThan(g[2])
  })

  it('the control: the values they replaced were not on the base', () => {
    // 5px within a field and 18px between them, the latter hand-typed in four
    // files. Spacing carried no grouping information because there was one gap.
    expect(5 % 4).not.toBe(0)
    expect(18 % 4).not.toBe(0)
  })
})

describe('busy and disabled are a named treatment, never an opacity', () => {
  it('neither busy variant carries an opacity', () => {
    // 3.1: "Disabled is one token: ink at 52 percent plus cursor: not-allowed,
    // never opacity-30/40/50." The surface used three numbers for one state —
    // 0.55 on five submits, 0.5 on two links, 0.6 on the MFA gate.
    expect(AUTH_BUTTON_BUSY_STYLE).not.toHaveProperty('opacity')
    expect(AUTH_LINK_BUSY_STYLE).not.toHaveProperty('opacity')
    expect(AUTH_BUTTON_BUSY_STYLE.cursor).toBe('not-allowed')
    expect(AUTH_LINK_BUSY_STYLE.cursor).toBe('not-allowed')
  })

  it('busy changes the cursor and nothing else — no fill, no edge, no ink', () => {
    // Review round 1 found the first attempt at this: it borrowed the kit's
    // light-disabled treatment (drop the fill, leave a rule-light hairline),
    // which is right for an OUTLINED button and wrong three times over for the
    // FILLED primary — the button's only edge becomes 1.51:1, and a 1px border
    // on a `border: none` button makes it 2px wider the moment it is pressed.
    //
    // Busy is carried by the label swap, the native `disabled` attribute and
    // the cursor. So these objects must stay minimal, and this asserts it:
    // anything that repaints the button belongs to a state the kit owns.
    // Round 2's objection to `toEqual(['cursor'])` was fair: it pins a key
    // list, which is not the same as pinning the PROPERTY OF THE KEYS. What
    // actually matters is that neither variant repaints anything — no colour,
    // no fill, no edge, no opacity, no size — so that is what is asserted, key
    // by key, and a new key of a repainting kind fails.
    const REPAINTS = [
      'opacity', 'background', 'backgroundColor', 'color', 'border',
      'borderColor', 'borderWidth', 'boxShadow', 'filter', 'transform',
      'height', 'width', 'padding', 'margin', 'fontSize', 'fontWeight',
    ]
    for (const [name, style] of [['button', AUTH_BUTTON_BUSY_STYLE], ['link', AUTH_LINK_BUSY_STYLE]]) {
      expect(style.cursor, name).toBe('not-allowed')
      for (const k of REPAINTS) expect(style, `${name}.${k}`).not.toHaveProperty(k)
    }
    // The link's one permitted change: it drops the underline, because on a
    // one-ink surface the affordance is the only thing a disabled control has
    // left to drop. The button has no affordance to lose and changes nothing.
    expect(AUTH_LINK_BUSY_STYLE.textDecoration).toBe('none')
    expect(AUTH_BUTTON_BUSY_STYLE).not.toHaveProperty('textDecoration')
  })

  it('the primary keeps its fill and its width while busy', () => {
    // The fill and the edge come from AUTH_BUTTON_STYLE and the busy variant
    // must not override either, or the control moves under the cursor at the
    // one moment the user is watching it.
    const busy = { ...AUTH_BUTTON_STYLE, ...AUTH_BUTTON_BUSY_STYLE }
    expect(busy.background).toBe(AUTH_BUTTON_STYLE.background)
    expect(busy.color).toBe(AUTH_BUTTON_STYLE.color)
    expect(busy.border).toBe(AUTH_BUTTON_STYLE.border)
    expect(busy.padding).toBe(AUTH_BUTTON_STYLE.padding)
    expect(busy.height).toBe(AUTH_BUTTON_STYLE.height)
  })

  it('the controls: both treatments this rejected really do fail here', () => {
    // (a) the 52 percent screen of the ink the plan's disabled token would use
    expect(ratio(over('rgba(28, 25, 23, 0.52)', WELL), WELL)).toBeLessThan(4.5)
    // (b) rule-light as a component boundary, which is what the kit's light
    //     disabled treatment would have left the primary standing on
    expect(ratio(over(RULE_LIGHT, WELL), WELL)).toBeLessThan(3)
  })
})

describe('every auth role survives the light orange well', () => {
  const INKED = [
    ['AUTH_TITLE_STYLE', AUTH_TITLE_STYLE],
    ['AUTH_LABEL_STYLE', AUTH_LABEL_STYLE],
    ['AUTH_INPUT_STYLE', AUTH_INPUT_STYLE],
    ['AUTH_HINT_STYLE', AUTH_HINT_STYLE],
    ['AUTH_LINK_STYLE', AUTH_LINK_STYLE],
    ['AUTH_PROSE_STYLE', AUTH_PROSE_STYLE],
  ]

  it.each(INKED)('%s clears AA on #f4a261', (_n, style) => {
    expect(ratio(style.color, WELL)).toBeGreaterThanOrEqual(4.5)
  })

  it('the input rule is a visible edge, not a suggestion', () => {
    // WCAG 1.4.11 wants 3:1 for a component boundary. The field IS its rule on
    // this surface — there is no fill to fall back on.
    expect(AUTH_INPUT_STYLE.borderBottom).toBe(`1px solid ${AUTH_INK}`)
    expect(ratio(AUTH_INK, WELL)).toBeGreaterThanOrEqual(3)
  })

  it('the quiet button keeps the full ink for its edge, not the light rule', () => {
    // The whole screen is 1px of the ink; rule-light measures 1.51:1 here
    // against the ink's 8.48:1, and a button nobody can find the edge of is
    // not a button. One rule weight, one rule colour, across the surface.
    expect(AUTH_BUTTON_QUIET_STYLE.border).toBe(`1px solid ${AUTH_INK}`)
    expect(ratio(over(RULE_LIGHT, WELL), WELL)).toBeLessThan(3)
  })
})

describe('the error ink was chosen by the measurement, not by the palette', () => {
  it('#b91c1c — the AUTH-15 proposal — FAILS on the well, which is why it was not taken', () => {
    // The finding said AUTH_ERROR_INK keeps its job "only if #b91c1c fails the
    // well measurement; test it and keep whichever passes, but keep one".
    // It measures 3.14:1. This is the record of that test.
    expect(ratio('#b91c1c', WELL)).toBeLessThan(4.5)
    expect(ratio(AUTH_ERROR_INK, WELL)).toBeGreaterThanOrEqual(4.5)
  })

  it('one error ink per surface: #7f1d1d on light, the danger token on dark', () => {
    expect(ratio(AUTH_ERROR_STYLE.color, WELL)).toBeGreaterThanOrEqual(4.5)
    expect(AUTH_ERROR_STYLE.color).toBe(AUTH_ERROR_INK)
  })
})

describe('the ink ladder is 100 / 72 / 52, and 48 is not a token', () => {
  // The system review proposed a four-rung ladder ending at 48 percent. The
  // critic's first correction: it measures 4.47:1 and fails AA. The three
  // rungs are pre-flattened so nobody re-derives them from an alpha.
  it('all three rungs clear AA on paper', () => {
    expect(ratio(INK, PAPER)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(INK_2, PAPER)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(INK_3, PAPER)).toBeGreaterThanOrEqual(4.5)
  })

  it('the control: the 48 percent rung that was proposed does not', () => {
    expect(ratio(over('rgba(245, 240, 236, 0.48)', PAPER), PAPER)).toBeLessThan(4.5)
  })
})

describe('the degraded-model banner is legible where it actually renders (AUTH-01)', () => {
  // It mounts as the first child of the authenticated column, whose background
  // is the #ea580c frame. It painted #b45309 on a 14 percent amber tint of
  // that ground: the tint composited to #e2570c and the text measured 1.34:1.
  // "The one notice built to be impossible to miss is invisible."
  //
  // The fix is a RAISED DARK SURFACE rather than a tint of the ground it sits
  // on, which is also the only route that does not wait on a light-surface
  // warning token that does not exist.
  const BANNER_GROUND = over('rgba(245, 158, 11, 0.14)', PAPER_RAISED)

  it('the banner body clears AA on the raised surface', () => {
    expect(ratio(INK, BANNER_GROUND)).toBeGreaterThanOrEqual(4.5)
  })

  it('the warning glyph clears AA on the same ground', () => {
    expect(ratio(WARNING, BANNER_GROUND)).toBeGreaterThanOrEqual(4.5)
  })

  it('the control: what it used to paint, on what it used to paint it on', () => {
    // #b45309 is absent from the critic's own failing-controls list even
    // though the critic measured it failing twice. It is here now.
    expect(ratio('#b45309', BARS)).toBeLessThan(3)
    expect(ratio('#b45309', over('rgba(180, 83, 9, 0.14)', BARS))).toBeLessThan(3)
  })
})

describe('Home hover, measured for Audrey rather than changed (Q19)', () => {
  // C3 scopes Home to fonts, and Q19 leaves the hover colour to her with
  // "Ask. Default: leave it." Both numbers are recorded here so the decision
  // is one line in a hand-off and not another measuring session, and so that
  // whichever she picks has a control the day it lands.
  const HOME_HOVER = over('rgba(154, 100, 56, 0.65)', WELL)

  it('white on the hover fill is below AA — the state being read is the weaker one', () => {
    expect(ratio('#ffffff', HOME_HOVER)).toBeLessThan(4.5)
  })

  it('the one ink on the same fill would clear it', () => {
    expect(ratio(INK_LIGHT, HOME_HOVER)).toBeGreaterThanOrEqual(4.5)
  })

  it('and the resting state already clears it, which is what makes the hover odd', () => {
    expect(ratio(INK_LIGHT, WELL)).toBeGreaterThanOrEqual(4.5)
  })
})
