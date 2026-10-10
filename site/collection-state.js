export function sourceState(runs, attempts, id, source, now = Date.now()) {
  const attempt = attempts?.results?.find(x => x.id === id);
  let success = null;
  for (const run of [...runs].reverse()) {
    const result = run.results?.find(x => x.id === id);
    const value = source === 'google' ? result : result?.marriott;
    if (value?.status === 'ok') {
      success = { at: value.capturedAt ?? run.capturedAt, verified: source !== 'google' || (value.dateConfirmed === true && value.occupancyConfirmed === true) };
      break;
    }
  }
  const attemptedAt = attempt?.capturedAt ?? attempts?.capturedAt;
  const failed = attempt && attempt.status !== 'ok' && attempt.status !== 'not-collected';
  return { successAt: success?.at, attemptedAt, failed: Boolean(failed), error: attempt?.error,
    verified: success?.verified === true, stale: !success || now - Date.parse(success.at) > 86400000 };
}
