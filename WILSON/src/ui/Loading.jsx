// =============================================================================
// Loading — "not yet", as distinct from EmptyState's "nothing" (plan §4).
//
//   <Loading rows={6} columns={4} />   skeleton rows for anything tabular
//   <Loading />                        a spinner with a label, elsewhere
//
// Skeleton rows are the table's own geometry (36px rows, 12px cell padding)
// so the real rows land where the ghosts were. The pulse is scoped to
// `.ui-skeleton` and switched off under reduced motion in index.css.
// `role="status"` with `aria-label` so the state is announced once and the
// ghost cells are not read out.
// =============================================================================

export function Loading({ rows = 0, columns = 4, label = 'Loading', surface = 'dark', className = '', ...rest }) {
  if (rows > 0) {
    const widths = ['32%', '18%', '22%', '14%', '10%', '16%', '20%', '12%']
    return (
      <div role="status" aria-label={label} className={`ui-skeleton-rows ${className}`.trim()} data-surface={surface} {...rest}>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="ui-skeleton-row" aria-hidden="true">
            {Array.from({ length: columns }, (_, c) => (
              <span key={c} className="ui-skeleton" style={{ width: widths[(r + c) % widths.length] }} />
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <span role="status" aria-label={label} className={`ui-loading-inline ${className}`.trim()} data-surface={surface} {...rest}>
      <span className="ui-spinner" style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

export default Loading
