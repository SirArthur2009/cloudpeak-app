export function verifyRelease(checks, expected) {
  return checks.length > 0 && checks.every(({ release, health }) =>
    release.appSha === expected.appSha &&
    release.websiteSha === expected.websiteSha &&
    typeof release.buildId === 'string' && release.buildId.length > 0 &&
    release.buildId === checks[0].release.buildId &&
    release.authProvider === expected.authProvider &&
    health.ok === true && health.releaseMode === 'live' && health.auth === 'Better Auth'
  )
}
