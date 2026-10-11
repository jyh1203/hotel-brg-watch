// Search-only controls in collector-owned tabs. No booking/payment controls.
export function parseOccupancy(text) {
 const read=(en,ko)=>Number(String(text).match(new RegExp(`(\\d+)\\s*(?:${en})|${ko}\\s*(\\d+)`,'i'))?.slice(1).find(Boolean)??NaN);
 return {adults:read('adults','성인'),children:read('children','아동'),rooms:read('rooms?','객실')};
}
export function parseExplicitDates(text) {
 const dates=String(text).match(/20\d{2}-\d{2}-\d{2}/g)??[];
 for(const m of String(text).matchAll(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/g)) dates.push(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
 const monthNames=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 for(const m of String(text).matchAll(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\b/gi))dates.push(`${m[3]}-${String(monthNames.indexOf(m[2].slice(0,3).toLowerCase())+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`);
 for(const m of String(text).matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(20\d{2})\b/gi))dates.push(`${m[3]}-${String(monthNames.indexOf(m[1].slice(0,3).toLowerCase())+1).padStart(2,'0')}-${m[2].padStart(2,'0')}`);
 return [...new Set(dates)];
}

// Parameter names and property identity must come from an actual visible
// Expedia hotel navigation link, not a guessed private rate/checkout API.
export function observedExpediaSearchUrl(canonical, observed, stay) {
 try{
  const base=new URL(canonical),link=new URL(observed,canonical);
  const id=base.pathname.match(/\.h(\d+)\.Hotel-Information$/i)?.[1];
  if(base.protocol!=='https:'||base.hostname!=='www.expedia.com'||base.origin!==link.origin||!id)return null;
  if(link.searchParams.get('PinnedHotelID')!==id&&link.searchParams.get('selected')!==id&&!link.pathname.includes(`.h${id}.`))return null;
  if(!['startDate','endDate','adults'].every(key=>link.searchParams.has(key)))return null;
  const url=new URL(base.origin+base.pathname);
  url.searchParams.set('startDate',stay.checkIn);url.searchParams.set('endDate',stay.checkOut);url.searchParams.set('adults',String(stay.adults));
  if(link.searchParams.has('rooms'))url.searchParams.set('rooms','1');
  return url.href;
 }catch{return null;}
}
export async function openExpediaObservedSearch(page,stay) {
 const canonical=stay.ota?.urls?.Expedia;
 const href=await page.locator('a[aria-label*="Check availability for tonight"]').first().getAttribute('href',{timeout:8000});
 const url=observedExpediaSearchUrl(canonical,new URL(href,page.url()).href,stay);
 if(!url)return {state:'search-link-unverified'};
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
 const text=await page.locator('body').innerText();
 if(/captcha|show us your human side|verify.*human|access denied/i.test(text))return {state:'blocked'};
 // The query is a request, not observed evidence. Read current page controls.
 return {state:'search-opened-unverified'};
}
export async function readBookingSearch(page) {
 return page.evaluate(()=>{
  const visible=n=>!!n.getBoundingClientRect().width;
  const selected=[...document.querySelectorAll('[data-date][aria-checked="true"]')].filter(visible);
  const occupancy=[...document.querySelectorAll('[data-testid="occupancy-config"]')].find(visible);
  const dates=[...new Set(selected.map(n=>n.getAttribute('data-date')))].sort();
  return {dates:dates.length?[dates[0],dates.at(-1)]:[],occupancy:occupancy?.innerText??''};
 });
}
export async function setBookingSearch(page,stay) {
 await page.locator('[data-testid="searchbox-dates-container"]:visible').first().click({timeout:15000});
 await page.locator('[data-date]:visible').first().waitFor({timeout:8000}).catch(async()=>{
  await page.locator('[data-testid="searchbox-dates-container"]:visible').first().click({timeout:8000});
 });
 const initial=await readBookingSearch(page);const initialOccupancy=parseOccupancy(initial.occupancy);
 if(initial.dates[0]===stay.checkIn&&initial.dates[1]===stay.checkOut&&initialOccupancy.adults===stay.adults&&initialOccupancy.children===0&&initialOccupancy.rooms===1){
  await page.keyboard.press('Escape');await page.locator('.hprt-table tr').first().waitFor({timeout:10000});
  return {state:'search-set',...initial,...initialOccupancy};
 }
 // Booking's mobile calendar contains month sections; target full ISO dates,
 // never a day number that may belong to another month/year.
 for(const date of [stay.checkIn,stay.checkOut]) {
  const target=page.locator(`[data-date="${date}"]:visible`).first();
  if(!await target.isVisible()) {
   const next=page.getByRole('button',{name:/^(Next month|다음 달)$/i}).filter({visible:true}).first();
   for(let step=0;step<12&&!await target.isVisible();step++) {
    if(!await next.isVisible())break;
    await next.click({timeout:4000});
   }
  }
  await target.waitFor({timeout:8000});await target.click({timeout:8000});
 }
 // Reopen to read actual selected endpoints including year.
 await page.locator('[data-testid="searchbox-dates-container"]:visible').first().click({timeout:8000});
 const observed=await readBookingSearch(page);
 await page.keyboard.press('Escape');
 const occupancy=parseOccupancy(observed.occupancy);
 if(!observed.dates.includes(stay.checkIn)||!observed.dates.includes(stay.checkOut))return {state:'date-selection-unverified'};
 if(occupancy.adults!==stay.adults||occupancy.children!==0||occupancy.rooms!==1)return {state:'occupancy-selection-required'};
 const search=page.getByRole('button',{name:/^(검색 변경|Change search)$/}).filter({visible:true}).first();
 // Observe both promises immediately: a failed click must not leave an
 // unhandled navigation rejection when the owned page is closed.
 await Promise.all([
  page.waitForNavigation({waitUntil:'domcontentloaded',timeout:18000}),
  search.click({timeout:8000})
 ]);
 await page.locator('.hprt-table tr').first().waitFor({timeout:15000});
 await page.locator('[data-testid="searchbox-dates-container"]:visible').first().click({timeout:8000});
 await page.locator('[data-date][aria-checked="true"]:visible').first().waitFor({timeout:8000});
 const final=await readBookingSearch(page);await page.keyboard.press('Escape');
 const finalOccupancy=parseOccupancy(final.occupancy);
 return {state:final.dates[0]===stay.checkIn&&final.dates[1]===stay.checkOut&&finalOccupancy.adults===stay.adults&&finalOccupancy.children===0&&finalOccupancy.rooms===1?'search-set':'search-conditions-unverified',...final,...finalOccupancy};
}

