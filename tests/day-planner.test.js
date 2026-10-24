import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDay } from '../day-planner.js';
import { places } from '../data.js';
const place = id => places.find(p => p.id === id);
const input = () => ({ origin: place('central'), date: '2026-10-24', startMin: '08:00', startMax: '09:00', returnMin: '18:00', returnMax: '20:00', stops: [{ ...place('sisters'), duration: 60 }, { ...place('falls'), duration: 120 }], modes: ['TRAIN', 'BUS'], requests: [], live: false });
test('the current API planner retains direct-stop demo planning', async () => { const result = await buildDay(input(), {}); assert.equal(result.mode, 'demo'); assert.ok(result.plans.length); assert.equal(result.plans[0].events.filter(e => e.type === 'visit').reduce((sum, e) => sum + e.end - e.start, 0), 180); });
test('activity discovery cannot silently produce demo venues', async () => { await assert.rejects(buildDay({ ...input(), requests: [{ text: 'bookshops', duration: 60 }] }, {}), /needs live/); });
test('current replanner keeps home, removes completed visits and preserves edited durations', async () => { const settings = input(); settings.stops[1].duration = 45; settings.replan = { completed: 1, time: '14:00', currentOrigin: settings.origin }; const result = await buildDay(settings, {}); assert.ok(result.plans.length); const plan = result.plans[0]; assert.equal(plan.events[0].from.id, 'sisters'); assert.equal(plan.events.at(-1).to.id, 'central'); const visits = plan.events.filter(e => e.type === 'visit'); assert.equal(visits.length, 1); assert.equal(visits[0].end - visits[0].start, 45); });
