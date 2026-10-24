import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/FeatureServer/1';
const item = 'https://portal.spatial.nsw.gov.au/portal/sharing/rest/content/items/a524efb9a8a245ca8891ee665f1a30d3?f=json';
async function json(url) { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw Error('Source returned HTTP ' + r.status); const d = await r.json(); if (d.error) throw Error(JSON.stringify(d.error)); return d; }
const metro = new Set(['Tallawong','Rouse Hill','Kellyville','Bella Vista','Norwest','Hills Showground','Castle Hill','Cherrybrook','Epping','Macquarie University','Macquarie Park','North Ryde','Chatswood','Crows Nest','Victoria Cross','Barangaroo','Martin Place','Gadigal','Central','Waterloo','Sydenham'].map(s => s.toUpperCase()));
const shared = new Set(['EPPING','CHATSWOOD','MARTIN PLACE','CENTRAL','SYDENHAM']);
const southwest = new Set(['MARRICKVILLE','DULWICH HILL','HURLSTONE PARK','CANTERBURY','CAMPSIE','BELMORE','LAKEMBA','WILEY PARK','PUNCHBOWL','BANKSTOWN']);
const excluded = ['BRADFIELD RAILWAY STATION','BOTTOM POINTS RAILWAY STATION','ROYAL NATIONAL PARK TRAMWAY STATION'];
const metadata = await json(item);
const features = [];
for (let offset = 0; ; offset += 1000) {
  const query = new URLSearchParams({ f: 'json', where: 'operationalstatus=1', outFields: 'objectid,topoid,generalname,operationalstatus,lastupdate', outSR: '4326', returnGeometry: 'true', orderByFields: 'objectid', resultOffset: String(offset), resultRecordCount: '1000' });
  const data = await json(source + '/query?' + query);
  if (!Array.isArray(data.features) || (data.exceededTransferLimit && !data.features.length)) throw Error('Incomplete source page');
  features.push(...data.features);
  if (!data.exceededTransferLimit) break;
}
const title = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bUnsw\b/g, 'UNSW').replace(/\bQvb\b/g, 'QVB').replace(/\bEs Marks\b/g, 'ES Marks');
const stations = features.filter(f => f.geometry && f.geometry.x >= 150.2 && f.geometry.x <= 151.5 && f.geometry.y >= -34.3 && f.geometry.y <= -33.3 && !excluded.includes(f.attributes.generalname)).map(f => {
  const a = f.attributes, light = /(?:LIGHT RAIL|SLR) STOP$/.test(a.generalname);
  const base = a.generalname.replace(/ (?:RAILWAY|INTERCHANGE) STATION$/, '').replace(/ (?:LIGHT RAIL|SLR) STOP$/, '');
  const legacy = { CENTRAL: 'central', PARRAMATTA: 'parramatta', KATOOMBA: 'katoomba' };
  const modes = light ? ['lightRail'] : metro.has(base) ? shared.has(base) ? ['train','metro'] : ['metro'] : ['train'];
  return { id: (!light && legacy[base]) || 'nsw-station-' + a.topoid, sourceId: String(a.topoid), sourceName: a.generalname, name: title(base) + (light ? ' Light Rail' : ' Station'), lat: Number(f.geometry.y.toFixed(7)), lng: Number(f.geometry.x.toFixed(7)), kind: 'origin', modes, demoSupported: Boolean(!light && legacy[base]), sourceUpdated: new Date(a.lastupdate).toISOString(), ...(southwest.has(base) && !light ? { serviceNote: 'Southwest Metro conversion: opening announced for 30 October 2026. Check services for your travel date.' } : {}), aliases: /TERMINAL/.test(base) ? ['airport'] : [] };
}).sort((a,b) => a.name.localeCompare(b.name, 'en-AU'));
if (stations.length < 250 || new Set(stations.map(s => s.id)).size !== stations.length) throw Error('Unexpected count or duplicate source identifiers; catalogue not overwritten.');
for (const name of metro) if (!stations.some(s => s.sourceName === name + ' RAILWAY STATION')) throw Error('Missing Metro location: ' + name);
if (new Set(stations.map(s => s.sourceName)).size !== stations.length) throw Error('Duplicate station complexes need review.');
const result = { metadata: { retrievedAt: new Date().toISOString(), sourceItemModified: new Date(metadata.modified).toISOString(), sourceUrl: source, sourceItem: 'https://portal.spatial.nsw.gov.au/portal/home/item.html?id=a524efb9a8a245ca8891ee665f1a30d3', attribution: metadata.accessInformation.trim(), license: 'Creative Commons Attribution 4.0', licenseUrl: 'https://www.nsw.gov.au/nsw-government/about-website/copyright', coverage: 'Sydney, Blue Mountains and nearby intercity station locations within 150.2–151.5 E, 34.3–33.3 S. Not a timetable or guarantee of current services.', excluded, sourceFeatureHash: createHash('sha256').update(JSON.stringify(features)).digest('hex'), count: stations.length, modeCounts: Object.fromEntries(['train','metro','lightRail'].map(m => [m, stations.filter(s => s.modes.includes(m)).length])) }, stations };
await writeFile(new URL('../data/stations.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.metadata, null, 2));
