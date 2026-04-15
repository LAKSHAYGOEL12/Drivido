/**
 * API request/response shapes. Align with backend contracts.
 */

// ---- Auth ----

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Login contract (align backend with this):
 *
 * REQUEST: POST {baseUrl}/api/auth/login
 * Headers: Content-Type: application/json (no Authorization on login)
 * Body (JSON): { email: string, password: string }
 *
 * RESPONSE: 200 OK, JSON body. App reads the body directly (not response.data):
 *   - res.token (required) → access token
 *   - res.refreshToken (optional) → refresh token
 *   - res.user (required): { id or _id, email, name?, phone?, dateOfBirth?, gender?, createdAt? }
 * If user or token is missing, app throws "Invalid response from server".
 */
export interface LoginResponse {
  user: {
    id?: string;
    _id?: string;
    phone?: string;
    name?: string;
    email?: string;
    dateOfBirth?: string;
    gender?: string;
    createdAt?: string;
    created_at?: string;
    avatarUri?: string | null;
    avatarUrl?: string | null;
    avatar_url?: string | null;
    verified?: boolean;
  };
  token: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
  dateOfBirth: string;
  gender: string;
}

export interface RegisterResponse {
  user: {
    id: string;
    phone?: string;
    email: string;
    name?: string;
    dateOfBirth?: string;
    gender?: string;
    createdAt?: string;
    created_at?: string;
    avatarUrl?: string | null;
    avatar_url?: string | null;
    avatarUri?: string | null;
  };
  token: string;
}

// ---- Rides ----

export interface RidesSearchParams {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  date?: string;
  from?: string;
  to?: string;
}

export interface RidesSearchResponse {
  rides: Array<{
    id: string;
    from: string;
    to: string;
    date: string;
    time: string;
    price: string;
    seats: number;
    driverId: string;
    driverName: string;
    latitude: number;
    longitude: number;
    departureAt?: string;
    status?: string;
  }>;
  total?: number;
}

export interface CreateRideRequest {
  from: string;
  to: string;
  date: string;
  time: string;
  price: string;
  seats: number;
  latitude: number;
  longitude: number;
}

/** Payload for POST /rides. username is always sent; backend should persist and return in GET /rides. */
export interface CreateRidePayload {
  pickupLocationName: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLocationName: string;
  destinationLatitude: number;
  destinationLongitude: number;
  scheduledAt: string;
  seats: number;
  username: string;
  price?: string;
  /** Booking mode for seat confirmation flow. */
  bookingMode?: 'instant' | 'request';
  /** Backward-compatible alias accepted by backend validation. */
  instantBooking?: boolean;
  /** Google Directions (or fallback) travel time in seconds — used for arrival time on cards. */
  estimatedDurationSeconds?: number;
  /**
   * Google-encoded overview polyline for pickup → destination. The app sends this on publish whenever
   * it has a line (from route preview or a Directions fetch) so the backend can persist it and return it
   * on ride list/detail. Omit only when no path could be resolved (e.g. Directions failure). Server-side
   * auto-routing would be a separate backend feature.
   */
  routePolylineEncoded?: string;
  /** Copied from user profile when publishing; backend may store on ride. */
  vehicleModel?: string;
  licensePlate?: string;
  vehicleColor?: string;
  /** Stable id from GET /user/vehicles — for ride traceability when backend supports it. */
  vehicleId?: string;
  /**
   * Optional: notes for passengers (luggage, pickup detail, music, etc.).
   * Backend: persist on `Ride` and return on GET `/rides` / `/rides/:id` as `description` (and/or snake_case).
   */
  description?: string;
}

/** Owner-only timeline from GET /api/rides/:id (ride-level `bookingHistory` in API). */
export interface RideBookingHistoryEvent {
  id: string;
  eventType: string;
  seatsBefore: number;
  seatsChanged: number;
  seatsAfter: number;
  createdAt: string;
  /** When set, ride-level timeline events belong to this passenger list segment (owner removal → new id). */
  passengerListSegmentId?: string;
  passenger_list_segment_id?: string;
  /** Backend-owned display hint; when present, client should prefer this over inferred copy. */
  displayKey?: string;
  displayParams?: { seats?: number; reason?: string };
  /** When set, overrides client heuristic for “passenger gave up confirmed seats”. */
  countsAsPassengerSeatRelease?: boolean;
  seatConfirmationOrdinal?: number;
  isRebook?: boolean;
}

export interface RideBookingHistoryUserGroup {
  userId: string;
  events: RideBookingHistoryEvent[];
}

