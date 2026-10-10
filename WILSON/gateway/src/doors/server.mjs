// =============================================================================
// One door's listener: an HTTPS server on one address and port, with the
// spike's two lessons built in (design Appendix A's last two rows; BC4's trap 2):
//
//   * EVERY socket is tracked at the TCP level, on the `connection` event,
//     before TLS. `server.closeAllConnections()` skips a socket that has not
//     finished its handshake, and `server.close()` then waits out the
//     handshake timeout (120,002 ms measured with Node's default); so closing
//     a door destroys every tracked socket itself (0.4 ms measured), and
//   * the handshake timeout is 10 s, the second bound.
//
// The gate runs on the same `connection` event, before a single TLS byte is
// written: a socket it refuses is destroyed there and counted. For the inside
// door the gate is the address rule (peers.mjs); for both doors it also holds
// the per-peer connection and handshake limits and the global pools (D12).
//
// TLS 1.2 minimum, ECDHE with AES-GCM or ChaCha20 only for TLS 1.2, TLS 1.3's
// suites; no compression (OpenSSL in Node never compresses); no `Server`
// header anywhere (Node sends none); header timeout 10 s; 60 s idle close.
// =============================================================================

import https from 'node:https';

export const TLS12_CIPHERS = [
  'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-ECDSA-AES256-GCM-SHA384', 'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES256-GCM-SHA384', 'ECDHE-RSA-CHACHA20-POLY1305',
].join(':');

/**
 * @param {object} o
 * @param {'inside'|'outside'} o.door
 * @param {string} o.host  the address to bind (one per server; never 0.0.0.0 for the inside door)
 * @param {number} o.port
 * @param {{ cert: string, key: string }} o.tls
 * @param {object} o.limits  resolveLimits().limits
 * @param {(socket: import('node:net').Socket) => { admit: boolean, reason?: string }} o.gate
 * @param {(req, res) => void} o.handler
 * @param {(event: string, detail: object) => void} [o.onEvent]
 */
export function createDoorServer({ door, host, port, tls, limits, gate, handler, onEvent = () => {} }) {
  const sockets = new Set();
  const server = https.createServer({
    cert: tls.cert,
    key: tls.key,
    minVersion: 'TLSv1.2',
    ciphers: TLS12_CIPHERS,
    honorCipherOrder: true,
    handshakeTimeout: limits.handshakeTimeoutMs,
    requestTimeout: limits.headerTimeoutMs + 5_000,
    headersTimeout: limits.headerTimeoutMs,
    keepAliveTimeout: limits.idleMs,
    connectionsCheckingInterval: 1_000,
    maxHeaderSize: 16 * 1024,
  }, handler);
  // At most this many requests on one connection (review round 1, finding 2):
  // the last answer says "Connection: close", so a client must connect again,
  // through the gate's per-peer connection and handshake limits.
  server.maxRequestsPerSocket = limits.requestsPerConnection;

  server.on('connection', (socket) => {
    const verdict = gate(socket);
    if (!verdict.admit) {
      socket.destroy();
      onEvent('refused', { door, peer: socket.remoteAddress, reason: verdict.reason });
      return;
    }
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
      if (verdict.release) verdict.release();
    });
  });
  // Node closes a socket whose request headers do not arrive in time; an idle
  // keep-alive connection closes after keepAliveTimeout; a response nobody
  // reads (or a request that sends nothing) stops after the socket timeout.
  server.setTimeout(limits.idleMs, (socket) => socket.destroy());
  server.on('tlsClientError', (_err, socket) => { socket.destroy(); });
  server.on('clientError', (_err, socket) => { socket.destroy(); });

  let listening = false;
  return {
    door,
    host,
    get port() { return server.address()?.port ?? port; },
    server,
    sockets,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (e) => { server.off('listening', onListening); reject(e); };
        const onListening = () => { server.off('error', onError); listening = true; resolve(server.address().port); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host, port, exclusive: true });
      });
    },
    /** A new certificate without a restart (the leaf renewed, an address changed). */
    setCertificate({ cert, key }) { server.setSecureContext({ cert, key, minVersion: 'TLSv1.2', ciphers: TLS12_CIPHERS, honorCipherOrder: true }); },
    /**
     * Unbind and end every connection now: stop accepting, close every HTTP
     * connection, destroy every socket tracked at the TCP level (half-open
     * TLS included). Resolves with the milliseconds it took.
     */
    close() {
      const t0 = process.hrtime.bigint();
      return new Promise((resolve) => {
        if (!listening) { resolve(0); return; }
        listening = false;
        server.close(() => resolve(Number(process.hrtime.bigint() - t0) / 1e6));
        server.closeAllConnections();
        for (const s of sockets) s.destroy();
      });
    },
  };
}
