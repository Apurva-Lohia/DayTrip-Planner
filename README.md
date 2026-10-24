# Daytrip — Sydney & Blue Mountains

Plan a complete day out using trains, buses and walking—without switching between separate route searches.

Choose your sights, visit durations and departure/return windows. Daytrip compares up to three different itineraries and helps you adjust the remaining day when plans change.

## Features

- Compare travel time, walking, transfers and spare time.
- View each itinerary on an interactive map.
- Add café or lunch stops, with opening-hours checks.
- Change your departure time or remaining visit durations during a trip.
- Try the app without API keys using demo mode.

## Quick start

Requires **Node.js 22 or newer**.

Open the project folder in a terminal and run:

```bash
npm start
```

Visit **http://localhost:3000**. Keep the terminal running; press **Ctrl+C** to stop.

The compiled frontend is included, so `npm start` works without installing frontend tools. To edit the React/Tailwind source, run `npm install`, then `npm run build` after making changes.

## Enable real routes and places

Enable billing and these APIs in a Google Cloud project:

| API | Used for |
|---|---|
| Maps JavaScript API | Interactive maps |
| Routes API | Train, bus and walking journeys |
| Places API (New) | Locations, food stops and opening hours |

Create a file named `.env` beside `server.js`:

```dotenv
GOOGLE_SERVER_KEY=your_server_key
GOOGLE_MAPS_BROWSER_KEY=your_browser_key
PORT=3000
```

Configure two separate keys:

- **Server key:** restrict API access to Routes API and Places API (New).
- **Browser key:** restrict API access to Maps JavaScript API and website access to `http://localhost:3000/*`.

Save `.env`, restart the server and refresh the browser.

**Keep `.env` private. Never commit or share it.** Google API usage may incur charges. Opening-hours searches use the Nearby Search Enterprise tier.

## Using Daytrip

1. Choose your starting point and travel date.
2. Set your departure and return windows.
3. Add up to four sights and a duration for each.
4. Optionally include a café or lunch break.
5. Click **Find my day** and compare the results.
6. Use **Change my plans** to recalculate the remaining trip.

The latest return time is your deadline. Plans may return earlier than your preferred window, but never silently shorten your visits.

## Know before you go

- **Demo mode:** fictional schedules and illustrative map lines—not suitable for navigation.
- **Live mode:** Google-provided routes and places. Services can change.
- Food hours are checked for the whole visit. Later dates may use regular weekly hours; holiday hours can differ. Missing hours are labelled unverified.
- The planner searches a limited set of combinations. Fewer than three options may be shown, and “no plan found” does not prove that every possible route is impossible.
- The app does not monitor delays automatically or check trail closures.

## Troubleshooting

| Problem | Try this |
|---|---|
| Sample cafés still appear | Check both keys are saved in `.env`, restart, then generate a new plan. |
| `.env not found` | Put `.env` beside `server.js`, not inside `public/`. |
| Google API error | Check billing, enabled APIs, key restrictions and quotas. |
| Port already in use | Stop the other server before restarting. |
| Changes aren’t appearing | Save your files and refresh with **Ctrl+Shift+R**. |

## Project structure

```text
public/       Browser interface and styles
server.js     Local server and Google API integration
engine.js     Itinerary planning
options.js    Plan comparisons and opening-hours checks
data.js       Demo locations and time helpers
tests/        Automated tests
```

Run tests with:

```bash
npm test
```

## React frontend

The interface has three steps: trip details, comparison, and a selected itinerary with map and timeline. Edit src/App.jsx and src/styles.css; run npm run build to regenerate the files in public/. The Node backend and API contract are unchanged.

Demo mode uses existing sample route data and a labelled schematic map. Live mode supports automatic activity discovery or direct place selection, and uses the configured Google map. Place searches and planning in live mode may incur API usage costs. The app does not automatically request live plans.

Inputs remain in memory when moving between steps. Reloading the browser starts a new session. Mid-trip replanning keeps your original home and deadline; choose your last completed stop and edit remaining visit durations.



### Building on a streamed Google Drive folder

If `npm install` fails with filesystem or native-module write errors on G:, keep the source in this folder and install only the build dependencies on a local disk. The build script accepts a dependency location through `DAYTRIP_TOOLCHAIN` (the folder containing its package.json and node_modules).

For this session, the verified build command in PowerShell was:

```powershell
$env:DAYTRIP_TOOLCHAIN = 'C:\Users\apurv\Documents\Codex\2026-10-24\task\daytrip-ui'
npm run build
```

This points at the tools installed before the instruction to avoid making copies. No backend keys are stored there. `npm start` uses the compiled files already in public and does not require these tools. On a normal local filesystem, `npm install` followed by `npm run build` needs no override.
