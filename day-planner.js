import {
  plan,
  validate,
  demoJourney
} from "./engine.js";

import {
  foodAvailability,
  selectOptions
} from "./options.js";

import { minute } from "./data.js";

async function replanDay(input, services) {
  const completed = input.replan.completed;

  if (
    !Array.isArray(input.stops) ||
    input.stops.length > 6 ||
    !Number.isInteger(completed) ||
    completed < 0 ||
    completed > input.stops.length
  ) {
    throw Error("Invalid remaining stops.");
  }

  // Validate each stop individually because a day may contain
  // four activities plus two automatically added food stops.
  for (const stop of input.stops) {
    validate({
      ...input,
      stops: [stop],
      replan: undefined
    });
  }

  let from = completed
    ? input.stops[completed - 1]
    : input.replan.currentOrigin || input.origin;

  validate({
    ...input,
    origin: from,
    stops: [{ ...input.origin, duration: 5 }],
    replan: undefined
  });

  const departure = minute(input.replan.time);

  let time = departure;
  let travel = 0;
  let walk = 0;
  let wait = 0;
  let transfers = 0;

  const events = [];

  const remaining = [
    ...input.stops.slice(completed),
    {
      ...input.origin,
      kind: "home",
      duration: 0
    }
  ];

  for (const destination of remaining) {
    const value = await (
      services.journey || demoJourney
    )(from, destination, time, input);

    const legs = [value]
      .flat()
      .filter(Boolean)
      .filter(leg => {
        if (destination.kind === "home") return true;

        return (
          foodAvailability(
            destination,
            input.date,
            leg.end,
            leg.end + destination.duration
          ).status !== "closed"
        );
      });

    const leg = legs.sort(
      (a, b) => a.minutes - b.minutes
    )[0];

    if (!leg) {
      throw Error(
        `No tested route fits the opening hours for ${destination.name}.`
      );
    }

    events.push({
      type: "travel",
      from,
      to: destination,
      ...leg
    });

    travel += leg.minutes;
    walk += leg.walk || 0;
    wait += leg.wait || 0;
    transfers += leg.transfers || 0;

    time = leg.end;

    if (destination.kind !== "home") {
      events.push({
        type: "visit",
        place: destination,
        start: time,
        end: time + destination.duration,
        availability: foodAvailability(
          destination,
          input.date,
          time,
          time + destination.duration
        )
      });

      time += destination.duration;
    }

    from = destination;
  }

  const slack = minute(input.returnMax) - time;

  return {
    mode: input.live ? "live" : "demo",
    plans:
      slack < 0
        ? []
        : [
            {
              title: "Your updated day",
              events,
              departure,
              arrival: time,
              travel,
              walk,
              wait,
              transfers,
              slack,
              pros: [
                "Keeps your selected venues and remaining visit durations"
              ],
              cons: [],
              order: input.stops
                .slice(completed)
                .map(p => p.id)
            }
          ],
    message:
      slack < 0
        ? "The updated day misses your return deadline. Shorten a remaining visit or finish more stops before replanning."
        : "Remaining visits recalculated in their current order.",
    foodAlternatives: []
  };
}

