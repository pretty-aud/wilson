// MothSettings.jsx — MO2: what the Settings panel holds (the brief §3.1, her split of 2026-11-01): the cosmetic
// choices, the light's colour, what sizes a dot, what colours it, and when the lighter mode is used. Kept per
// person and company. Also Moth's Help, in plain words.
import { Field, Select } from '../../../ui'
import { GLOW_SWATCHES, SIZE_BY, COLOUR_BY, LIGHTER } from '../state/mothAppearance.js'

export default function MothSettings({ appearance, onChange, calm, available = true }) {
  const custom = !GLOW_SWATCHES.some(([c]) => c === appearance.glow)
  return (
    <div className="moth-settings" data-moth-settings>
      <fieldset className="moth-fieldset">
        <legend className="moth-label">The light</legend>
        <div className="moth-swatches" role="radiogroup" aria-label="The light's colour">
          {GLOW_SWATCHES.map(([colour, name]) => (
            <button
              key={colour}
              type="button"
              role="radio"
              aria-checked={appearance.glow === colour}
              className="moth-swatch"
              style={{ '--moth-swatch': colour }}
              title={name}
              onClick={() => onChange({ glow: colour })}
            >
              <span className="moth-swatch-name">{name}</span>
            </button>
          ))}
          <label className="moth-swatch moth-swatch-custom" title="Another colour">
            <input
              type="color"
              value={appearance.glow}
              onChange={(e) => onChange({ glow: String(e.target.value).toLowerCase() })}
              aria-label="Another colour for the light"
            />
            <span className="moth-swatch-name">{custom ? 'Yours' : 'Other'}</span>
          </label>
        </div>
        {calm && <p className="moth-quiet">Your computer asks for less motion, so the light holds still.</p>}
      </fieldset>
      <Field label="Size by">
        <Select value={appearance.size_by} onChange={(v) => onChange({ size_by: v || 'contents' })}
          options={SIZE_BY.map(([value, label]) => ({ value, label }))} data-moth-size-by />
      </Field>
      <Field label="Colour by">
        <Select value={appearance.colour_by} onChange={(v) => onChange({ colour_by: v || 'kind' })}
          options={COLOUR_BY.map(([value, label]) => ({ value, label }))} data-moth-colour-by />
      </Field>
      <Field label="Lighter mode, for older computers" hint="Fewer effects and less detail, so it stays smooth.">
        <Select value={appearance.light} onChange={(v) => onChange({ light: v || 'auto' })}
          options={LIGHTER.map(([value, label]) => ({ value, label }))} data-moth-lighter />
      </Field>
      {!available && <p className="moth-quiet">These settings last for this visit only: this database does not keep them yet.</p>}
    </div>
  )
}

export function MothHelp() {
  return (
    <div className="moth-help" data-moth-help>
      <h3 className="moth-label">Moving around</h3>
      <p>Drag empty space to move, scroll or pinch to zoom. Click a dot to select it; Shift-click to select more. Double-click a folder to open it. The list on the right does all of this from the keyboard.</p>
      <h3 className="moth-label">Moving and linking</h3>
      <p>Drag a dot onto a folder and the folder opens wider: let go to move the file into it. Drag it near another dot and that dot glows: linking comes with the next update of M.O.T.H., so for now the dot goes back. A word by the pointer says which. Press Escape to cancel. Letting go in empty space only changes the picture.</p>
      <p>Move to, in the view panel, does the same without dragging. Every move and delete can be undone.</p>
      <h3 className="moth-label">Views</h3>
      <p>A view chooses what shows as dots, which lines join them and how they are laid out. Save one for yourself, or for everyone on a project. Where you put the dots is kept with the view.</p>
      <h3 className="moth-label">Looking back</h3>
      <p>The time slider shows your projects as they were, for up to 90 days, from when Moth began recording. It shows names and places, not old copies of files. Looking back changes nothing.</p>
      <h3 className="moth-label">What Moth never shows</h3>
      <p>Invoices, finance and legal files, and anyone else's personal space, for everyone. What you cannot see in WILSON does not appear here at all.</p>
    </div>
  )
}
