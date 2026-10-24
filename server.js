import http from "node:http";
import { stations, stationMetadata, searchStations, canonicalStationInput, googleTravelModes, googleVehicleTypes } from "./stations.js";
import { readFile } from "node:fs/promises";
import { places, sydneyTime, distance } from "./data.js";
import { buildDay } from "./day-planner.js";

// Load local keys when running with Node 22+.
// Vercel supplies its own environment variables.
if (!process.env.VERCEL) {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const serverKey = process.env.GOOGLE_SERVER_KEY?.trim();
const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY?.trim();
const liveReady = Boolean(serverKey && browserKey);

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function google(url, body, fields) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": serverKey,
      "X-Goog-FieldMask": fields
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });

  const data = await response.json();

  if (!response.ok) {
    throw Error(
      `Google API returned ${response.status}. Check enabled APIs, billing, key restrictions and quota.`
    );
  }

  return data;
}

// Broad Sydney / Blue Mountains search boundary.
function inRegion(p) {
  return (
    p.location &&
    p.location.latitude >= -34.3 &&
    p.location.latitude <= -33.3 &&
    p.location.longitude >= 150.2 &&
    p.location.longitude <= 151.5
  );
}

const venueFields = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.businessStatus",
  "places.currentOpeningHours",
  "places.regularOpeningHours"
].join(",");

const locationFields = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types"
].join(",");

function toPlace(p) {
  return {
    id: p.id,
    name: p.displayName?.text || p.formattedAddress,
    address: p.formattedAddress || "",
    lat: p.location.latitude,
    lng: p.location.longitude,
    types: p.types || [],
    businessStatus: p.businessStatus,
    currentOpeningHours: p.currentOpeningHours,
    regularOpeningHours: p.regularOpeningHours,
    hoursDate: today()
  };
}

async function searchPlaces(q, area, suburbsOnly = false) {
  const body = {
    textQuery: area
      ? `${q} near ${area.name}, NSW Australia`
      : `${q}, NSW Australia`,
    pageSize: area ? 6 : 20,
    regionCode: "AU",
    languageCode: "en",
    locationBias: area
      ? {
          circle: {
            center: {
              latitude: area.lat,
              longitude: area.lng
            },
            radius: 5000
          }
        }
      : {
          rectangle: {
            low: {
              latitude: -34.3,
              longitude: 150.2
            },
            high: {
              latitude: -33.3,
              longitude: 151.5
            }
          }
        }
  };

  const data = await google(
    "https://places.googleapis.com/v1/places:searchText",
    body,
    area ? venueFields : locationFields
  );

  return (data.places || [])
    .filter(inRegion)
    .map(toPlace)
    .filter(p => {
      const nearArea = !area || distance(p, area) <= 8;

      const isSuburb =
        !suburbsOnly ||
        p.types.some(type =>
          [
            "locality",
            "sublocality",
            "sublocality_level_1"
          ].includes(type)
        );

      return nearArea && isSuburb;
    });
}

const point = p => ({
  location: {
    latLng: {
      latitude: p.lat,
      longitude: p.lng
    }
  }
});

const sec = value => Number.parseFloat(value || "0s");

function decode(str) {
  let i = 0;
  let lat = 0;
  let lng = 0;
  const out = [];

  const next = () => {
    let n = 0;
    let shift = 0;
    let b;

    do {
      b = str.charCodeAt(i++) - 63;
      n |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32 && i < str.length);

    return n & 1 ? ~(n >> 1) : n >> 1;
  };

  while (i < str.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }

  return out;
}

async function route(a, b, start, input, walking = false) {
  const departure = sydneyTime(input.date, start);

  const body = {
    origin: point(a),
    destination: point(b),
    travelMode: walking ? "WALK" : "TRANSIT",
    languageCode: "en-AU"
  };

  if (!walking) {
    Object.assign(body, {
      departureTime: new Date(departure).toISOString(),
      computeAlternativeRoutes: true,
      transitPreferences: {
        allowedTravelModes: googleTravelModes(input.modes)
      }
    });
  }

  const data = await google(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    body,
    "routes.duration,routes.polyline,routes.legs.steps"
  );

  const allowed = googleVehicleTypes(input.modes);

  const suitable = (data.routes || []).filter(r => {
    if (!r.polyline?.encodedPolyline) return false;

    if (walking) {
      return sec(r.duration) <= 1800;
    }

    return r.legs.every(leg =>
      leg.steps.every(step =>
        step.travelMode !== "TRANSIT" ||
        allowed.has(
          step.transitDetails?.transitLine?.vehicle?.type
        )
      )
    );
  });

  return suitable.map(r => {
    let cursor = start;
    let wait = 0;
    const steps = [];

    for (const leg of r.legs) {
      for (const step of leg.steps) {
        const transit = step.transitDetails;
        const stopDetails = transit?.stopDetails;

        const begin = stopDetails?.departureTime
          ? start +
            (Date.parse(stopDetails.departureTime) - departure) /
              60000
          : cursor;

        const end = stopDetails?.arrivalTime
          ? start +
            (Date.parse(stopDetails.arrivalTime) - departure) /
              60000
          : begin + sec(step.staticDuration) / 60;

        wait += Math.max(0, begin - cursor);

        const mode =
          step.travelMode === "WALK"
            ? "WALK"
            : transit?.transitLine?.vehicle?.type?.includes("BUS")
              ? "BUS"
              : "TRAIN";

        const label =
          step.travelMode === "WALK"
            ? "Walk"
            : `${
                transit?.transitLine?.nameShort ||
                transit?.transitLine?.name ||
                "Transit"
              } → ${stopDetails?.arrivalStop?.name || ""}`;

        steps.push({
          mode,
          label,
          start: begin,
          end,
          agencies: transit?.transitLine?.agencies || []
        });

        cursor = end;
      }
    }

    const end = Math.max(
      cursor,
      start + sec(r.duration) / 60
    );

    return {
      start,
      departure: steps[0]?.start ?? start,
      end,
      minutes: end - start,
      wait,
      walk: walking
        ? end - start
        : steps
            .filter(step => step.mode === "WALK")
            .reduce(
              (total, step) => total + step.end - step.start,
              0
            ),
      transfers: Math.max(
        0,
        steps.filter(step => step.mode !== "WALK").length - 1
      ),
      steps,
      path: decode(r.polyline.encodedPolyline),
      sample: false
    };
  });
}