/**
 * Owner ride detail: hints that `rideBookingHistory` is server-deduped and authoritative.
 * Align with backend `BOOKING_HISTORY_META` / `bookingHistoryFormat`.
 */
export interface RideBookingHistoryMeta {
  source?: string;
  orderedBy?: string;
  serverAuthoredFields?: string[];
  /** Human-readable deduplication policy (non-empty ⇒ prefer server timeline, skip client merge of embedded snapshots). */
  deduplication?: string;
}

/**
 * SSOT for passenger book/request eligibility on a ride (GET /rides, GET /rides/:id).
 * Snake_case keys only — do not duplicate on ride root when this object is present.
 */
export interface ViewerBookingContextSnake {
  can_book?: boolean;
  can_request?: boolean;
  block_reason?: string;
  block_reason_code?: string;
  cooldown_ends_at?: string;
  active_booking_id?: string;
}

/** Single ride in GET /rides response. For UI labels use ridePublisherDisplayName (name over username). */
export interface RideListItem {
  id: string;
  /** Owner's user id; used to show Edit/Cancel vs Book. */
  userId?: string;
  /**
   * From GET /api/rides/:id (and list when provided): true if the authenticated user is the driver.
   * Prefer this over client-only id string compare (ObjectId vs string edge cases).
   */
  viewerIsOwner?: boolean;
  pickupLocationName?: string;
  destinationLocationName?: string;
  /** Pickup coordinates (for "in between" route matching). Backend should return these when stored. */
  pickupLatitude?: number;
  pickupLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
  from?: string;
  to?: string;
  /** Driver / publisher display name (prefer this over `username` in UI when set). */
  name?: string;
  /** Login handle or legacy driver label from API — prefer `name` for display in UI when both exist. */
  username?: string;
  seats?: number;
  rideDate?: string;
  rideTime?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  scheduledAt?: string;
  /**
   * Travel time along publisher’s route (seconds). From POST /rides or GET list/detail.
   * If missing, UI estimates ~2 min/km from pickup/destination coordinates when available.
   */
  estimatedDurationSeconds?: number;
  /** Encoded Google polyline for the publisher’s route (GET list/detail). */
  routePolylineEncoded?: string;
  /** When API returns snake_case only; normalizers may fold onto `routePolylineEncoded`. */
  route_polyline_encoded?: string;
  createdAt?: string;
  createdTime?: string;
  date?: string;
  time?: string;
  /** Sum of confirmed booking seats (GET /rides list when provided by API). */
  bookedSeats?: number;
  /**
   * Optional: max(0, seats − bookedSeats). If omitted, compute from `seats` and `bookedSeats`.
   * Normalize `seatsAvailable` / `seats_available` from API to this field in parsers.
   */
  availableSeats?: number;
  /** Count of all booking rows for this ride (any status); use when bookedSeats is 0 but history exists. */
  totalBookings?: number;
  /** Owner-facing backend counters (source of truth for segmented owner lists). */
  activePassengerCount?: number;
  active_passenger_count?: number;
  pendingRequestCount?: number;
  pending_request_count?: number;
  historicalPassengerCount?: number;
  historical_passenger_count?: number;
  /** Owner-facing count of pending seat requests (when API sends a number). */
  pendingRequests?: number;
  /**
   * Owner-only: true if at least one pending seat request (list/detail may send boolean without count).
   * Aliases: `has_pending_requests`.
   */
  hasPendingRequests?: boolean;
  /** Fare; include in GET /rides for list/detail cards. */
  price?: string;
  /** When false, driver has deactivated — UI must not show PII (use “Deactivated user”). */
  publisherAccountActive?: boolean;
  publisher_account_active?: boolean;
  /** Publisher/driver profile image when API provides it (list or detail). */
  publisherAvatarUrl?: string;
  /** Publisher/driver date of birth when API provides it. */
  publisherDateOfBirth?: string;
  /** Driver preference tags copied from profile for ride detail/list display. */
  publisherRidePreferences?: string[];
  publisher_ride_preferences?: string[];
  /**
   * Optional aggregates for the publisher (driver), from GET /rides list/detail when backend embeds them.
   * Passed into Owner profile when a signed-in user opens Details (no ratings fetch on ride detail).
   */
  publisherAvgRating?: number;
  publisherRatingCount?: number;
  /** When API exposes driver contact on ride list/detail (see `pickPublisherPhoneFromRide`). */
  publisherPhone?: string;
  /** Optional; show under driver name on ride detail when API returns them. */
  vehicleModel?: string;
  licensePlate?: string;
  vehicleNumber?: string;
  vehicleColor?: string;
  /** When ride was published with a profile vehicle id (GET /rides detail may return it). */
  vehicleId?: string;
  /**
   * Publisher notes (POST /rides). Shown on ride detail after payment section.
   * Alias: `rideDescription` if backend uses that name.
   */
  description?: string;
  rideDescription?: string;
  /** Snake_case alias from some APIs. */
  ride_description?: string;
  /**
   * When the ride (or trip) is completed — used to close chat after a grace period.
   * Prefer ISO 8601 from GET /rides or ride detail.
   */
  completedAt?: string;
  /** Ride lifecycle, e.g. open | full | cancelled | completed (when provided by API). */
  status?: string;
  /** Booking mode for passenger flow: 'instant' or 'request'. */
  bookingMode?: 'instant' | 'request' | string;
  /** Backward-compatible toggle used by older payloads. false means request flow. */
  instantBooking?: boolean;
  /**
   * Client: from GET /bookings merge — current user's booking status on this ride
   * (e.g. cancelled) for list filters and badges.
   */
  myBookingStatus?: string;
  /** API snake_case alias for `myBookingStatus` (list/detail formatter). */
  my_booking_status?: string;
  /** Optional reason/details for my booking status (e.g. ride_started auto-reject). */
  myBookingStatusReason?: string;
  /** API snake_case alias for `myBookingStatusReason`. */
  my_booking_status_reason?: string;
  /**
   * SSOT for viewer book/request rules — use this in preference to root duplicates (when present).
   */
  viewer_booking_context?: ViewerBookingContextSnake;
  /** @deprecated Legacy camel duplicate; prefer `viewer_booking_context`. */
  viewerBookingContext?: ViewerBookingContextSnake;
  /**
   * @deprecated Prefer `viewer_booking_context` — root copies removed when nested context is sent.
   * Kept for older API responses only.
   */
  canBook?: boolean;
  can_book?: boolean;
  canRequest?: boolean;
  can_request?: boolean;
  blockReason?: string;
  block_reason?: string;
  blockReasonCode?: string;
  block_reason_code?: string;
  cooldownEndsAt?: string;
  cooldown_ends_at?: string;
  activeBookingId?: string;
  active_booking_id?: string;
  /** Backend chat access policy (single source of truth). */
  canSendChat?: boolean;
  chatClosed?: boolean;
  chatClosedReason?: string | null;
  /**
   * When GET /api/rides/:id (or wrapped payload) includes copy because the viewer already has
   * an active booking on this ride. Backend-owned string; app shows it once as a toast on detail.
   */
  viewerBookingNotice?: string;
  /** When present (e.g. from ride detail), list of passengers who booked. */
  bookings?: Array<{
    id: string;
    userId: string;
    name?: string;
    userName?: string;
    seats: number;
    status: string;
    bookedAt: string;
    updatedAt?: string;
    previousBookingId?: string;
    previous_booking_id?: string;
    retryOfBookingId?: string;
    retry_of_booking_id?: string;
    idempotencyKey?: string;
    idempotency_key?: string;
    pickupLocationName?: string;
    destinationLocationName?: string;
    avatarUrl?: string;
    /** Embedded passenger profile when API includes it on booking / nested user. */
    avgRating?: number;
    ratingCount?: number;
    /** Passenger date of birth when API provides it. */
    dateOfBirth?: string;
    /** When false, passenger account is deactivated — mask name/avatar in UI. */
    passengerAccountActive?: boolean;
    passenger_account_active?: boolean;
    accountActive?: boolean;
    account_active?: boolean;
    /** Passenger phone when API includes it for ride owner (see `pickPassengerPhoneFromBooking`). */
    phone?: string;
    passengerPhone?: string;
    /**
     * Optional timeline for this passenger (partial seat cancels, etc.) when backend
     * keeps one active booking row but still returns past seat snapshots.
     */
    bookingHistory?: Array<{
      id?: string;
      seats: number;
      status?: string;
      bookedAt?: string;
      displayKey?: string;
      displayParams?: { seats?: number; reason?: string };
      passengerListSegmentId?: string;
      passenger_list_segment_id?: string;
    }>;
    /**
     * When true, `cancelled_by_owner` row still holds seats (partial removal). Omit/false = full removal
     * even if `seats` is non-zero for display.
     */
    ownerPartialSeatRemoval?: boolean;
    /** Backend-computed flags (v2/v3 owner contract). */
    isPendingRequest?: boolean;
    isAcceptedPassenger?: boolean;
    isCancelledByPassenger?: boolean;
    isCancelledByOwner?: boolean;
    canOwnerRemove?: boolean;
    /** Owner ride detail: true when server considers this an accepted passenger after a prior confirm cycle (rebook). */
    showRebookedBadge?: boolean;
    /** When `server`, trust `showRebookedBadge` only — no client rebook heuristic. */
    rebookedBadgeSource?: string;
    /**
     * Owner list: `pending_request` | `active_passenger` | `historical_cancelled` — server-owned row role.
     */
    ownerListRole?: string;
    /**
     * Server SSOT: group owner passenger rows by `(userId, passenger_list_segment_id)`; new id after owner removal + rebook.
     * Legacy rows may use `legacy-<bookingId>` — client falls back to status-based split for those-only payloads.
     */
    passengerListSegmentId?: string;
    passenger_list_segment_id?: string;
    /** Fine-grain cancel/remove reason when `status` is `cancelled_by_owner` (e.g. `owner_removed` starts a new segment). */
    statusReason?: string;
    status_reason?: string;
  }>;
  /**
   * Populated from ride detail: `bookingHistory` array grouped by `userId` (owner view).
   * Distinct from per-booking `bookings[].bookingHistory` snapshots.
   */
  rideBookingHistory?: RideBookingHistoryUserGroup[];
  /** Owner-only: contract for canonical booking timeline (see `RideBookingHistoryMeta`). */
  bookingHistoryMeta?: RideBookingHistoryMeta;
}

