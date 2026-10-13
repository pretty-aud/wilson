// The running version. The release pipeline (GW4) stamps it; a test holds it
// equal to package.json's, so the two cannot drift. Reported at every sync, on
// the status page and by `wilson-gateway version` (design §8).
export const VERSION = '0.1.0';

// The platform this build says it is, as the cloud's CHECK spells it
// (Appendix B: 'windows' | 'container').
export function platformName(env = process.env, platform = process.platform) {
  if (env.WILSON_GATEWAY_IMAGE === '1') return 'container';
  return platform === 'win32' ? 'windows' : 'container';
}