async function liveJourney(a, b, start, input) {
  if (distance(a, b) > 2) {
    return route(a, b, start, input);
  }

  // Compare transit with a direct walk for nearby stops.
  const results = await Promise.allSettled([
    route(a, b, start, input),
    route(a, b, start, input, true)
  ]);

  const routes = results.flatMap(result =>
    result.status === "fulfilled" ? result.value : []
  );

  if (
    !routes.length &&
    results.some(result => result.status === "rejected")
  ) {
    throw results.find(
      result => result.status === "rejected"
    ).reason;
  }

  return routes;
}

async function food(anchor, kind) {
  const data = await google(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      includedTypes: [
        kind === "cafe" ? "cafe" : "restaurant"
      ],
      maxResultCount: 3,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: {
          center: {
            latitude: anchor.lat,
            longitude: anchor.lng
          },
          radius: 1200
        }
      }
    },
    venueFields
  );

  return (data.places || []).map(toPlace);
}

let active = false;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (
      req.method === "GET" &&
      url.pathname === "/api/config"
    ) {
      return json(res, 200, {
        liveReady,
        browserKey: browserKey || null,
        places,
        stations,
        stationMetadata
      });
    }

    if (req.method === "GET" && url.pathname === "/api/stations") {
      return json(res, 200, { stations: searchStations((url.searchParams.get("q") || "").slice(0, 160)), metadata: stationMetadata });
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/places"
    ) {
      const q = (url.searchParams.get("q") || "")
        .trim()
        .slice(0, 160);

      if (q.length < 3) {
        return json(res, 200, []);
      }

      if (!liveReady) {
        return json(
          res,
          200,
          places.filter(p =>
            p.name.toLowerCase().includes(q.toLowerCase())
          )
        );
      }

      return json(
        res,
        200,
        await searchPlaces(
          q,
          null,
          url.searchParams.get("kind") === "suburb"
        )
      );
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/plan"
    ) {
      const origin = req.headers.origin;

      if (
        origin &&
        ![
          `http://${req.headers.host}`,
          `https://${req.headers.host}`
        ].includes(origin)
      ) {
        return json(res, 403, {
          error: "Cross-origin requests are not permitted."
        });
      }

      if (active) {
        return json(res, 429, {
          error:
            "A plan is already being calculated. Please wait."
        });
      }

      let body = "";

      for await (const chunk of req) {
        body += chunk;

        if (body.length > 100000) {
          return json(res, 413, {
            error: "Request too large."
          });
        }
      }

      let input = JSON.parse(body);
      input.live = liveReady && input.live === true;
      input = canonicalStationInput(input);

      if (input.live) {
        const days =
          (sydneyTime(input.date, 0) - Date.now()) /
          86400000;

        if (
          !Number.isFinite(days) ||
          days < -6 ||
          days > 99
        ) {
          throw Error(
            "Choose a date within the next 100 days."
          );
        }
      }

      active = true;

      try {
        const result = await buildDay(input, {
          search: searchPlaces,
          journey: input.live ? liveJourney : undefined,
          food: input.live ? food : null
        });

        return json(res, 200, result);
      } finally {
        active = false;
      }
    }

    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/styles.css": "styles.css"
    };

    const name = files[url.pathname];

    if (req.method !== "GET" || !name) {
      return json(res, 404, {
        error: "Not found"
      });
    }

    const content = await readFile(
      new URL("./public/" + name, import.meta.url)
    );

    res.writeHead(200, {
      "Content-Type": name.endsWith(".html")
        ? "text/html; charset=utf-8"
        : name.endsWith(".css")
          ? "text/css"
          : "text/javascript",
      "X-Content-Type-Options": "nosniff"
    });

    res.end(content);
  } catch (error) {
    json(res, 400, {
      error: error.message || "Unable to build your day."
    });
  }
});

// Used by api/index.js on Vercel.
export default server.listeners("request")[0];

// Used by npm start locally.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3000;

  server.listen(port, "127.0.0.1", () => {
    console.log(`Daytrip ready at http://localhost:${port}`);
  });
}