export async function buildDay(input, services) {
  if (input.replan) {
    return replanDay(input, services);
  }

  // Preserve compatibility with the original direct-stop planner.
  if (!input.requests?.length) {
    return plan(
      input,
      services.journey,
      services.food
    );
  }

  validate(input);

  if (!input.live) {
    throw Error(
      "Activity planning needs live Google Places and Routes keys."
    );
  }

  if (
    !Array.isArray(input.requests) ||
    input.requests.length > 4
  ) {
    throw Error(
      "Add between one and four activity requests."
    );
  }

  const requests = input.requests.map(request => {
    const text = String(request.text || "").trim();
    const duration = Number(request.duration);

    if (
      !text ||
      text.length > 160 ||
      !Number.isFinite(duration) ||
      duration < 5 ||
      duration > 360
    ) {
      throw Error(
        "Each activity needs a description and a stay of 5–360 minutes."
      );
    }

    return { text, duration };
  });

  const groups = [];

  // Find candidates automatically for each activity.
  for (const request of requests) {
    const matches = [];

    for (const area of input.stops) {
      const found = await services.search(
        request.text,
        area
      );

      for (const place of found) {
        if (
          place.businessStatus === "CLOSED_PERMANENTLY" ||
          place.businessStatus === "CLOSED_TEMPORARILY"
        ) {
          continue;
        }

        if (!matches.some(p => p.id === place.id)) {
          matches.push(place);
        }
      }
    }

    if (!matches.length) {
      throw Error(
        `No matching venue for "${request.text}" near your selected suburbs. Try a clearer description or another suburb.`
      );
    }

    groups.push(
      matches.slice(0, 3).map(place => ({
        ...place,
        kind: "activity",
        request: request.text,
        duration: request.duration
      }))
    );
  }

  // Build a bounded set of candidate combinations.
  // Every combination must satisfy every activity request.
  const combinations = [];

  function visit(index, selected) {
    if (combinations.length >= 12) return;

    if (index === groups.length) {
      combinations.push(selected);
      return;
    }

    for (const place of groups[index]) {
      if (!selected.some(p => p.id === place.id)) {
        visit(index + 1, [...selected, place]);
      }
    }
  }

  visit(0, []);

  if (!combinations.length) {
    throw Error(
      "These requests resolve to the same venue. Combine them into one activity or make them more specific."
    );
  }

  // Test up to three venue combinations.
  const chosen = [];

  const indexes = [
    0,
    Math.floor(combinations.length / 2),
    combinations.length - 1
  ];

  for (const index of indexes) {
    if (!chosen.includes(combinations[index])) {
      chosen.push(combinations[index]);
    }
  }

  // Cache journeys across candidate days.
  // A nearby journey may make both a transit and a walking API call.
  const cache = new Map();
  let calls = 0;

  async function journey(a, b, time, settings) {
    const key = JSON.stringify([
      a.lat,
      a.lng,
      b.lat,
      b.lng,
      time,
      settings.date,
      settings.modes
    ]);

    if (!cache.has(key)) {
      if (calls >= 180) return [];

      calls++;

      cache.set(
        key,
        (services.journey || demoJourney)(
          a,
          b,
          time,
          settings
        )
      );
    }

    const value = await cache.get(key);

    return [value]
      .flat()
      .filter(Boolean)
      .filter(leg => {
        if (b.kind === "home" || !b.duration) {
          return true;
        }

        return (
          foodAvailability(
            b,
            settings.date,
            leg.end,
            leg.end + b.duration
          ).status !== "closed"
        );
      });
  }

  const foodCache = new Map();

  const food = services.food
    ? (anchor, kind) => {
        const key = JSON.stringify([
          anchor.lat,
          anchor.lng,
          kind
        ]);

        if (!foodCache.has(key)) {
          foodCache.set(
            key,
            services.food(anchor, kind)
          );
        }

        return foodCache.get(key);
      }
    : null;

  const results = [];

  for (const stops of chosen) {
    results.push(
      await plan(
        { ...input, stops },
        journey,
        food
      )
    );
  }

  const candidates = results
    .flatMap(result => result.plans)
    .map(candidate => ({
      ...candidate,
      events: candidate.events.map(event => {
        if (
          event.type !== "visit" ||
          event.place.kind !== "activity"
        ) {
          return event;
        }

        return {
          ...event,
          availability: foodAvailability(
            event.place,
            input.date,
            event.start,
            event.end
          )
        };
      })
    }));

  const plans = selectOptions(candidates);

  return {
    plans,
    foodAlternatives: [],
    mode: "live",
    requests: calls,
    checked: results.reduce(
      (total, result) => total + result.checked,
      0
    ),
    message: plans.length
      ? `${plans.length} day options found. Each includes all ${requests.length} activity requests. Venues were chosen near your selected suburbs; not every suburb is necessarily visited.`
      : "No tested combination fits all activities, opening hours and your return deadline. Shorten a stay, extend your day or change a request.",
    budgetReached: calls >= 180
  };
}