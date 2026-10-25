# Gatehouse: Authentication & RBAC Demo

## 1. Project Title & Overview

**Gatehouse** is a small full-stack web app that demonstrates user authentication and role-based access control (RBAC) with two roles, **User** and **Admin**. All access checks are enforced on the server.

It has three access levels:

| View / Endpoint                       | Who can access it                      |
| ------------------------------------- | -------------------------------------- |
| Home (`GET /api/public`)              | Anyone                                 |
| Dashboard (`GET /api/user/dashboard`) | Any logged-in user (otherwise **401**) |
| Admin (`GET /api/admin/users`)        | Admin role only (users get **403**)    |

**Tech stack**

- **Backend:** Node.js 22 (built-in `http` module)
- **Database:** SQLite (built-in `node:sqlite`)
- **Password hashing:** scrypt (built-in `node:crypto`), salted
- **Authentication:** server-side sessions in an `HttpOnly`, `SameSite=Strict` cookie
- **Frontend:** HTML, CSS and vanilla JavaScript
- **Dependencies:** none (no third-party packages)

## 2. Setup & Execution Guide

**Requirements:** Node.js **22.13 or newer**. Check with `node -v`.

1. **Clone the repository**

   ```bash
   git clone https://github.com/makayo/AD371_APP_ARCH.git
   cd AD371_APP_ARCH/ASSIGNMENT/WK4/auth-rbac-app
   ```

2. **Install dependencies**

   No install step is needed. The project uses only Node.js built-in modules, so `npm install` is not required.

3. **Configure the `.env` file**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and set `ADMIN_PASSWORD` to a long password. The admin account (`ADMIN_USERNAME`, default `admin`) is created from these values the first time the app starts. `.env` is git-ignored and never committed.

4. **Run the app**

   ```bash
   npm start
   ```

   Open **http://localhost:3000**. Log in as `admin` with your `.env` password, or register a new standard user.

5. **Run the automated tests** (optional)

   ```bash
   npm test
   ```

6. **Inspect stored passwords** (optional)

   ```bash
   npm run db:inspect
   ```

   This prints the users table to show that passwords are stored as scrypt hashes, not plaintext.

## 3. AI Disclosure & Prompt Appendix

### AI tool used

- **Claude** (claude.ai)

### Exact prompts submitted

**Prompt 1:** The full assignment brief was pasted into Claude, followed by `lets do this:`. The brief included the sample prompt:

```text
Act as a senior security engineer. Build a lightweight full-stack application (or REST API with a simple frontend) demonstrating basic Authentication and Role-Based Access Control (RBAC).

The application must include:
User Registration & Login with two roles: 'User' and 'Admin'.
Password hashing using a modern, secure algorithm.
Token-based (JWT) or Session-based authentication.
Three distinct views or API endpoints:
   - Public: Accessible to anyone (e.g., home/landing page).
   - Protected (User): Accessible to any authenticated user (e.g., user profile or dashboard).
   - Restricted (Admin Only): Accessible ONLY to users with the 'Admin' role (e.g., user management list or system metrics).

Provide the backend server code, route-guard middleware, and a minimal frontend or HTML/JS interface to test registration, login, logout, and role access.
```

Later prompts were questions about running and testing the app and requests for documentation, not code-generation requests.

### What the AI produced correctly

- Password hashing with salted scrypt using OWASP-recommended parameters (no MD5, SHA-256 or plaintext)
- Admin check enforced on the server with a `requireRole('admin')` route guard
- Secrets read from environment variables (`.env`), not hardcoded
- Password hashes stripped from user objects returned by the API
- A generic login error ("Invalid username or password.") for both unknown users and wrong passwords
- Registration always creates the `user` role, even if the request sends `"role": "admin"`
- Prepared SQL statements, so SQL-like input can't inject queries

### Issues found and corrected

| Issue in the AI's first version                                                                                                                                                   | How it was found                                    | Correction                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| The login rate limiter counted failures by IP and username together, both capped at 5. Everyone sharing one network (school, office) could be locked out by someone else's typos. | Automated tests failed with `429 Too Many Requests` | Split into two limits: 5 failures per account and 50 per IP  |
| The frontend's login-state check caused a 401 error in the console on every page load.                                                                                            | Browser check in DevTools                           | Added a `/api/auth/session` endpoint that always returns 200 |

Both issues were found by testing during the AI session and corrected by the AI.

### Design decisions

- **Server-side sessions instead of JWT:** logout deletes the session on the server, so a copied cookie stops working.
- **scrypt instead of bcrypt:** npm packages couldn't be installed in the AI's build environment, so the built-in scrypt (also OWASP-approved) was used.

## 4. QA Test Summary

Tested manually in Chrome with DevTools open on October 24, 2026.

**1. Authentication Functional Tests**

- [x] Successful registration with a new account: "Account created. You can now log in."
- [x] Successful login generating an active session: Network showed `login` **200** and `dashboard` **200**
- [x] Failed login with an invalid password shows a generic error: "Invalid username or password."
- [x] Logout removes the session: the app returned to the logged-out view (Register / Log in)

**2. Authorization & Privilege Boundary Tests**

- [x] Standard user can access the User Dashboard: Network showed `dashboard` **200**
- [x] Standard user requesting the Admin endpoint: **403** "Forbidden: insufficient role."
- [x] Admin can access both User and Admin resources: the admin's dashboard and the Admin user list both loaded
- [x] Logged-out request to a protected endpoint: **401** "Authentication required."

**3. Input Validation & Edge Cases**

- [x] Empty username/password rejected in the browser: "Username and password are required."
- [x] Empty username/password rejected by the server: `curl` returned **400 Bad Request**
- [x] SQL-like input (`' OR '1'='1`) rejected with "Invalid username or password." The server kept running.

**4. Browser Console & Network Health**

- [x] Network tab showed **200** for successful requests; **401** and **403** were shown in the Access tester
- [x] Console showed no errors and no warnings

**Password storage check**

- [x] `npm run db:inspect` showed both accounts stored as salted scrypt hashes, with no plaintext passwords
