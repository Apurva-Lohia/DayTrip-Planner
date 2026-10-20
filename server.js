import http from "node:http";
import { readFile } from "node:fs/promises";
import { plan, validate } from "./engine.js";
import { places, sydneyTime } from "./data.js";

const serverKey = process.env.GOOGLE_SERVER_KEY;
const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY;
const liveReady = !!(serverKey && browserKey);

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });

  response.end(JSON.stringify(data));
}

async function google(url, body, fields) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": serverKey,
      "X-Goog-FieldMask": fields,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  const data = await response.json();

  if (!response.ok) {
    throw Error(
      `Google API returned ${response.status}. ` +
      "Check enabled APIs, key restrictions, billing and quota."
    );
  }

  return data;
}

function point(place) {
  return {
    location: {
      latLng: {
        latitude: place.lat,
        longitude: place.lng,
      },
    },
  };
}

const seconds = (value) =>
  Number.parseFloat(value || "0s");

function decodePolyline(encoded) {
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const points = [];

  function next() {
    let value = 0;
    let shift = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32 && index < encoded.length);

    return value & 1 ? ~(value >> 1) : value >> 1;
  }

  while (index < encoded.length) {
    latitude += next();
    longitude += next();
    points.push([latitude / 1e5, longitude / 1e5]);
  }

  return points;
}

async function liveJourney(from, to, start, input) {
  const departure = sydneyTime(input.date, start);

  const data = await google(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      origin: point(from),
      destination: point(to),
      travelMode: "TRANSIT",
      departureTime: new Date(departure).toISOString(),
      computeAlternativeRoutes: true,
      transitPreferences: {
        allowedTravelModes: input.modes,
      },
      languageCode: "en-AU",
    },
    "routes.duration,routes.polyline,routes.legs.steps"
  );

  // Google treats allowedTravelModes as preferences.
  // Filter returned routes to enforce the app's chosen modes.
  const allowedVehicles = new Set(
    input.modes.flatMap((mode) =>
      mode === "TRAIN"
        ? [
            "RAIL",
            "HEAVY_RAIL",
            "COMMUTER_TRAIN",
            "HIGH_SPEED_TRAIN",
            "LONG_DISTANCE_TRAIN",
          ]
        : ["BUS", "INTERCITY_BUS", "TROLLEYBUS"]
    )
  );

  const routes = (data.routes || [])
    .filter((route) =>
      route.legs.every((leg) =>
        leg.steps.every(
          (step) =>
            step.travelMode !== "TRANSIT" ||
            allowedVehicles.has(
              step.transitDetails?.transitLine?.vehicle?.type
            )
        )
      )
    )
    .sort(
      (a, b) => seconds(a.duration) - seconds(b.duration)
    );

  return routes.map((route) => {
    let cursor = start;
    let wait = 0;
    const steps = [];

    for (const leg of route.legs) {
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
          : begin + seconds(step.staticDuration) / 60;

        wait += Math.max(0, begin - cursor);

        const mode =
          step.travelMode === "WALK"
            ? "WALK"
            : transit?.transitLine?.vehicle?.type?.includes("BUS")
              ? "BUS"
              : "TRAIN";

        const line =
          transit?.transitLine?.nameShort ||
          transit?.transitLine?.name ||
          "Transit";

        const destination =
          transit?.headsign ||
          stopDetails?.arrivalStop?.name ||
          "";

        steps.push({
          mode,
          label:
            step.travelMode === "WALK"
              ? "Walk"
              : `${line} → ${destination}`,
          start: begin,
          end,
          agencies: transit?.transitLine?.agencies || [],
        });

        cursor = end;
      }
    }

    const end = Math.max(
      cursor,
      start + seconds(route.duration) / 60
    );

    return {
      start,
      departure: steps[0]?.start || start,
      end,
      minutes: end - start,
      wait,
      walk: steps
        .filter((step) => step.mode === "WALK")
        .reduce(
          (total, step) => total + step.end - step.start,
          0
        ),
      transfers: Math.max(
        0,
        steps.filter((step) => step.mode !== "WALK").length - 1
      ),
      steps,
      path: decodePolyline(route.polyline.encodedPolyline),
      sample: false,
    };
  });
}

