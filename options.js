// Evaluate opening hours for the entire visit, using the Sydney local date.
export function foodAvailability(place, date, start, end) {
  if (
    place.businessStatus &&
    place.businessStatus !== "OPERATIONAL"
  ) {
    return {
      status: "closed",
      label: "Business is not operational",
    };
  }

  const target = Date.parse(date + "T00:00:00Z");
  const day = new Date(target).getUTCDay();

  const delta = place.hoursDate
    ? (target - Date.parse(place.hoursDate + "T00:00:00Z")) / 86400000
    : Infinity;

  const current =
    delta >= 0 &&
    delta < 7 &&
    place.currentOpeningHours;

  const hours = current || place.regularOpeningHours;

  if (!hours || !Array.isArray(hours.periods)) {
    return {
      status: "unknown",
      label: "Opening hours unavailable · check with venue",
    };
  }

  const source = current
    ? "date-specific hours"
    : "regular weekly hours";

  function datedMinute(point) {
    if (!point.date) return null;

    return (
      (Date.UTC(
        point.date.year,
        point.date.month - 1,
        point.date.day
      ) -
        target) /
        60000 +
      (point.hour || 0) * 60 +
      (point.minute || 0)
    );
  }

  const ranges = [];

  for (const period of hours.periods) {
    const open = period.open;
    const close = period.close;

    if (!open) continue;

    // Google's documented representation of a 24-hour venue.
    if (
      !close &&
      open.day === 0 &&
      (open.hour || 0) === 0 &&
      (open.minute || 0) === 0
    ) {
      ranges.push([-Infinity, Infinity]);
      continue;
    }

    if (!close) continue;

    const absoluteOpen = datedMinute(open);
    const absoluteClose = datedMinute(close);

    if (
      current &&
      absoluteOpen !== null &&
      absoluteClose !== null
    ) {
      ranges.push([absoluteOpen, absoluteClose]);
      continue;
    }

    // Incomplete special-date information must not be treated as verified.
    if (current) continue;

    let a =
      (open.day - day) * 1440 +
      (open.hour || 0) * 60 +
      (open.minute || 0);

    let b =
      (close.day - day) * 1440 +
      (close.hour || 0) * 60 +
      (close.minute || 0);

    if (b <= a) b += 10080;

    // Include previous/next week to handle overnight Sunday boundaries.
    for (const shift of [-10080, 0, 10080]) {
      ranges.push([a + shift, b + shift]);
    }
  }

  if (current && hours.periods.length && !ranges.length) {
    return {
      status: "unknown",
      label: "Date-specific hours incomplete · check with venue",
    };
  }

  const open = ranges.some(
    ([a, b]) => start >= a && end <= b
  );

  return {
    status: open ? "open" : "closed",
    source,
    label: open
      ? `Fits ${source}${
          current ? "" : " · special hours may differ"
        }`
      : `Closed for part of this visit (${source})`,
  };
}

function foodIds(plan) {
  return plan.events
    .filter(
      (event) =>
        event.type === "visit" &&
        ["cafe", "lunch"].includes(event.place.kind)
    )
    .map((event) => event.place.id)
    .join("|");
}

export function materiallyDifferent(a, b) {
  return (
    a.order.join("|") !== b.order.join("|") ||
    foodIds(a) !== foodIds(b) ||
    a.transfers !== b.transfers ||
    Math.abs(a.walk - b.walk) >= 10 ||
    Math.abs(a.travel - b.travel) >= 20 ||
    Math.abs(a.slack - b.slack) >= 45
  );
}

export function selectOptions(feasible) {
  if (!feasible.length) return [];

  const result = [];

  const unknown = (plan) =>
    plan.events.filter(
      (event) => event.availability?.status === "unknown"
    ).length;

  const ranked = (score) =>
    [...feasible].sort(
      (a, b) =>
        unknown(a) - unknown(b) ||
        score(a) - score(b) ||
        Number(b.withinWindow) - Number(a.withinWindow)
    );

  const objectives = [
    ["Quickest day", (plan) => plan.travel],
    [
      "Easier connections",
      (plan) =>
        plan.transfers * 25 +
        plan.walk * 1.5 +
        plan.travel * 0.15,
    ],
    ["More spare time", (plan) => -plan.slack],
  ];

  for (const [label, score] of objectives) {
    const candidates = ranked(score);
    const plan = candidates.find((candidate) =>
      result.every((selected) =>
        materiallyDifferent(candidate, selected)
      )
    );

    if (!plan) continue;

    const optimum = Math.min(...feasible.map(score));

    const title =
      score(plan) <= optimum + 0.01
        ? label
        : foodIds(plan) !== foodIds(result[0] || plan)
          ? "Different food stops"
          : plan.preferred
            ? "Your preferred order"
            : "Alternative route";

    result.push({
      ...plan,
      title,
      id: "plan-" + result.length,
    });
  }

  // Fill remaining slots only with materially different options.
  for (const plan of ranked(
    (p) => p.travel + p.walk + p.transfers * 15
  )) {
    if (result.length >= 3) break;

    if (
      result.every((selected) =>
        materiallyDifferent(plan, selected)
      )
    ) {
      result.push({
        ...plan,
        title:
          foodIds(plan) !== foodIds(result[0])
            ? "Different food stops"
            : "Alternative route",
        id: "plan-" + result.length,
      });
    }
  }

  return result.map((plan, index) => {
    const others = result.filter((_, i) => i !== index);
    const pros = [];
    const cons = [];

    const metrics = [
      ["travel", "travel", "min", true],
      ["walk", "walking", "min", true],
      ["transfers", "transfers", "", true],
      ["slack", "time before your deadline", "min", false],
    ];

    for (const [key, label, unit, lowerIsBetter] of metrics) {
      if (!others.length) continue;

      const best = lowerIsBetter
        ? Math.min(...others.map((p) => p[key]))
        : Math.max(...others.map((p) => p[key]));

      const delta = Math.round(plan[key] - best);
      if (delta === 0) continue;

      const better = lowerIsBetter
        ? delta < 0
        : delta > 0;

      const text =
        `${Math.abs(delta)} ${unit} ` +
        `${delta < 0 ? "less" : "more"} ${label} ` +
        "than the best other option";

      (better ? pros : cons).push(text.replace("  ", " "));
    }

    if (plan.preferred) {
      pros.push("Keeps your sight order");
    }

    if (!plan.withinWindow) {
      cons.push("Returns before your preferred window");
    }

    if (unknown(plan)) {
      cons.push("Some food opening hours need confirmation");
    }

    if (!pros.length) {
      pros.push("All requested visits fit");
    }

    return { ...plan, pros, cons };
  });
}