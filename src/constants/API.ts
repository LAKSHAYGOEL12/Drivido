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
      /** POST `{ idToken }` — Firebase `getIdToken()` → Drivido JWT + refresh (see `backendAuthExchange.ts`). */
      firebase: '/auth/firebase',
      me: '/auth/me',
      logout: '/auth/logout',
      verifyOtp: '/auth/verify-otp',
      refresh: '/auth/refresh',
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
    },
    bookings: {
      create: '/bookings',
      list: '/bookings',
      approve: (bookingId: string) => `/bookings/${bookingId}/approve`,
      reject: (bookingId: string) => `/bookings/${bookingId}/reject`,
      /** DELETE — cancel passenger's own booking (body optional per backend). */
      cancel: (bookingId: string) => `/bookings/${bookingId}`,
    },
    user: {
      profile: '/user/profile',
      update: '/user/update',
      avatar: '/user/avatar',
      /**
       * POST — register Expo push token `{ expoPushToken, platform }`.
       * DELETE — remove tokens for current user (logout); optional if backend only upserts.
       */
      pushToken: '/user/push-token',
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
      /** DELETE – remove thread for current user. Query: rideId, otherUserId */
      deleteConversation: '/chat/conversations',
    },
    ratings: {
      check: '/ratings/check',
      list: '/ratings',
      create: '/ratings',
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
