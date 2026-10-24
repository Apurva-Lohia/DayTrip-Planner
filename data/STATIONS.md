# Station directory provenance and coverage

## Included locations

289 distinct boarding locations: 215 tagged Train, 21 tagged Metro, and 58 tagged Light rail. Five Train/Metro interchanges carry both tags, so the category counts overlap. The directory covers the existing Sydney/Blue Mountains search boundary (longitude 150.2 to 151.5 E, latitude -34.3 to -33.3), including suburban network endpoints and nearby intercity locations. Existing Central, Parramatta and Katoomba identifiers and demo data are retained.

Rail/Metro interchanges are represented once. Separate light rail boarding areas remain separate and explicitly named (for example Central Station, Central Light Rail and Central Chalmers Street Light Rail). This is a station-level spatial register; no platform or entrance records are imported. Numeric `sourceId` values are NSW Spatial Services TopoIDs, **not TfNSW GTFS stop IDs**. New application IDs use `nsw-station-<TopoID>`.

## Source and dates

Source: [NSW Transport Theme – Transport Services](https://portal.spatial.nsw.gov.au/portal/home/item.html?id=a524efb9a8a245ca8891ee665f1a30d3), Train Station layer, [public query API](https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/FeatureServer/1).

© State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.

The source metadata declares open access and Creative Commons terms. [Copyright / CC BY 4.0](https://www.nsw.gov.au/nsw-government/about-website/copyright). The catalogue changes names to readable case, classifies rail modes, restricts the geographic extent, and excludes the three records listed below. It is not endorsed by NSW Government.

Retrieved **24 October 2026**. The portal item was modified **18 August 2025**, while individual included feature updates range from **29 July 2011 to 9 February 2026**. Each record retains its own `sourceUpdated`; retrieval date is not a claim that all records were surveyed or updated that day. Coordinates are station facility points, not guaranteed accessible entrances. Original source names, TopoIDs, provenance, timestamp and source hash are stored in `stations.json`.

The public TfNSW GTFS Stops mirror was assessed but not imported: its records were dated **1 February 2024**, missing newer city Metro and Parramatta light rail locations. No TransportNSW route-page dataset was scraped into this catalogue.

## Operating status and limits

The importer selects registry `operationalstatus=1`. This is a spatial-directory flag, **not live service status**. It does not certify every station currently operating in Sydney, nor provide timetables, closures, station accessibility, platform assignments or future operating dates. Google live routing must find a real journey for the selected date; unsupported/infeasible journeys still fail normally.

The 21 Metro tags cover Tallawong–Sydenham; five interchanges also have Train tags. The ten Southwest conversion stations are retained with an explicit warning that Metro opening was announced for **30 October 2026**, after this snapshot. They are not counted as currently operating Metro stations. [Official opening announcement listing](https://www.sydneymetro.info/homepage) and [conversion information](https://www.sydneymetro.info/citysouthwest/sydenham-bankstown). Review these mode tags and notices when refreshing after an opening; source registry names do not encode route membership.

Explicit exclusions: Bradfield (future Western Sydney Airport Metro; [official project](https://www.sydneymetro.info/westernsydneyairportline)), Bottom Points (heritage Zig Zag railway) and Royal National Park Tramway (heritage tramway). Zig Zag mainline railway station remains included. The register includes 58 light rail locations including the Parramatta line, with distinct light rail labels.

Demo mode retains only the three original sample origins. Other directory stations can be browsed but are disabled in demo; the API also rejects them when live routing is off. The demo routing engine is unchanged. Live requests canonicalize known station IDs to authoritative stored coordinates, including mid-trip origins and stops. Existing custom-address and activity discovery remains available.

## Refresh

Run `npm run refresh:stations`, review the diff, then `npm test` and `npm run build`. The refresh command requires no account, API key or paid service. It paginates the official public layer, validates its error response, station count, unique IDs/names and all 21 Metro locations before writing. Failure leaves the previous file intact. Review exceptions and mode tags in `scripts/refresh-stations.mjs` rather than treating them as live network membership. Restart the server to load a refreshed catalogue.

The catalogue is checked in and served locally by `/api/config` and `/api/stations?q=...`; ordinary station search makes no Google request. There is no background refresh or runtime dependency on the source website.

To certify completeness against the latest actual operating network, obtain an authorized current TfNSW Complete GTFS download (including stops, routes, trips and stop_times) and reconcile it with this register. No new account, credential or paid feed was created in this change.
