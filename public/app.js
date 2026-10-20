const $ = (id) => document.getElementById(id);

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]
  );

function fmt(value) {
  const minutes = Math.round(value);

  return (
    `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:` +
    `${String(minutes % 60).padStart(2, "0")}` +
    (minutes >= 1440 ? " +1 day" : "")
  );
}

function duration(value) {
  const minutes = Math.round(value);

  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
}

let config;
let stops = [];
let origins = [];
let maps = [];
let lastInput;
let lastResult;
let pickerTarget = "stop";
let adjustedPlan;
let busy = false;
let searchVersion = 0;

const storage = {
  get() {
    try {
      return JSON.parse(localStorage.getItem("daytrip-input"));
    } catch {
      return null;
    }
  },

  set(value) {
    try {
      localStorage.setItem(
        "daytrip-input",
        JSON.stringify(value)
      );
    } catch {
      // Planning still works if local storage is unavailable.
    }
  },
};

function showStops() {
  $("stops").innerHTML = stops
    .map(
      (stop, index) => `
        <div class="stop">
          <div class="stop-top">
            <span class="number">${index + 1}</span>
            <b>${esc(stop.name)}</b>
            <button
              type="button"
              class="text-btn"
              data-action="up"
              data-i="${index}"
              aria-label="Move ${esc(stop.name)} earlier"
            >↑</button>
            <button
              type="button"
              class="text-btn"
              data-action="remove"
              data-i="${index}"
              aria-label="Remove ${esc(stop.name)}"
            >×</button>
          </div>
          <div class="duration">
            <span>Stay for</span>
            <button
              type="button"
              data-action="minus"
              data-i="${index}"
              aria-label="Reduce duration"
            >−</button>
            <input
              type="number"
              min="5"
              max="360"
              step="5"
              data-i="${index}"
              value="${stop.duration}"
              aria-label="Minutes at ${esc(stop.name)}"
            >
            <button
              type="button"
              data-action="plus"
              data-i="${index}"
              aria-label="Increase duration"
            >+</button>
            <span>min</span>
          </div>
        </div>
      `
    )
    .join("");

  $("add").disabled = stops.length >= 4;
}

function fillOrigins(selected) {
  $("origin").innerHTML = origins
    .map(
      (place) =>
        `<option value="${esc(place.id)}">` +
        `${esc(place.name)}</option>`
    )
    .join("");

  if (selected) $("origin").value = selected;
}

function reset() {
  stops = [
    {
      ...config.places.find((place) => place.id === "sisters"),
      duration: 60,
    },
    {
      ...config.places.find((place) => place.id === "falls"),
      duration: 120,
    },
  ];

  $("date").value = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const defaults = {
    startMin: "08:00",
    startMax: "09:00",
    returnMin: "18:00",
    returnMax: "20:00",
  };

  for (const [key, value] of Object.entries(defaults)) {
    $(key).value = value;
  }

  $("cafe").checked = false;
  $("lunch").checked = false;
  $("train").checked = true;
  $("bus").checked = true;

  fillOrigins("central");
  showStops();
}

function collect() {
  return {
    origin: origins.find(
      (place) => place.id === $("origin").value
    ),
    date: $("date").value,
    startMin: $("startMin").value,
    startMax: $("startMax").value,
    returnMin: $("returnMin").value,
    returnMax: $("returnMax").value,
    stops: stops.map((stop) => ({ ...stop })),
    cafe: $("cafe").checked,
    lunch: $("lunch").checked,
    modes: [
      $("train").checked ? "TRAIN" : null,
      $("bus").checked ? "BUS" : null,
    ].filter(Boolean),
    live: config.liveReady,
  };
}

