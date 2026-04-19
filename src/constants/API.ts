/**
 * Endpoint paths only. Backend origin for all requests: `EXPO_PUBLIC_API_URL` in `.env`
 * (`src/config/apiBaseUrl.ts`, `services/api.ts`). Do not use `API.baseUrl` for HTTP.
 */
export const API = {
  /** Not used by the app HTTP client — reference only (DigitalOcean deployment). */
  baseUrl: 'https://drivido-fzh4i.ondigitalocean.app',

  endpoints: {
    health: '/health',
    auth: {
      login: '/auth/login',
      register: '/auth/register',
      /** POST `{ idToken }` — Firebase `getIdToken()` → EcoPickO JWT + refresh (see `backendAuthExchange.ts`). */
      firebase: '/auth/firebase',
      me: '/auth/me',
      logout: '/auth/logout',
      verifyOtp: '/auth/verify-otp',
      refresh: '/auth/refresh',
    },
    legal: {
      /** GET current legal docs (required + optional), versioned by backend. */
      current: '/legal/current',
      /** POST user legal acceptances (versioned, audited server-side). */
      accept: '/legal/accept',
    },
    rides: {
      list: '/rides',
      /** Rides you published (driver). Prefer over GET /rides for my rides. */
      myPublished: '/my-rides',
      /** Rides you booked as a passenger (incl. owner-cancelled). */
      booked: '/rides/booked',
      search: '/rides/search',
      create: '/rides',
      detail: (id: string) => `/rides/${id}`,
      bookingRequests: (id: string) => `/rides/${id}/booking-requests`,
      cancel: (id: string) => `/rides/${id}/cancel`,
      // Legacy alias; prefer myPublished when the backend supports it.
      mine: '/rides/mine',
      /**
       * GET — public trip stats for profile (`completed`, `cancelled`, `totalTrips`, `lastTripAt`, etc.).
       * Client also probes `/trips/summary/:userId` when this 404s.
       */
      userTripsSummary: (userId: string) => `/users/${encodeURIComponent(userId)}/trips-summary`,
      /** Alternate shape some backends use (try after `userTripsSummary`). */
      tripsSummaryByUserId: (userId: string) => `/rides/trips-summary/${encodeURIComponent(userId)}`,
    },
    bookings: {
      create: '/bookings',
      list: '/bookings',
      /** GET — passenger booking attempt history (all rows; optional rideId, groupByRide). */
      history: '/bookings/history',
      approve: (bookingId: string) => `/bookings/${bookingId}/approve`,
      reject: (bookingId: string) => `/bookings/${bookingId}/reject`,
      /** DELETE — cancel passenger's own booking (body optional per backend). */
      cancel: (bookingId: string) => `/bookings/${bookingId}`,
      /**
       * POST — ride owner removes a confirmed passenger. Backend should set booking status to
       * `cancelled_by_owner` (or equivalent), block new bookings for that user+ride, and push-notify the passenger.
       */
      removePassenger: (bookingId: string) => `/bookings/${bookingId}/remove-passenger`,
    },
    user: {
      profile: '/user/profile',
      update: '/user/update',
      avatar: '/user/avatar',
      /** CRUD for profile vehicles (max 2). Also returned on GET /auth/me. */
      vehicles: {
        list: '/user/vehicles',
        create: '/user/vehicles',
        update: (vehicleId: string) => `/user/vehicles/${encodeURIComponent(vehicleId)}`,
        delete: (vehicleId: string) => `/user/vehicles/${encodeURIComponent(vehicleId)}`,
      },
      /**
       * POST — register Expo push token `{ expoPushToken, platform }`.
       * DELETE — remove tokens for current user (logout); optional if backend only upserts.
       */
      pushToken: '/user/push-token',
      /**
       * Grace-period account deletion. With default `EXPO_PUBLIC_API_PREFIX=/api` these are
       * `POST /api/user/account-deletion/request` and `POST /api/user/account-deletion/cancel`.
       * See `src/services/accountDeletion.ts`.
       */
      accountDeletion: {
        request: '/user/account-deletion/request',
        cancel: '/user/account-deletion/cancel',
      },
      /** Pause account — see `src/services/accountDeactivate.ts`. */
      deactivate: '/user/deactivate',
      /** Resume account when backend allows self-serve reactivation. */
      reactivate: '/user/reactivate',
    },
    upload: {
      aadhaar: '/upload/aadhaar',
    },
    chat: {
      /** GET – list conversations for current user */
      conversations: '/chat/conversations',
      /** GET – messages for a thread. Query: rideId, otherUserId */
      messages: '/chat/messages',
      /** POST – send message. Body: { rideId, otherUserId, text } */
      send: '/chat/messages',
      /** POST – mark thread read for current user. Body: { rideId, otherUserId } — syncs unread across devices */
      read: '/chat/conversations/read',
      /** DELETE – remove thread for current user. Query: rideId, otherUserId */
      deleteConversation: '/chat/conversations',
    },
    ratings: {
      check: '/ratings/check',
      list: '/ratings',
      create: '/ratings',
    },
    /** POST — client map route display observability (auth). Body: `{ event, rideId? }`. */
    telemetry: {
      mapRouteDisplay: '/telemetry/map-route-display',
    },
    recentSearches: {
      /** GET - list current user's recent searches */
      list: '/recent-searches',
      /** POST - add/update one recent search entry */
      upsert: '/recent-searches',
      /** DELETE - remove one recent search entry by id */
      remove: (id: string) => `/recent-searches/${id}`,
      /** DELETE - clear current user's recent searches */
      clear: '/recent-searches',
    },
    /** Same contract pattern as recentSearches — sync across devices when logged in. */
    recentPublished: {
      list: '/recent-published',
      upsert: '/recent-published',
      upsertByRide: (rideId: string) => `/recent-published/${encodeURIComponent(rideId)}`,
      remove: (id: string) => `/recent-published/${id}`,
      clear: '/recent-published',
    },
    recentPlaces: {
      /** GET - list current user's recent places */
      list: '/recent-places',
      /** POST - add/update one recent place entry */
      upsert: '/recent-places',
      /** DELETE - remove one recent place by placeId */
      remove: (placeId: string) => `/recent-places/${encodeURIComponent(placeId)}`,
      /** DELETE - clear current user's recent places (optional query fieldType) */
      clear: '/recent-places',
    },
  },

  /** Timeout in ms */
  timeout: 15000,

  /** Headers applied to every request */
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
} as const;

/** API keys for third-party services (maps, etc.). Prefer EXPO_PUBLIC_* in app config. */
export const KEYS = {
  googleMaps: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '',
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
} as const;
