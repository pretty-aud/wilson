// =============================================================================
// RemoteViewingsTable — GW1's "Viewed from outside the office" table
// (GatewaySettings.jsx), taken out as one component so the Bins inspector
// can show the same table filtered to one clip (GW3, item 5). The words are
// gatewayWords.js's; the rows are file_events' viewed_remote rows as
// gatewayApi.listRemoteViewings / listRemoteViewingsOfClip answer them.
// =============================================================================

import { whoWords, howMuchWords, whereWords, gatewayNameWords } from './gatewayWords'

export function whenWords(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * `surface`: 'dark' where the table sits on a dark island (the Bins
 * inspector's dialog); settings.css then gives it the dark ground's ink. The
 * Settings page itself (the light ground) passes nothing.
 */
export default function RemoteViewingsTable({ rows, testId = 'gateway-viewings', surface = null }) {
  return (
    <table className="s-table s-gw-table" data-testid={testId} data-surface={surface || undefined}>
      <colgroup>
        <col style={{ width: '13%' }} />
        <col style={{ width: '17%' }} />
        <col style={{ width: '27%' }} />
        <col style={{ width: '20%' }} />
        <col style={{ width: '23%' }} />
      </colgroup>
      <thead>
        <tr><th>When</th><th>Who</th><th>Clip and project</th><th>How much</th><th>From where, through</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="s-data">{whenWords(r.created_at)}</td>
            <td>{whoWords(r)}</td>
            <td><span className="s-data s-gw-clip">{r.file_name || 'a clip removed since'}</span><br />{r.project_title || 'a project you cannot open'}</td>
            <td>{howMuchWords(r.details || {})}</td>
            <td>{whereWords(r.details || {})}<br />through {r.details?.gateway_name ? gatewayNameWords(r.details.gateway_name) : 'a gateway forgotten since'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