export interface CreateRideResponse {
  id: string;
  from: string;
  to: string;
  date: string;
  time: string;
  price: string;
  seats: number;
  driverId: string;
  status: string;
  createdAt: string;
}

/** For "when is this ride?" use scheduledDate + scheduledTime or scheduledAt; do not use createdAt. */
/** For "when is this ride?" use rideDate + rideTime (or scheduledDate/scheduledTime); do not use createdAt. */
export interface RideDetailResponse {
  id: string;
  from: string;
  to: string;
  rideDate?: string;
  rideTime?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  scheduledAt?: string;
  date?: string;
  time?: string;
  price: string;
  seats: number;
  driverId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  departureAt?: string;
  status: string;
  createdAt: string;
  bookings?: Array<{
    id: string;
    userId: string;
    name?: string;
    userName?: string;
    seats: number;
    status: string;
    bookedAt: string;
    pickupLocationName?: string;
    destinationLocationName?: string;
    avatarUrl?: string;
    avgRating?: number;
    ratingCount?: number;
    phone?: string;
    passengerPhone?: string;
  }>;
}

// ---- Bookings ----

export interface CreateBookingRequest {
  rideId: string;
  seats: number;
  note?: string;
  /** Idempotent create: same key returns existing booking (backend). */
  idempotencyKey?: string;
  idempotency_key?: string;
  /** Prior terminal booking id for this user+ride (retry chain). */
  previousBookingId?: string;
  previous_booking_id?: string;
  retryOfBookingId?: string;
  retry_of_booking_id?: string;
  /** Passenger's searched trip (may differ from driver's full route). */
  pickupLocationName?: string;
  destinationLocationName?: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
}

