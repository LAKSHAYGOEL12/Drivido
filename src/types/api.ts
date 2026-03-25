/**
 * API request/response shapes. Align with backend contracts.
 */

// ---- Auth ----

export interface LoginRequest {
  /** Use phone when logging in with phone number */
  phone?: string;
  /** Use email when logging in with email */
  email?: string;
  password: string;
}

/**
 * Login contract (align backend with this):
 *
 * REQUEST: POST {baseUrl}/api/auth/login
 * Headers: Content-Type: application/json (no Authorization on login)
 * Body (JSON): either { email: string, password: string } or { phone: string, password: string }
 *
 * RESPONSE: 200 OK, JSON body. App reads the body directly (not response.data):
 *   - res.token (required) → access token
 *   - res.refreshToken (optional) → refresh token
 *   - res.user (required): { id or _id, phone, name?, email?, createdAt? }
 * If user or token is missing, app throws "Invalid response from server".
 */
export interface LoginResponse {
  user: {
    id?: string;
    _id?: string;
    phone: string;
    name?: string;
    email?: string;
    createdAt?: string;
    created_at?: string;
    avatarUri?: string | null;
    verified?: boolean;
  };
  token: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface RegisterRequest {
  phone: string;
  email: string;
  name?: string;
  password: string;
}

export interface RegisterResponse {
  user: {
    id: string;
    phone: string;
    email: string;
    name?: string;
    createdAt?: string;
    created_at?: string;
  };
  token: string;
}

export interface VerifyOtpRequest {
  phone: string;
  otp: string;
}

export interface VerifyOtpResponse {
  verified: boolean;
  token?: string;
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
  /** Google Directions (or fallback) travel time in seconds — used for arrival time on cards. */
  estimatedDurationSeconds?: number;
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
  /** Fare; include in GET /rides for list/detail cards. */
  price?: string;
  /** Optional; show under driver name on ride detail when API returns them. */
  vehicleModel?: string;
  licensePlate?: string;
  vehicleNumber?: string;
  /**
   * When the ride (or trip) is completed — used to close chat after a grace period.
   * Prefer ISO 8601 from GET /rides or ride detail.
   */
  completedAt?: string;
  /** Ride lifecycle, e.g. open | full | cancelled | completed (when provided by API). */
  status?: string;
  /**
   * Client: from GET /bookings merge — current user's booking status on this ride
   * (e.g. cancelled) for list filters and badges.
   */
  myBookingStatus?: string;
  /** When present (e.g. from ride detail), list of passengers who booked. */
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
  }>;
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
  }>;
}

// ---- Bookings ----

export interface CreateBookingRequest {
  rideId: string;
  seats: number;
  note?: string;
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
  status: 'sending' | 'sent' | 'delivered' | 'read';
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
