  }
  results.push(result);
}
if (googleBrowser) await googleBrowser.close();

if (collectMarriott) {
  const marriottBrowser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADFUL !== "1"
  });
  for (let index = 0; index < stays.length; index += 1) {
    const stay = stays[index];
    console.log(`Checking Marriott official rate for ${stay.hotel}...`);
    let marriott;
    const attempts = process.env.MARRIOTT_DEBUG === "1" ? 1 : 2;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const marriottContext = await marriottBrowser.newContext({ locale: "en-US", timezoneId: "America/New_York", viewport: { width: 1365, height: 900 } });
      marriott = await collectMarriottRate(marriottContext, stay, fx);
      await marriottContext.close();
      if (marriott.status === "ok" || attempt === 2) break;
      console.log(`Retrying Marriott for ${stay.hotel} after: ${marriott.error}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    results[index].marriott = marriott;
    if (marriott.status !== "ok" && results[index].officialReference) {
      results[index].marriott.reference = {
        ...results[index].officialReference,
        sourceUrl: results[index].detailUrl,
        capturedAt: new Date().toISOString(),
        note: "Google에 표시된 Marriott 판매가 · 객실/취소/세금 조건 미확인"
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  await marriottBrowser.close();
} else {
  for (const result of results) result.marriott = {