export async function setAgodaSearch(page,stay) {
 const next=page.locator('[data-selenium="calendar-next-month-button"]:visible');
 if(!await next.isVisible())await page.locator('[data-selenium="checkInBox"]:visible').first().click({timeout:12000});
 await next.waitFor({timeout:8000});
 for(const iso of [stay.checkIn,stay.checkOut]) {
  const date=new Date(`${iso}T12:00:00Z`);
  const label=`${date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short'})} ${date.toLocaleDateString('en-US',{timeZone:'UTC',month:'short'})} ${String(date.getUTCDate()).padStart(2,'0')} ${date.getUTCFullYear()}`;
  const target=page.locator(`[aria-label^="${label}"]:visible`).first();
  for(let step=0;step<13&&!await target.isVisible();step++)await next.click({timeout:4000});
  await target.click({timeout:8000});
 }
 const search=page.locator('[data-selenium="searchButton"]:visible').first();
 await search.click({timeout:10000});
 // Wait for the actual search document (including locale redirects), rather
 // than reading the old header during navigation. URL is a gate only;
 // verification below still uses rendered dates and occupancy controls.
 await page.waitForURL(url=>url.searchParams.get('checkIn')===stay.checkIn&&url.searchParams.get('checkOut')===stay.checkOut,{waitUntil:'domcontentloaded',timeout:30000});
 await page.locator('[data-selenium="checkInText"]:visible').first().waitFor({timeout:25000});
 // Sticky searchbox animation may never become geometrically stable during
 // locale redirects. Dispatch only this known, visible search control;
 // verify that its actual occupancy panel opens before reading anything.
 await page.locator('[data-selenium="occupancyBox"]:visible').first().dispatchEvent('click',{timeout:8000});
 await page.locator('[data-selenium="desktop-occ-children-value"]:visible').waitFor({timeout:6000});
 const observed=await page.evaluate(()=>{
  const get=id=>document.querySelector(`[data-selenium="${id}"]`)?.innerText?.trim();
  return {dateText:`${get('checkInText')} ${get('checkOutText')}`,adults:Number(get('desktop-occ-adult-value')),children:Number(get('desktop-occ-children-value')),rooms:Number(get('desktop-occ-room-value'))};
 });
 observed.dates=parseExplicitDates(observed.dateText);delete observed.dateText;
 await page.locator('[data-selenium="occupancyBox"]:visible').first().dispatchEvent('click',{timeout:8000});
 return {state:observed.dates[0]===stay.checkIn&&observed.dates[1]===stay.checkOut&&observed.adults===stay.adults&&observed.children===0&&observed.rooms===1?'search-set':'search-conditions-unverified',...observed};
}

export async function setExpediaSearch(page,stay) {
 const dateButton=page.locator('[data-stid="uitk-date-selector-input1-default"]:visible').first();
 await dateButton.click({timeout:12000}).catch(async e=>{
  if(!await page.locator('.uitk-month-table:visible').count())throw e;
 });
 await page.locator('.uitk-month-table:visible').first().waitFor({timeout:5000}).catch(async()=>{
  await dateButton.click({timeout:8000});
  await page.locator('.uitk-month-table:visible').first().waitFor({timeout:8000});
 });
 for(const iso of [stay.checkIn,stay.checkOut]) {
  const label=new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const day=page.locator(`[role="button"]:has(.uitk-day-aria-label[aria-label^="${label}"])`).first();
  for(let step=0;step<12&&!await day.count();step++) {
   const last=page.locator('.uitk-month-table').last();
   const before=await last.innerText();
   await last.scrollIntoViewIfNeeded({timeout:5000});
   await last.evaluate(n=>{for(let a=n.parentElement;a;a=a.parentElement){if(a.scrollHeight>a.clientHeight+50&&/auto|scroll/.test(getComputedStyle(a).overflowY)){a.scrollTop=a.scrollHeight;return;}}});
   await page.waitForFunction(({label,before})=>{
    const tables=[...document.querySelectorAll('.uitk-month-table')];
    return !!document.querySelector(`.uitk-day-aria-label[aria-label^="${label}"]`)||tables.at(-1)?.innerText!==before;
   },{label,before},{timeout:2500}).catch(()=>{});
  }
  await day.scrollIntoViewIfNeeded({timeout:8000});
  if(await day.getAttribute('aria-disabled')==='true')return {state:'date-unavailable'};
  await day.click({timeout:8000});
 }
 const selected=await page.locator('.uitk-day-button[aria-pressed="true"]').evaluateAll(ns=>ns.map(n=>n.querySelector('.uitk-day-aria-label')?.getAttribute('aria-label')));
 const done=page.getByRole('button',{name:/^Done$/}).first();
 await done.click({timeout:8000});
 await page.getByRole('button',{name:/^Search$/}).first().click({timeout:8000});
 return {state:'search-submitted',calendarLabels:selected};
}
