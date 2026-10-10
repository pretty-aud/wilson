# =============================================================================
# The WILSON file gateway, as a container image (design §1, §11 A; D10, D24).
#
#   docker build -f container/Dockerfile -t wilson-gateway .   (from gateway/)
#
# A minimal Node 24 base with no shell and no package manager (distroless),
# run as its non-root user (uid 65532). The gateway's own files only: no
# tests, no Windows pieces. Its state lives in /data (mount a folder of the
# NAS there, writable by uid 65532); each footage location is mounted
# READ-ONLY at /locations/<host>/<share>, the host and the share in lower case,
# the folders below keeping their spelling (\NAS\Footage -> /locations/nas/footage).
#
# Run it on the HOST's network (`--network host`; Container Manager: "use the
# same network as Docker Host"). On a bridge the gateway cannot see browsers'
# real addresses, so it keeps its office door closed and says so on the first
# lines of its log (D24), beside the certificate's fingerprint.
#
#   WILSON_ENROL_TOKEN   the enrolment token (once, 24 h)
#   WILSON_CLOUD_URL     WILSON's cloud (the functions base), when not prod's
# =============================================================================
FROM gcr.io/distroless/nodejs24-debian12:nonroot
ENV WILSON_GATEWAY_IMAGE=1 \
    UV_THREADPOOL_SIZE=32 \
    NODE_ENV=production
WORKDIR /app
COPY --chown=0:0 package.json /app/package.json
COPY --chown=0:0 src /app/src
COPY --chown=0:0 updater /app/updater
USER 65532:65532
VOLUME ["/data"]
EXPOSE 8443 8444
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s CMD ["/nodejs/bin/node", "/app/src/cli.mjs", "doctor"]
ENTRYPOINT ["/nodejs/bin/node", "/app/src/cli.mjs"]
CMD ["run"]
