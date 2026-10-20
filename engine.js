import { distance, minute } from "./data.js";
import {
  foodAvailability,
  selectOptions,
} from "./options.js";

export function validate(input) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(input.date))
  ) {
    throw Error("Choose a travel date.");
  }

  const locations = [
    input.origin,
    ...(input.replan?.currentOrigin
      ? [input.replan.currentOrigin]
      : []),
    ...(input.stops || []),
  ];

  for (const place of locations) {
    if (
      !place ||
      typeof place.name !== "string" ||
      place.name.length > 200 ||
      !Number.isFinite(place.lat) ||
      !Number.isFinite(place.lng) ||
      place.lat < -35 ||
      place.lat > -32 ||
      place.lng < 149 ||
      place.lng > 153
    ) {
      throw Error(
        "Choose a location in the Sydney / Blue Mountains region."
      );
    }
  }

  if (
    !Array.isArray(input.stops) ||
    (!input.stops.length && !input.replan) ||
    input.stops.length > 4
  ) {
    throw Error("Choose between one and four sights.");
  }

  if (
    input.stops.some(
      (stop) =>
        !Number.isFinite(stop.duration) ||
        stop.duration < 5 ||
        stop.duration > 360
    )
  ) {
    throw Error("Each visit must be 5–360 minutes.");
  }

  for (const key of [
    "startMin",
    "startMax",
    "returnMin",
    "returnMax",
  ]) {
    minute(input[key]);
  }

  if (
    minute(input.startMin) > minute(input.startMax) ||
    minute(input.returnMin) > minute(input.returnMax) ||
    minute(input.startMin) >= minute(input.returnMax)
  ) {
    throw Error(
      "Check the order of your departure and return windows."
    );
  }

  if (
    !Array.isArray(input.modes) ||
    !input.modes.length ||
    input.modes.some(
      (mode) => !["TRAIN", "BUS"].includes(mode)
    )
  ) {
    throw Error("Select trains, buses, or both.");
  }

  if (
    input.replan &&
    (!Number.isFinite(input.replan.completed) ||
      !Number.isInteger(input.replan.completed) ||
      input.replan.completed < 0 ||
      input.replan.completed > input.stops.length)
  ) {
    throw Error("Choose a valid current stop.");
  }

  if (input.replan) {
    minute(input.replan.time);
  }
}

export async function demoJourney(a, b, start, input) {
  const km = distance(a, b);
  const walking = km < 1.4;
  const mode = walking ? "WALK" : km > 18 ? "TRAIN" : "BUS";

  if (mode !== "WALK" && !input.modes.includes(mode)) {
    return null;
  }

  const interval =
    mode === "TRAIN" ? 30 : mode === "BUS" ? 40 : 1;

  const departure = walking
    ? start
    : Math.ceil((start + 5) / interval) * interval;

  if (departure > 21 * 60 + 30) return null;

  const travel = Math.max(
    5,
    Math.round(
      (km / (walking ? 4 : mode === "TRAIN" ? 48 : 22)) * 60
    ) + (walking ? 0 : 12)
  );

  return {
    start,
    departure,
    end: departure + travel,
    minutes: departure + travel - start,
    wait: departure - start,
    transfers: 0,
    steps: [
      {
        mode,
        label: walking
          ? "Walk"
          : `Sample ${mode.toLowerCase()} service`,
        start: departure,
        end: departure + travel,
      },
    ],
    path: [
      [a.lat, a.lng],
      [b.lat, b.lng],
    ],
    sample: true,
  };
}

function permutations(items) {
  if (items.length < 2) return [items];

  return items.flatMap((value, index) =>
    permutations(items.filter((_, i) => i !== index)).map(
      (rest) => [value, ...rest]
    )
  );
}

function walkingMinutes(leg) {
  return (
    leg.walk ??
    leg.steps
      .filter((step) => step.mode === "WALK")
      .reduce(
        (total, step) => total + step.end - step.start,
        0
      )
  );
}

