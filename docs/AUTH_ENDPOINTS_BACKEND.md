# Auth endpoints your backend should implement

The app works without these (user logs in again each time), but for **session restore** and **token refresh** your backend should expose:

---

### 1. `GET /api/auth/me`

- **Headers:** `Authorization: Bearer <accessToken>`
- **Response (200):** `{ "user": { "id" or "_id", "phone", "email?", "name?" } }`
- **Purpose:** Restore logged-in user when app reopens (using stored token).

---

### 2. `POST /api/auth/refresh`

- **Body:** `{ "refreshToken": "<stored refresh token>" }`
- **Response (200):** `{ "token": "<new access token>", "refreshToken?": "<new refresh token>" }`
- **Purpose:** When any request gets 401, the app calls this once, then retries; if refresh fails, user is logged out.

---

If these return **404**, the app no longer logs warnings; it just clears session and the user can log in again.
