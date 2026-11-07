// MothIslands.jsx — MO1 (MOTH_DESIGN §1.10): the projects you can see, with no counts. Your own space says so, and
// nobody else's ever appears here, admins included (the server's moth_islands).
export function islandLabel(row, { localOnly = false } = {}) {
  if (row.is_mine) return 'My personal space'
  return localOnly ? `${row.title} · On this computer only` : row.title
}

export default function MothIslands({ islands, openId, localOnly, onOpen }) {
  return (
    <nav className="moth-islands" aria-label="Projects" data-moth-islands>
      {islands.map((row) => (
        <button
          type="button"
          key={row.id}
          className={`moth-island${row.id === openId ? ' is-open' : ''}`}
          aria-current={row.id === openId ? 'true' : undefined}
          onClick={() => onOpen(row.id)}
        >
          {islandLabel(row, { localOnly })}
        </button>
      ))}
    </nav>
  )
}