async function generate(input) {
  if (busy) return;

  busy = true;
  $("submit").disabled = true;
  $("submit").textContent = "Connecting your day…";
  $("replan").disabled = true;
  $("notice").className = "";
  $("notice").textContent =
    "Comparing routes, food opening hours and complete day plans…";

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const data = await response.json();

    if (!response.ok) {
      throw Error(data.error);
    }

    lastInput = input;
    lastResult = data;

    if (!input.replan) {
      storage.set(input);
    }

    render(data);

    $("notice").textContent =
      data.mode === "live" && (input.cafe || input.lunch)
        ? "Food hours are checked for the full visit. " +
          "Regular weekly hours may differ on special dates; " +
          "unverified venues are labelled."
        : "";

    if (!data.plans.length) {
      $("notice").textContent = data.message;
      $("notice").className = "error";
    }

    $("adjust").close();
  } catch (error) {
    $("notice").textContent = error.message;
    $("notice").className = "error";

    if ($("adjust").open) {
      $("adjust").close();
    }
  } finally {
    busy = false;
    $("submit").disabled = false;
    $("submit").textContent = "Find my day ↗";
    $("replan").disabled = false;
  }
}

function visitMarkup(event) {
  return `
    <div class="event">
      <time>${fmt(event.start)} – ${fmt(event.end)}</time>
      <b>${esc(event.place.name)}</b>
      <small>
        ${duration(event.end - event.start)} to enjoy
        ${
          event.availability
            ? " · " + esc(event.availability.label)
            : ""
        }
      </small>
    </div>
  `;
}

function travelMarkup(event) {
  const modeSummary = event.steps
    .map((step) =>
      step.mode === "WALK"
        ? "Walk"
        : step.mode === "BUS"
          ? "Bus"
          : "Train"
    )
    .filter(
      (mode, index, all) =>
        index === 0 || all[index - 1] !== mode
    )
    .join(" + ");

  const steps = event.steps
    .map((step) => {
      const agencies = (step.agencies || [])
        .map((agency) =>
          agency.uri && /^https?:/.test(agency.uri)
            ? ` · <a href="${esc(agency.uri)}"
                    target="_blank"
                    rel="noopener">${esc(agency.name)}</a>`
            : ""
        )
        .join("");

      return (
        `<li>${fmt(step.start)} ${esc(step.label)}` +
        `${agencies}</li>`
      );
    })
    .join("");

  return `
    <div class="event travel">
      <time>${fmt(event.start)} – ${fmt(event.end)}</time>
      <b>${esc(event.from.name)} → ${esc(event.to.name)}</b>
      <details>
        <summary>
          ${duration(event.minutes)} · ${modeSummary}
        </summary>
        <ul>${steps}</ul>
      </details>
    </div>
  `;
}

function render(data) {
  for (const map of maps) {
    map.remove?.();
  }

  maps = [];
  $("empty").hidden = true;

  $("summary").textContent =
    (data.replanned ? "Remaining day · " : "") +
    data.message;

  $("cards").innerHTML = data.plans
    .map((plan, index) => {
      const visits = plan.events.filter(
        (event) => event.type === "visit"
      );

      return `
        <article class="card">
          <div class="card-head">
            <span class="tag">
              OPTION 0${index + 1} ·
              ${
                data.mode === "demo"
                  ? "SAMPLE SCHEDULE"
                  : "LIVE ROUTING"
              }
            </span>
            <h3>${esc(plan.title)}</h3>
            <div class="route-summary">
              ${visits
                .map((event) => esc(event.place.name))
                .join(" → ")}
            </div>
          </div>

          <div
            class="map"
            id="map-${index}"
            aria-label="Map of ${esc(plan.title)}"
          ></div>

          <div class="map-note">
            ${
              data.mode === "demo"
                ? "Illustrative straight lines · not actual transit paths"
                : "Provider route geometry · train, bus and walking legs"
            }
          </div>

          <div class="stats">
            <div>
              <small>LEAVE</small>
              <b>${fmt(plan.departure)}</b>
            </div>
            <div>
              <small>HOME</small>
              <b>${fmt(plan.arrival)}</b>
            </div>
            <div>
              <small>TRAVEL + WAITING</small>
              <b>${duration(plan.travel)}</b>
            </div>
            <div>
              <small>BEFORE DEADLINE</small>
              <b>${duration(plan.slack)}</b>
            </div>
          </div>

          <div class="tradeoffs">
            ${(plan.pros || [])
              .map((text) => `<p>＋ ${esc(text)}</p>`)
              .join("")}
            ${(plan.cons || [])
              .map((text) => `<p>↳ ${esc(text)}</p>`)
              .join("")}
          </div>

          <div class="timeline">
            ${plan.events
              .map((event) =>
                event.type === "visit"
                  ? visitMarkup(event)
                  : travelMarkup(event)
              )
              .join("")}
          </div>

          <div class="card-footer">
            <button
              class="primary"
              data-plan="${index}"
            >Change my plans ↗</button>
          </div>
        </article>
      `;
    })
    .join("");

  data.plans.forEach((plan, index) =>
    drawMap(plan, index, data.mode)
  );

  renderComparison(data);
}

