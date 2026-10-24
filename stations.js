import { readFileSync } from 'node:fs';
import { places } from './data.js';
const catalogue = JSON.parse(readFileSync(new URL('./data/stations.json', import.meta.url), 'utf8'));
export const stations = catalogue.stations;
export const stationMetadata = catalogue.metadata;
const index = new Map(stations.map(s => [s.id, s]));
const demo = new Map(places.map(p => [p.id, p]));
export const searchKey = value => String(value || '').toLowerCase().replace(/\bmt\b/g, 'mount').replace(/[^a-z0-9]/g, '');
export function searchStations(query = '') { const q = searchKey(query); return stations.filter(s => searchKey([s.name, s.sourceName, ...s.aliases].join(' ')).includes(q)); }
export function canonicalLocation(place, live) {
  if (!place) return place;
  const station = index.get(place.id);
  if (!station) { if (String(place.id).startsWith('nsw-station-')) throw Error('Unknown station. Choose a station from the current directory.'); return place; }
  if (!live && !station.demoSupported) throw Error('This station needs live routing. Demo mode only models the original sample locations.');
  // Keep caller visit duration, but never use caller-supplied station coordinates.
  return { ...place, ...(live ? station : demo.get(place.id)) };
}
export function canonicalStationInput(input) {
  return { ...input, origin: canonicalLocation(input.origin, input.live), stops: input.stops?.map(p => canonicalLocation(p, input.live)), ...(input.replan ? { replan: { ...input.replan, currentOrigin: canonicalLocation(input.replan.currentOrigin, input.live) } } : {}) };
}
// TRAIN remains the public planner preference; live rail includes Metro and trams.
export const googleTravelModes = modes => [...new Set(modes.flatMap(m => m === 'TRAIN' ? ['TRAIN','SUBWAY','LIGHT_RAIL'] : [m]))];
export const googleVehicleTypes = modes => new Set(modes.flatMap(m => m === 'TRAIN' ? ['RAIL','HEAVY_RAIL','COMMUTER_TRAIN','HIGH_SPEED_TRAIN','LONG_DISTANCE_TRAIN','METRO_RAIL','SUBWAY','TRAM','LIGHT_RAIL'] : ['BUS','INTERCITY_BUS','TROLLEYBUS']));
