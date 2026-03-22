# Ride detail API — client cache & conditional GET

## App behavior (`src/services/rideDetailCache.ts`)

| Mechanism | Purpose |
|-----------|---------|
| **Cache key** | `rideId + viewer userId` — same ride for User A and User B never shares one entry (avoids wrong `viewerIsOwner` after logout/login when ETag/304 matched incorrectly). Pass **`viewerUserId`** on every `fetchRideDetailRaw` call. |
| **Stale time (~45s)** | `GET /api/rides/:id` is skipped if the same **key** was loaded successfully within `RIDE_DETAIL_STALE_MS`. |
| **In-flight dedupe** | Multiple callers for the same **key** share one HTTP request. |
| **If-None-Match / 304** | After stale time, if the last response had an **ETag**, the client sends `If-None-Match`. **304** reuses cached JSON (no body). Backend should include viewer in ETag (see server). |
| **Force refresh** | `fetchRideDetailRaw(id, { force: true, viewerUserId })` bypasses TTL and conditional headers (full GET). Ride detail screen uses **force on mount** so navigation params are never the only source of `viewerIsOwner`. |
| **Logout / login** | `clearRideDetailCache()` clears all entries and in-flight promises. |
| **Invalidate list cache** | `clearRideDetailCache()` on pull-to-refresh and retry so detail fetches are not stale for 45s after a refresh. |

## Backend (your server)

- `GET /api/rides/:id` should return **`ETag`** (and optionally **`Last-Modified`**) on **200**.
- When the client sends **`If-None-Match: "<etag>"`** and nothing changed, respond **`304 Not Modified`** with an empty body.

## What this does *not* cache yet

- **`GET /api/rides`** (list) and **`GET /api/bookings`** — still called on each `YourRides`/`SearchResults` load; add similar TTL or TanStack Query if needed.

## Your rides list (driver vs passenger)

| Endpoint | Role |
|----------|------|
| **`GET /api/my-rides`** | Rides you **published** (driver). Fallback: `GET /api/rides` if `/my-rides` is unavailable. |
| **`GET /api/rides/booked`** | Rides you **booked** as a passenger (incl. owner-cancelled). Merged with the driver list in `YourRides`. |
| **`GET /api/bookings`** | Still used to merge **status** / embedded rides when a ride is missing from the above. |