function drawMap(plan, index, mode) {
  const travelEvents = plan.events.filter(
    (event) => event.type === "travel"
  );

  const points = travelEvents.flatMap(
    (event) => event.path
  );

  const visits = plan.events.filter(
    (event) => event.type === "visit"
  );

  if (!points.length) return;

  const container = $("map-" + index);
  const color = ["#285d49", "#c97b38", "#6679a0"][index];

  if (mode === "live" && !window.google?.maps) {
    container.textContent =
      "Google Maps is unavailable. Check the browser API key.";
    return;
  }

  if (mode === "live" && window.google?.maps) {
    const map = new google.maps.Map(container, {
      center: {
        lat: points[0][0],
        lng: points[0][1],
      },
      zoom: 10,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    const bounds = new google.maps.LatLngBounds();

    for (const event of travelEvents) {
      new google.maps.Polyline({
        map,
        path: event.path.map(([lat, lng]) => ({
          lat,
          lng,
        })),
        strokeColor: color,
        strokeWeight: 4,
      });

      event.path.forEach(([lat, lng]) =>
        bounds.extend({ lat, lng })
      );
    }

    visits.forEach((event, visitIndex) => {
      new google.maps.Marker({
        map,
        position: {
          lat: event.place.lat,
          lng: event.place.lng,
        },
        label: String(visitIndex + 1),
        title: event.place.name,
      });
    });

    map.fitBounds(bounds);
    return;
  }

  if (!window.L) {
    container.innerHTML =
      '<p style="padding:20px">' +
      "Map library could not load. Internet access is needed " +
      "for maps. The itinerary is still available below.</p>";
    return;
  }

  const map = L.map(container, {
    scrollWheelZoom: false,
  }).fitBounds(points, {
    padding: [22, 22],
  });

  maps.push(map);

  L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">' +
        "OpenStreetMap</a>",
    }
  ).addTo(map);

  for (const event of travelEvents) {
    L.polyline(event.path, {
      color,
      weight: 3,
      dashArray: "6 7",
    }).addTo(map);
  }

  function marker(lat, lng, label, name) {
    return L.marker([lat, lng], {
      icon: L.divIcon({
        className: "pin",
        html: label,
        iconSize: [26, 26],
      }),
    })
      .addTo(map)
      .bindPopup(esc(name));
  }

  marker(
    travelEvents[0].from.lat,
    travelEvents[0].from.lng,
    "H",
    travelEvents[0].from.name
  );

  visits.forEach((event, visitIndex) =>
    marker(
      event.place.lat,
      event.place.lng,
      String(visitIndex + 1),
      event.place.name
    )
  );
}