export interface CreateBookingResponse {
  id: string;
  rideId: string;
  userId: string;
  seats: number;
  status: string;
  bookedAt: string;
}

// ---- Chat (backend-stored) ----

export interface ChatConversationResponse {
  threadKey: string;
  ride: RideListItem;
  otherUserId: string;
  otherUserName: string;
  /** When false, peer is deactivated — client masks PII. */
  otherUserAccountActive?: boolean;
  other_user_account_active?: boolean;
  /** When backend includes peer profile image for inbox / chat headers. */
  otherUserAvatarUrl?: string;
  lastMessage: string;
  lastMessageAt: number;
  lastMessageSenderId: string;
  unreadCount: number;
  /** If present, users in this list have hidden the thread — exclude for that user. */
  deletedFor?: string[];
}

export interface ChatConversationsResponse {
  conversations: ChatConversationResponse[];
}

export interface ChatMessageResponse {
  id: string;
  text: string;
  sentAt: number;
  senderUserId: string;
  /** Server may send legacy values; normalize with `normalizeChatStatus` in the app. */
  status?: string;
}

export interface ChatMessagesResponse {
  messages: ChatMessageResponse[];
}

export interface ChatSendMessageRequest {
  rideId: string;
  otherUserId: string;
  text: string;
}

// ---- Common ----

export interface ApiError {
  message: string;
  code?: string;
  statusCode?: number;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