function toPlace(place) {
  return {
    id: place.id,
    name: place.displayName.text,
    lat: place.location.latitude,
    lng: place.location.longitude,
  };
}

async function food(anchor, kind) {
  const data = await google(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      includedTypes: [
        kind === "cafe" ? "cafe" : "restaurant",
      ],
      maxResultCount: 3,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: {
          center: {
            latitude: anchor.lat,
            longitude: anchor.lng,
          },
          radius: 1200,
        },
      },
    },
    [
      "places.id",
      "places.displayName",
      "places.location",
      "places.businessStatus",
      "places.currentOpeningHours",
      "places.regularOpeningHours",
    ].join(",")
  );

  const hoursDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (data.places || []).map((place) => ({
    ...toPlace(place),
    businessStatus: place.businessStatus,
    currentOpeningHours: place.currentOpeningHours,
    regularOpeningHours: place.regularOpeningHours,
    hoursDate,
  }));
}

let active = false;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");

    if (
      request.method === "GET" &&
      url.pathname === "/api/config"
    ) {
      return json(response, 200, {
        liveReady,
        browserKey: browserKey || null,
        places,
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/places"
    ) {
      const query = (url.searchParams.get("q") || "")
        .slice(0, 150);

      if (!query.trim()) {
        return json(response, 200, []);
      }

      if (!liveReady) {
        return json(
          response,
          200,
          places.filter(
            (place) =>
              !["cafe", "lunch"].includes(place.kind) &&
              place.name
                .toLowerCase()
                .includes(query.toLowerCase())
          )
        );
      }

      const data = await google(
        "https://places.googleapis.com/v1/places:searchText",
        {
          textQuery: query + " Sydney NSW Australia",
          maxResultCount: 6,
          locationBias: {
            circle: {
              center: {
                latitude: -33.79,
                longitude: 150.85,
              },
              radius: 50000,
            },
          },
        },
        "places.id,places.displayName,places.location"
      );

      return json(
        response,
        200,
        (data.places || []).map(toPlace)
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/plan"
    ) {
      const origin = request.headers.origin;
      const host = request.headers.host;

      if (
        origin &&
        origin !== `http://${host}` &&
        origin !== `https://${host}`
      ) {
        return json(response, 403, {
          error: "Cross-origin requests are not permitted.",
        });
      }

      if (active) {
        return json(response, 429, {
          error:
            "A plan is already being calculated. Please wait.",
        });
      }

      let body = "";

      for await (const chunk of request) {
        body += chunk;

        if (body.length > 24000) {
          return json(response, 413, {
            error: "Request too large.",
          });
        }
      }

      const input = JSON.parse(body);
      validate(input);
      input.live = liveReady && input.live === true;

      if (input.live) {
        const date = sydneyTime(input.date, 0);
        const days = (date - Date.now()) / 86400000;

        if (days < -6 || days > 99) {
          return json(response, 400, {
            error:
              "Live routing supports dates within about " +
              "7 days in the past and 100 days ahead.",
          });
        }
      }

      active = true;

      try {
        const result = await plan(
          input,
          input.live ? liveJourney : undefined,
          input.live ? food : null
        );

        return json(response, 200, result);
      } finally {
        active = false;
      }
    }

    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/styles.css": "styles.css",
    };

    if (
      request.method !== "GET" ||
      !files[url.pathname]
    ) {
      return json(response, 404, {
        error: "Not found",
      });
    }

    const name = files[url.pathname];
    const content = await readFile(
      new URL("./public/" + name, import.meta.url)
    );

    response.writeHead(200, {
      "Content-Type": name.endsWith(".html")
        ? "text/html; charset=utf-8"
        : name.endsWith(".css")
          ? "text/css"
          : "text/javascript",
      "X-Content-Type-Options": "nosniff",
    });

    response.end(content);
  } catch (error) {
    json(response, 400, {
      error: error.message || "Unable to build the plan.",
    });
  }
});

const port = Number(process.env.PORT) || 3000;

server.listen(port, "127.0.0.1", () => {
  console.log(`Daytrip is ready at http://localhost:${port}`);
});