function renderComparison(data) {
  let comparison = $("comparison");

  if (!comparison) {
    comparison = document.createElement("div");
    comparison.id = "comparison";
    $("cards").before(comparison);
  }

  const rows = [
    ["Travel + waiting", (plan) => duration(plan.travel)],
    ["Walking", (plan) => duration(plan.walk || 0)],
    ["Transfers within journeys", (plan) => plan.transfers],
    ["Before home deadline", (plan) => duration(plan.slack)],
    [
      "Food stops",
      (plan) =>
        plan.events
          .filter(
            (event) =>
              event.type === "visit" &&
              ["cafe", "lunch"].includes(event.place.kind)
          )
          .map((event) => event.place.name)
          .join(" · ") || "None",
    ],
  ];

  comparison.innerHTML = data.plans.length
    ? `
      <div class="compare-scroll">
        <table>
          <thead>
            <tr>
              <th>Compare your day</th>
              ${data.plans
                .map((plan) => `<th>${esc(plan.title)}</th>`)
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                ([label, value]) => `
                  <tr>
                    <th>${label}</th>
                    ${data.plans
                      .map(
                        (plan) => `<td>${esc(value(plan))}</td>`
                      )
                      .join("")}
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `
    : "";

  let foods = $("food-choices");

  if (!foods) {
    foods = document.createElement("section");
    foods.id = "food-choices";
    $("cards").after(foods);
  }

  foods.innerHTML = (data.foodAlternatives || []).length
    ? `
      <h3>Food stops that fit a complete day</h3>
      <p class="food-note">
        Each choice has a tested journey home. Selecting one
        replaces the itinerary view so you can inspect its full route.
      </p>
      <div class="food-grid">
        ${data.foodAlternatives
          .map(
            (food, index) => `
              <article>
                <b>${esc(food.place.name)}</b>
                <p>
                  ${fmt(food.start)}–${fmt(food.end)}
                  · home ${fmt(food.plan.arrival)}
                </p>
                <small>${esc(food.availability.label)}</small>
                <button
                  class="secondary"
                  data-food="${index}"
                >View this day ↗</button>
              </article>
            `
          )
          .join("")}
      </div>
    `
    : "";

  foods.onclick = (event) => {
    const button = event.target.closest("[data-food]");
    if (!button) return;

    const selected =
      data.foodAlternatives[Number(button.dataset.food)].plan;

    lastResult = {
      ...data,
      plans: [selected],
      message: "Complete itinerary using your selected food stop.",
    };

    render(lastResult);
  };
}

async function search() {
  const version = ++searchVersion;
  const query = $("search").value.trim();

  $("search-note").textContent = "Searching…";

  try {
    const response = await fetch(
      "/api/places?q=" + encodeURIComponent(query)
    );

    const data = await response.json();

    if (version !== searchVersion) return;

    if (!response.ok) {
      throw Error(data.error);
    }

    const results = query
      ? data
      : config.places.filter(
          (place) => !["cafe", "lunch"].includes(place.kind)
        );

    $("search-note").textContent = config.liveReady
      ? "Select a result."
      : "Demo catalogue · live place search is available after API setup.";

    $("search-results").innerHTML = "";

    if (!results.length) {
      $("search-note").textContent =
        "No matching places. Try a suburb or choose a demo location.";
    }

    for (const place of results) {
      const button = document.createElement("button");
      button.textContent = place.name;

      button.onclick = () => {
        if (pickerTarget === "origin") {
          if (!origins.some((origin) => origin.id === place.id)) {
            origins.push(place);
          }

          fillOrigins(place.id);
        } else if (stops.length < 4) {
          stops.push({
            ...place,
            duration: 60,
          });

          showStops();
        }

        $("picker").close();
      };

      $("search-results").append(button);
    }
  } catch (error) {
    $("search-note").textContent = error.message;
  }
}

function openPicker(target) {
  pickerTarget = target;
  $("search").value = "";
  $("picker").showModal();
  search();
}

function remainingControls() {
  const completed = Number($("completed").value);

  $("remaining").innerHTML = adjustedPlan
    .map((stop, index) =>
      index < completed
        ? ""
        : `
          <label>
            ${esc(stop.name)} · minutes remaining
            <input
              type="number"
              value="${stop.duration}"
              min="5"
              max="360"
              data-remaining="${index}"
            >
          </label>
        `
    )
    .join("");
}

function adjust(index) {
  const plan = lastResult.plans[index];

  adjustedPlan = plan.events
    .filter(
      (event) =>
        event.type === "visit" &&
        !["cafe", "lunch"].includes(event.place.kind)
    )
    .map((event) => ({
      ...event.place,
      duration: event.end - event.start,
    }));

  $("completed").innerHTML =
    '<option value="0">' +
    "No sights yet · at this plan’s starting point" +
    "</option>" +
    adjustedPlan
      .map(
        (stop, i) =>
          `<option value="${i + 1}">${esc(stop.name)}</option>`
      )
      .join("");

  $("now").value = fmt(plan.departure).slice(0, 5);
  $("again-cafe").checked = false;
  $("again-lunch").checked = false;

  remainingControls();
  $("adjust").showModal();
  $("adjust").dataset.plan = index;
}

async function boot() {
  try {
    const response = await fetch("/api/config");
    config = await response.json();

    origins = config.places.filter(
      (place) => place.kind === "origin"
    );

    reset();

    const saved = storage.get();

    if (saved?.stops?.length) {
      stops = saved.stops;

      if (
        saved.origin &&
        !origins.some((place) => place.id === saved.origin.id)
      ) {
        origins.push(saved.origin);
      }

      fillOrigins(saved.origin?.id);

      for (const key of [
        "date",
        "startMin",
        "startMax",
        "returnMin",
        "returnMax",
      ]) {
        if (saved[key]) $(key).value = saved[key];
      }

      $("cafe").checked = !!saved.cafe;
      $("lunch").checked = !!saved.lunch;
      $("train").checked = saved.modes?.includes("TRAIN");
      $("bus").checked = saved.modes?.includes("BUS");

      showStops();
    }

    $("mode").textContent = config.liveReady
      ? "● Live Google routing"
      : "◌ Demo · sample schedules";

    if (config.liveReady) {
      $("data-note").textContent =
        "Google routing · live API requests may incur charges";

      await new Promise((resolve, reject) => {
        window.daytripMapReady = resolve;

        const script = document.createElement("script");
        script.src =
          "https://maps.googleapis.com/maps/api/js?key=" +
          encodeURIComponent(config.browserKey) +
          "&callback=daytripMapReady&loading=async";

        script.onerror = () =>
          reject(
            Error(
              "Google Maps could not load. " +
              "Check the browser key and network."
            )
          );

        document.head.append(script);
      });
    }
  } catch (error) {
    $("notice").textContent = error.message;
    $("notice").className = "error";
  }
}

$("form").addEventListener("submit", (event) => {
  event.preventDefault();
  generate(collect());
});

$("reset").onclick = reset;

$("example").onclick = () => {
  reset();
  generate(collect());
};

$("add").onclick = () => openPicker("stop");
$("find-origin").onclick = () => openPicker("origin");
$("close-picker").onclick = () => $("picker").close();
$("close-adjust").onclick = () => $("adjust").close();

let debounce;

$("search").oninput = () => {
  clearTimeout(debounce);
  debounce = setTimeout(search, 350);
};

$("stops").onclick = (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const index = Number(button.dataset.i);
  const action = button.dataset.action;

  if (action === "remove") {
    stops.splice(index, 1);
  }

  if (action === "up" && index > 0) {
    [stops[index - 1], stops[index]] = [
      stops[index],
      stops[index - 1],
    ];
  }

  if (action === "minus") {
    stops[index].duration = Math.max(
      5,
      stops[index].duration - 15
    );
  }

  if (action === "plus") {
    stops[index].duration = Math.min(
      360,
      stops[index].duration + 15
    );
  }

  showStops();
};

$("stops").onchange = (event) => {
  if (event.target.matches("input")) {
    stops[Number(event.target.dataset.i)].duration =
      Number(event.target.value);
  }
};

$("cards").onclick = (event) => {
  const button = event.target.closest("[data-plan]");

  if (button) {
    adjust(Number(button.dataset.plan));
  }
};

$("completed").onchange = () => {
  const completed = Number($("completed").value);
  const plan =
    lastResult.plans[Number($("adjust").dataset.plan)];

  const visits = plan.events.filter(
    (event) =>
      event.type === "visit" &&
      !["cafe", "lunch"].includes(event.place.kind)
  );

  $("now").value = fmt(
    completed ? visits[completed - 1].end : plan.departure
  ).slice(0, 5);

  remainingControls();
};

$("replan").onclick = () => {
  const plan =
    lastResult.plans[Number($("adjust").dataset.plan)];

  const completed = Number($("completed").value);

  for (const input of $("remaining").querySelectorAll("input")) {
    adjustedPlan[Number(input.dataset.remaining)].duration =
      Number(input.value);
  }

  const updated = {
    ...lastInput,
    origin: lastInput.origin,
    stops: adjustedPlan,
    cafe: $("again-cafe").checked,
    lunch: $("again-lunch").checked,
    replan: {
      completed,
      time: $("now").value,
      currentOrigin: plan.events[0].from,
    },
  };

  generate(updated);
};

boot();