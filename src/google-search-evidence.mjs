export function validateSearchEvidence(evidence, stay) {
  const dateConfirmed = evidence.checkIn === stay.checkIn && evidence.checkOut === stay.checkOut;
  const occupancyConfirmed = evidence.adults === stay.adults && evidence.children === 0 && (evidence.rooms == null || evidence.rooms === 1);
  return { dateConfirmed, occupancyConfirmed, roomCountConfirmed: evidence.rooms === 1 };
}

export function readOccupancyCounts(text) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const result = {};
  for (const [key, label] of [['adults', 'Adults'], ['children', 'Children'], ['rooms', 'Rooms']]) {
    const start = lines.indexOf(label);
    const values = [];
    if (start >= 0) for (const line of lines.slice(start + 1)) {
      if (['Adults', 'Children', 'Rooms', 'Cancel', 'Done'].includes(line)) break;
      if (/^\d+$/.test(line)) values.push(Number(line));
    }
    const unique = [...new Set(values)];
    result[key] = unique.length === 1 ? unique[0] : null;
  }
  return result;
}

export async function readGoogleSearchEvidence(page) {
  // Read the selected ISO dates from Google's actual calendar, not URL/config.
  const checkInInput = page.locator('input[aria-label="Check-in"]:visible').first();
  await checkInInput.click();
  const calendar = page.locator('[role="dialog"]:visible').last();
  await calendar.waitFor({ timeout: 10000 });
  const dates = await calendar.locator('[data-iso][aria-selected="true"]').evaluateAll(ns => ns.map(n => n.getAttribute('data-iso')).sort());
  // Google's duplicate responsive Done buttons can detach during pointer
  // actionability checks. Dispatch only the visible calendar's close action.
  await calendar.locator('button:visible').filter({hasText:/^Done$/}).first().dispatchEvent('click', {timeout:10000});
  await calendar.waitFor({state:'hidden',timeout:10000});
  const evidence = { source: 'google-visible-controls', checkIn: dates.length === 2 ? dates[0] : null,
    checkOut: dates.length === 2 ? dates[1] : null };
  await page.getByRole('button', { name: /Number of travelers/ }).click();
  const guests = page.locator('[role="dialog"]:visible').last();
  await guests.waitFor({ timeout: 10000 });
  evidence.occupancyText = await guests.innerText();
  // Google exposes adults/children, but not room count. Keep an absent room
  // count unknown: prices can be tracked, full BRG verification remains blocked.
  Object.assign(evidence, readOccupancyCounts(evidence.occupancyText));
  await guests.getByRole('button', { name: 'Done', exact: true }).dispatchEvent('click');
  return evidence;
}
