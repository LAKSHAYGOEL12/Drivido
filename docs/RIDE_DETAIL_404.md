# “Ride not found” (404) on `GET /api/rides/:id`

## What it means

The app calls **`GET /api/rides/<rideId>`** to load full detail (passengers, `viewerIsOwner`, etc.). The server responds **404** when:

- The ride was **deleted** or **hard-removed**
- The ride **never existed** on this server (wrong DB / seed reset)
- The id is **invalid** for your backend

## Why you still see the id in the app

**Your rides** is built from several sources merged together:

- `GET /my-rides`, `GET /rides/booked`, `GET /rides`, `GET /bookings`
- Embedded `ride` on booking rows
- Local **owner-cancelled** snapshots

If a **booking row** or **old list response** still references a ride that was later **deleted**, the UI may show or try to hydrate that ride → detail fetch → **404**. That’s a **data consistency** issue between list/booking APIs and ride-by-id, not a broken network.

## Backend (recommended)

- When a ride is deleted, either:
  - **Cascade** / clean up related **bookings**, or  
  - Return rides in list endpoints in a way that **matches** what `GET /rides/:id` can resolve (e.g. soft-delete with consistent filters).
- Ensure **the same id format** (e.g. Mongo `ObjectId` string) everywhere.

## App behavior

- Detail fetches that return **404** are caught where needed; those rows may simply miss enriched data.
- Dev console **no longer spams warnings** for this expected 404 pattern on `/rides/:id`.
