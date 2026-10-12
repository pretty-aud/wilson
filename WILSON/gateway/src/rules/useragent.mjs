// =============================================================================
// The user agent's family for the audit row (design §6: `user_agent`,
// "Chrome 142 on Windows", the family only). Never the full string: it is a
// fingerprint, and the row's strings are bounded.
// =============================================================================

const BROWSERS = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/\bOPR\/(\d+)/, 'Opera'],
  [/\bFirefox\/(\d+)/, 'Firefox'],
  [/\bFxiOS\/(\d+)/, 'Firefox'],
  [/\bCriOS\/(\d+)/, 'Chrome'],
  [/\bChrome\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+)(?:\.\d+)*.*\bSafari\//, 'Safari'],
];
const SYSTEMS = [
  [/\bWindows\b/, 'Windows'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export function userAgentFamily(ua) {
  if (typeof ua !== 'string' || !ua) return 'unknown';
  const s = ua.slice(0, 512);
  let browser = 'Other';
  for (const [re, name] of BROWSERS) {
    const m = re.exec(s);
    if (m) { browser = `${name} ${m[1]}`; break; }
  }
  let system = null;
  for (const [re, name] of SYSTEMS) if (re.test(s)) { system = name; break; }
  return (system ? `${browser} on ${system}` : browser).slice(0, 64);
}