function sampleFood(anchor, kind) {
  return [0, 1, 2].map((index) => ({
    id: `sample-${kind}-${index}`,
    name: `Sample ${kind} ${index + 1} near ${anchor.name}`,
    lat: anchor.lat + 0.002 * (index + 1),
    lng: anchor.lng + 0.002 * index,
    regularOpeningHours: {
      periods: Array.from({ length: 7 }, (_, day) => ({
        open: { day, hour: 7 + index },
        close: { day, hour: 17 + index },
      })),
    },
  }));
}

export async function plan(
  input,
  provider = demoJourney,
  foodProvider = null
) {
  validate(input);

  let origin = input.origin;
  let stops = input.stops;
  let earliest = minute(input.startMin);
  let latest = minute(input.startMax);

  const home = input.origin;

  if (input.replan) {
    const completed = input.replan.completed;

    origin = completed
      ? stops[completed - 1]
      : input.replan.currentOrigin || origin;

    stops = stops.slice(completed);
    earliest = latest = minute(input.replan.time);
  }

  const foodGroups = [];

  for (const kind of ["cafe", "lunch"]) {
    if (!input[kind]) continue;

    const anchor =
      stops[
        Math.min(
          kind === "lunch" ? 1 : 0,
          Math.max(0, stops.length - 1)
        )
      ] || origin;

    const candidates = foodProvider
      ? await foodProvider(anchor, kind)
      : sampleFood(anchor, kind);

    if (!candidates.length) {
      throw Error(
        `No ${kind} candidates were found. Try without that break.`
      );
    }

    foodGroups.push(
      candidates.slice(0, 3).map((place) => ({
        ...place,
        kind,
        duration: kind === "cafe" ? 30 : 45,
      }))
    );
  }

  const orderKey = (order) =>
    order.map((stop) => stop.id || stop.name).join("|");

  const originalKey = orderKey(stops);

  const geometricDistance = (order) =>
    order.reduce(
      (total, stop, index) =>
        total + distance(index ? order[index - 1] : origin, stop),
      0
    );

  const orders = permutations(stops)
    .sort(
      (a, b) =>
        geometricDistance(a) - geometricDistance(b)
    )
    .slice(0, 5);

  if (!orders.some((order) => orderKey(order) === originalKey)) {
    orders.unshift(stops);
  }

  let requests = 0;
  let budgetReached = false;
  const cache = new Map();

  async function journey(a, b, time, style) {
    const key = JSON.stringify([
      a.lat,
      a.lng,
      b.lat,
      b.lng,
      time,
      input.modes,
    ]);

    if (!cache.has(key)) {
      if (requests >= 180) {
        budgetReached = true;
        return null;
      }

      requests++;
      cache.set(key, provider(a, b, time, input));
    }

    const value = await cache.get(key);
    const legs = (Array.isArray(value) ? value : [value])
      .filter(Boolean);

    const score = (leg) =>
      style === "easy"
        ? leg.minutes * 0.15 +
          (leg.transfers || 0) * 25 +
          walkingMinutes(leg) * 1.5
        : leg.minutes;

    return (
      legs.sort((a, b) => score(a) - score(b))[0] || null
    );
  }

  const foodSets = foodGroups.reduce(
    (sets, choices) =>
      sets.flatMap((set) =>
        choices.map((choice) => [...set, choice])
      ),
    [[]]
  );

  const departures = [
    ...new Set([
      earliest,
      Math.round((earliest + latest) / 2),
      latest,
    ]),
  ];

  const results = [];
  let checked = 0;

  for (const departure of departures) {
    for (const order of orders) {
      for (const style of ["fast", "easy"]) {
        for (const selectedFood of foodSets) {
          const sequence = [...order];

          // Put food stops where they add the least geographic detour.
          // Actual journey timing and hours are checked below.
          for (const food of selectedFood) {
            let bestPosition = 0;
            let bestDetour = Infinity;

            for (let i = 0; i <= sequence.length; i++) {
              const from = i ? sequence[i - 1] : origin;
              const to = sequence[i] || home;

              const detour =
                distance(from, food) +
                distance(food, to) -
                distance(from, to);

              if (detour < bestDetour) {
                bestDetour = detour;
                bestPosition = i;
              }
            }

            sequence.splice(bestPosition, 0, food);
          }

          let time = departure;
          let from = origin;
          let valid = true;
          let travel = 0;
          let wait = 0;
          let transfers = 0;
          let walk = 0;
          const events = [];

          const destinations = [
            ...sequence,
            { ...home, kind: "home", duration: 0 },
          ];

          for (const destination of destinations) {
            const leg = await journey(
              from,
              destination,
              time,
              style
            );

            if (!leg) {
              valid = false;
              break;
            }

            if (
              !Number.isFinite(leg.end) ||
              leg.end < time
            ) {
              throw Error(
                "The routing provider returned invalid timing."
              );
            }

            events.push({
              type: "travel",
              from,
              to: destination,
              ...leg,
            });

            travel += leg.minutes;
            wait += leg.wait || 0;
            transfers += leg.transfers || 0;
            walk += walkingMinutes(leg);

            time = leg.end;

            if (destination.kind !== "home") {
              const availability = ["cafe", "lunch"].includes(
                destination.kind
              )
                ? foodAvailability(
                    destination,
                    input.date,
                    time,
                    time + destination.duration
                  )
                : null;

              if (availability?.status === "closed") {
                valid = false;
                break;
              }

              events.push({
                type: "visit",
                place: destination,
                start: time,
                end: time + destination.duration,
                availability,
              });

              time += destination.duration;
            }

            from = destination;
          }

          checked++;

          if (valid) {
            results.push({
              departure,
              arrival: time,
              events,
              travel,
              wait,
              transfers,
              walk,
              order: order.map((stop) => stop.id || stop.name),
              preferred: orderKey(order) === originalKey,
              slack: minute(input.returnMax) - time,
              withinWindow:
                time >= minute(input.returnMin) &&
                time <= minute(input.returnMax),
            });
          }
        }
      }
    }
  }

  const feasible = results.filter((result) => result.slack >= 0);
  const chosen = selectOptions(feasible);
  const foodAlternatives = [];

  for (const group of foodGroups) {
    for (const venue of group) {
      const candidates = feasible
        .filter((candidate) =>
          candidate.events.some(
            (event) =>
              event.type === "visit" &&
              event.place.id === venue.id
          )
        )
        .sort((a, b) => a.travel - b.travel);

      if (!candidates.length) continue;

      const candidate = candidates[0];
      const visit = candidate.events.find(
        (event) =>
          event.type === "visit" &&
          event.place.id === venue.id
      );

      foodAlternatives.push({
        place: venue,
        start: visit.start,
        end: visit.end,
        availability: visit.availability,
        plan: {
          ...candidate,
          title: `Via ${venue.name}`,
          pros: ["This food stop and all visits fit"],
          cons:
            visit.availability.status === "unknown"
              ? ["Opening hours need confirmation"]
              : [],
        },
      });
    }
  }

  const closest = results.sort(
    (a, b) => a.arrival - b.arrival
  )[0];

  let message;

  if (chosen.length) {
    message =
      `${chosen.length} meaningfully different options found. ` +
      "Visit durations are preserved.";
  } else if (closest) {
    const arrival = Math.ceil(closest.arrival);
    const arrivalText =
      `${Math.floor(arrival / 60)}:` +
      String(arrival % 60).padStart(2, "0");

    message =
      `No tested plan fits. The earliest tested return is ` +
      `${arrivalText}, ${Math.ceil(-closest.slack)} minutes ` +
      "past your deadline. Shorten a visit, remove a stop, " +
      "or extend your return window.";
  } else {
    message =
      "No tested plan fits the routes and food hours. " +
      "Try fewer stops, different times or both transport modes.";
  }

  if (budgetReached) {
    message +=
      " Search stopped at the 180-route-request limit; " +
      "additional options may exist.";
  }

  return {
    plans: chosen,
    foodAlternatives,
    checked,
    requests,
    budgetReached,
    mode: input.live ? "live" : "demo",
    message,
    replanned: !!input.replan,
  };
}