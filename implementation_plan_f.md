# AI Document Intelligence Platform — Architecture & Ticket 1 Plan

## Overview

The platform is split into **two repositories** (frontend and backend). The backend repo houses both the **NestJS API** and the **FastAPI** service side by side. Communication between NestJS ↔ FastAPI uses **HMAC-signed HTTP requests** for security. PostgreSQL is the primary database, and Redis handles caching, sessions, and pub/sub.

---

## Repository & Folder Structure

### Repo 1: `ai-doc-intel-frontend` (React)

```
ai-doc-intel-frontend/
├── public/
│   └── index.html
├── src/
│   ├── api/                    # Axios/fetch wrappers for backend calls
│   │   └── authApi.ts          # Register, login, verify-email endpoints
│   ├── assets/                 # Images, fonts, SVGs
│   ├── components/             # Reusable UI components
│   │   ├── ui/                 # Buttons, Inputs, Modals, Loaders
│   │   └── auth/               # RegisterForm, LoginForm, VerifyEmail
│   ├── hooks/                  # Custom React hooks
│   │   └── useAuth.ts
│   ├── pages/                  # Route-level page components
│   │   ├── RegisterPage.tsx
│   │   ├── LoginPage.tsx
│   │   └── VerifyEmailPage.tsx
│   ├── store/                  # State management (Zustand or Redux)
│   │   └── authStore.ts
│   ├── utils/                  # Helpers, validators, constants
│   │   └── validators.ts       # Client-side password/email validation
│   ├── routes/                 # React Router config
│   │   └── AppRouter.tsx
│   ├── styles/                 # Global CSS / design tokens
│   ├── App.tsx
│   └── main.tsx
├── .env                        # REACT_APP_API_URL, etc.
├── package.json
├── tsconfig.json
└── vite.config.ts              # Using Vite as bundler
```

---

### Repo 2: `ai-doc-intel-backend` (NestJS + FastAPI)

```
ai-doc-intel-backend/
├── nestjs-api/                 # ── NestJS application ──
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema (User model, etc.)
│   │   ├── migrations/         # Auto-generated Prisma migrations
│   │   └── seed.ts             # Optional seed script
│   ├── src/
│   │   ├── main.ts             # Bootstrap, global pipes, CORS, Swagger setup
│   │   ├── app.module.ts       # Root module
│   │   ├── config/
│   │   │   ├── redis.config.ts         # Redis connection config
│   │   │   ├── mail.config.ts          # SMTP / email service config
│   │   │   ├── hmac.config.ts          # HMAC secret & settings
│   │   │   └── swagger.config.ts       # Swagger/OpenAPI configuration
│   │   ├── common/
│   │   │   ├── guards/                 # AuthGuard (JWT), HmacGuard
│   │   │   ├── interceptors/           # Logging, transform response
│   │   │   ├── decorators/             # @CurrentUser, @Public, @ApiTags
│   │   │   ├── filters/               # Global exception filters
│   │   │   ├── pipes/                  # Validation pipes
│   │   │   └── utils/
│   │   │       └── hmac.util.ts        # HMAC sign/verify helper
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts  # POST /auth/register, /auth/verify-email
│   │   │   │   ├── auth.service.ts     # Business logic: hash, token, email
│   │   │   │   ├── dto/
│   │   │   │   │   ├── register.dto.ts         # Email, password validation + @ApiProperty
│   │   │   │   │   └── verify-email.dto.ts     # Token DTO + @ApiProperty
│   │   │   │   ├── strategies/
│   │   │   │   │   └── jwt.strategy.ts
│   │   │   │   └── auth.service.spec.ts
│   │   │   ├── users/
│   │   │   │   ├── users.module.ts
│   │   │   │   ├── users.service.ts     # Uses PrismaService for DB access
│   │   │   │   └── users.service.spec.ts
│   │   │   ├── prisma/
│   │   │   │   ├── prisma.module.ts      # Global Prisma module
│   │   │   │   └── prisma.service.ts     # Extends PrismaClient, handles lifecycle
│   │   │   ├── mail/
│   │   │   │   ├── mail.module.ts
│   │   │   │   ├── mail.service.ts     # Send verification email
│   │   │   │   └── templates/
│   │   │   │       └── verify-email.hbs
│   │   │   └── redis/
│   │   │       ├── redis.module.ts
│   │   │       └── redis.service.ts    # Token storage, rate limiting
│   ├── test/
│   ├── .env                            # DATABASE_URL, JWT secret, HMAC secret, SMTP, Redis URL
│   ├── package.json
│   ├── tsconfig.json
│   └── nest-cli.json
│
├── fastapi-service/            # ── FastAPI application ──
│   ├── app/
│   │   ├── main.py             # FastAPI bootstrap, CORS, middleware
│   │   ├── config.py           # Settings via pydantic-settings
│   │   ├── middleware/
│   │   │   └── hmac_middleware.py   # Verify HMAC signature on incoming requests
│   │   ├── routers/
│   │   │   ├── ocr.py              # OCR processing endpoints (future)
│   │   │   ├── extraction.py       # LLM extraction endpoints (future)
│   │   │   └── rag.py              # RAG/embedding endpoints (future)
│   │   ├── services/
│   │   │   ├── ocr_service.py
│   │   │   ├── llm_service.py
│   │   │   └── embedding_service.py
│   │   ├── models/                  # Pydantic schemas
│   │   └── utils/
│   │       └── hmac_utils.py        # HMAC sign/verify helpers
│   ├── requirements.txt
│   ├── .env
│   └── Dockerfile
│
├── docker-compose.yml          # PostgreSQL, Redis, NestJS, FastAPI
└── README.md
```

---

## How Everything Connects

```mermaid
graph LR
    subgraph "Repo 1 — Frontend"
        A[React App<br/>Vite + TypeScript]
    end

    subgraph "Repo 2 — Backend"
        B[NestJS API<br/>Port 3000]
        C[FastAPI Service<br/>Port 8000]
        D[(PostgreSQL)]
        E[(Redis)]
    end

    A -->|REST API<br/>JSON + JWT| B
    B -->|HMAC-signed<br/>HTTP requests| C
    B -->|TypeORM| D
    B -->|ioredis| E
    C -->|SQLAlchemy<br/>read-only| D
```

| Connection | Protocol | Auth Mechanism |
|---|---|---|
| React → NestJS | REST over HTTPS | JWT Bearer token (after login) |
| NestJS → FastAPI | Internal HTTP | HMAC signature in headers |
| NestJS → PostgreSQL | TCP | Prisma Client with `DATABASE_URL` |
| NestJS → Redis | TCP | ioredis with password |
| FastAPI → PostgreSQL | TCP | SQLAlchemy (read-only, for future RAG lookups) |

---

## HMAC Communication (NestJS ↔ FastAPI)

HMAC ensures that only the NestJS backend can call FastAPI endpoints — no external caller can forge requests.

**How it works:**

1. NestJS and FastAPI share a **secret key** (stored in `.env` of both)
2. When NestJS calls FastAPI:
   - It constructs the request body
   - Computes `HMAC-SHA256(secret, timestamp + method + path + body)`
   - Sends the signature + timestamp in HTTP headers:
     ```
     X-HMAC-Signature: <computed_hash>
     X-HMAC-Timestamp: <unix_timestamp>
     ```
3. FastAPI middleware:
   - Reads the signature & timestamp from headers
   - Rejects if timestamp is older than 5 minutes (replay protection)
   - Recomputes the HMAC with the same inputs
   - Compares signatures — rejects if mismatch

> [!NOTE]
> HMAC is only for **NestJS → FastAPI** internal calls. The React frontend communicates with NestJS using standard JWT-based auth.

---

## Swagger / OpenAPI Documentation

Both NestJS and FastAPI will have auto-generated, interactive API documentation.

### NestJS — `@nestjs/swagger`

| Concern | Detail |
|---|---|
| **Package** | `@nestjs/swagger` |
| **Setup** | Configured in `main.ts` via `SwaggerModule.setup()` |
| **URL** | `http://localhost:3000/api/docs` |
| **Auth** | Bearer token input via Swagger UI ("Authorize" button) |
| **DTO decorators** | Every DTO property gets `@ApiProperty()` with description, example, and type |
| **Controller decorators** | `@ApiTags('Auth')`, `@ApiOperation()`, `@ApiResponse()` on every endpoint |
| **Grouping** | Endpoints grouped by module tag (Auth, Users, Documents, etc.) |

**How it works in `main.ts`:**
- Create a `DocumentBuilder` with title, description, version, and `addBearerAuth()`
- Call `SwaggerModule.createDocument(app, config)`
- Mount at `/api/docs` via `SwaggerModule.setup('api/docs', app, document)`

**DTO example with Swagger decorators:**
```
@ApiProperty({ example: 'user@example.com', description: 'User email address' })
@IsEmail()
email: string;

@ApiProperty({ example: 'P@ssw0rd!', description: 'Min 8 chars, 1 upper, 1 number, 1 special', minLength: 8 })
@MinLength(8)
password: string;
```

### FastAPI — Built-in OpenAPI

| Concern | Detail |
|---|---|
| **Built-in** | FastAPI generates OpenAPI docs automatically |
| **Swagger UI** | `http://localhost:8000/docs` |
| **ReDoc** | `http://localhost:8000/redoc` |
| **Pydantic models** | All request/response schemas auto-documented from Pydantic models |

> [!TIP]
> Swagger docs serve as the **contract** between frontend and backend. The React developer can use `http://localhost:3000/api/docs` to see every endpoint, its request shape, and response format — no need for a separate API spec document.

---

## Prisma ORM Setup

### Schema (`prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  isVerified   Boolean  @default(false) @map("is_verified")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```

### PrismaService (`src/modules/prisma/prisma.service.ts`)

- Extends `PrismaClient` and implements NestJS `OnModuleInit` / `OnModuleDestroy`
- Calls `this.$connect()` on init and `this.$disconnect()` on destroy
- Registered as a **global module** so every other module can inject it

### Key Prisma Commands

| Command | Purpose |
|---|---|
| `npx prisma migrate dev --name init` | Create initial migration from schema |
| `npx prisma migrate deploy` | Apply migrations in production |
| `npx prisma generate` | Regenerate Prisma Client after schema changes |
| `npx prisma studio` | Open visual DB browser at `localhost:5555` |
| `npx prisma db seed` | Run seed script |

> [!NOTE]
> Prisma replaces TypeORM entirely. There are no repository files — you call `this.prisma.user.create()`, `this.prisma.user.findUnique()`, etc. directly via the injected `PrismaService`. This gives you full type-safety with auto-generated types from your schema.

---

## Ticket 1: Register — Technical Flow

### What happens end-to-end when a user registers:

```mermaid
sequenceDiagram
    participant U as React Frontend
    participant N as NestJS API
    participant DB as PostgreSQL
    participant R as Redis
    participant M as Mail Service

    U->>U: Client-side validation<br/>(email format, password rules)
    U->>N: POST /api/auth/register<br/>{email, password}
    N->>N: Validate DTO<br/>(class-validator)
    N->>DB: Check if email exists
    alt Email already exists
        N-->>U: 409 Conflict
    end
    N->>N: Hash password<br/>(bcrypt, 12 rounds)
    N->>DB: INSERT user<br/>(isVerified = false)
    N->>N: Generate verification token<br/>(crypto.randomUUID)
    N->>R: Store token → userId<br/>(TTL: 24 hours)
    N->>M: Send verification email<br/>(with token link)
    N-->>U: 201 Created<br/>"Check your email"

    Note over U,M: User clicks email link

    U->>N: GET /api/auth/verify-email?token=xxx
    N->>R: Lookup token
    alt Token valid
        N->>DB: UPDATE user SET isVerified = true
        N->>R: DELETE token
        N-->>U: 200 OK "Email verified"
    else Token expired/invalid
        N-->>U: 400 Bad Request
    end
```

### Detailed Breakdown per Layer

#### 1. React Frontend (RegisterPage)

| Concern | Detail |
|---|---|
| **Form fields** | Email input, Password input, Confirm Password input |
| **Client-side validation** | Email regex, password minimum 8 chars, 1 uppercase, 1 number, 1 special char, passwords match |
| **API call** | `POST /api/auth/register` with `{ email, password }` |
| **Success handling** | Redirect to "Check your email" confirmation page |
| **Error handling** | Display server-side errors (email taken, validation errors) |
| **Verify email page** | Reads `?token=xxx` from URL, calls `GET /api/auth/verify-email?token=xxx` |

#### 2. NestJS Auth Controller

```
POST /api/auth/register
```

- Receives `RegisterDto` → validated by `class-validator` pipe
- Calls `AuthService.register()`
- Decorated with `@ApiTags('Auth')`, `@ApiOperation({ summary: 'Register a new user' })`
- Response decorators: `@ApiResponse({ status: 201 })`, `@ApiResponse({ status: 409, description: 'Email already exists' })`

```
GET /api/auth/verify-email?token=xxx
```

- Receives `VerifyEmailDto`
- Calls `AuthService.verifyEmail(token)`
- Decorated with `@ApiOperation({ summary: 'Verify email address' })`

#### 3. NestJS Auth Service — `register()`

| Step | Implementation |
|---|---|
| **Check duplicate** | `prisma.user.findUnique({ where: { email } })` → if exists, throw `ConflictException` |
| **Hash password** | `bcrypt.hash(password, 12)` — 12 salt rounds |
| **Create user** | `prisma.user.create({ data: { email, passwordHash, isVerified: false } })` → saves to PostgreSQL |
| **Generate token** | `crypto.randomUUID()` — a 36-char unique token |
| **Store in Redis** | `redis.set(\`verify:\${token}\`, userId, 'EX', 86400)` — expires in 24h |
| **Send email** | `MailService.sendVerificationEmail(email, token)` — email contains link: `https://app.com/verify-email?token=xxx` |

#### 4. NestJS Auth Service — `verifyEmail(token)`

| Step | Implementation |
|---|---|
| **Lookup token** | `redis.get(\`verify:\${token}\`)` → returns `userId` or `null` |
| **If null** | Throw `BadRequestException('Invalid or expired token')` |
| **Update user** | `prisma.user.update({ where: { id: userId }, data: { isVerified: true } })` |
| **Delete token** | `redis.del(\`verify:\${token}\`)` — single-use token |

#### 5. PostgreSQL — User Table (via Prisma)

Defined in `prisma/schema.prisma` (see Prisma ORM Setup section above). Maps to:

| Column (DB) | Prisma Field | Type | Notes |
|---|---|---|---|
| `id` | `id` | UUID | `@id @default(uuid())` |
| `email` | `email` | VARCHAR | `@unique` |
| `password_hash` | `passwordHash` | VARCHAR | `@map("password_hash")` |
| `is_verified` | `isVerified` | BOOLEAN | `@default(false) @map("is_verified")` |
| `created_at` | `createdAt` | TIMESTAMP | `@default(now())` |
| `updated_at` | `updatedAt` | TIMESTAMP | `@updatedAt` |

#### 6. Redis Usage for Registration

| Key Pattern | Value | TTL | Purpose |
|---|---|---|---|
| `verify:{token}` | `userId` | 24 hours | Email verification token |
| `register-rate:{ip}` | count | 15 minutes | Rate limiting (optional but recommended) |

#### 7. Mail Service

- Uses `@nestjs-modules/mailer` with Handlebars templates
- SMTP config in `.env` (works with SendGrid, Mailgun, AWS SES, or any SMTP provider)
- Template: `verify-email.hbs` — contains the verification link

---

## Password Validation Rules

Applied at **both** client-side (React) and server-side (NestJS DTO):

| Rule | Detail |
|---|---|
| Minimum length | 8 characters |
| Uppercase | At least 1 uppercase letter |
| Lowercase | At least 1 lowercase letter |
| Number | At least 1 digit |
| Special character | At least 1 of `@#$%^&*!` |
| Max length | 64 characters |

In NestJS, these are enforced via `class-validator` decorators on `RegisterDto`:
- `@IsEmail()` for email
- `@MinLength(8)`, `@MaxLength(64)`, `@Matches(regex)` for password

---

## Environment Variables Needed

### NestJS `.env`
```
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_doc_intel
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random-64-char>
HMAC_SECRET=<shared-with-fastapi>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=noreply@app.com
FRONTEND_URL=http://localhost:5173
SWAGGER_TITLE=AI Doc Intel API
SWAGGER_VERSION=1.0
```

### FastAPI `.env`
```
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_doc_intel
HMAC_SECRET=<shared-with-nestjs>
```

### React `.env`
```
VITE_API_URL=http://localhost:3000/api
```

---

## Docker Compose (Development)

Services you'll run:

| Service | Image | Port |
|---|---|---|
| `postgres` | `postgres:16` | 5432 |
| `redis` | `redis:7-alpine` | 6379 |
| `nestjs-api` | Built from `./nestjs-api` | 3000 |
| `fastapi-service` | Built from `./fastapi-service` | 8000 |

> [!TIP]
> For local development, you can run PostgreSQL and Redis via Docker Compose, while running NestJS (`npm run start:dev`) and FastAPI (`uvicorn app.main:app --reload`) directly on your machine for hot-reload.

---

## Open Questions

> [!IMPORTANT]
> **Email provider**: Which SMTP provider do you plan to use? (SendGrid, Mailgun, AWS SES, Mailtrap for dev?) This affects mail config but not architecture.

> [!IMPORTANT]
> **Monorepo or separate git repos?** You mentioned separate repos. Just to confirm:
> - **Repo 1**: `ai-doc-intel-frontend` (React only)
> - **Repo 2**: `ai-doc-intel-backend` (NestJS + FastAPI + docker-compose)
> 
> Is this correct, or do you want FastAPI in its own third repo?

> [!IMPORTANT]
> **State management**: Do you have a preference for React state management? (Zustand is lightweight and recommended, Redux Toolkit is more structured, or React Context for simplicity)

## Verification Plan

### For Ticket 1 (Register)
1. **Unit tests**: NestJS — test `AuthService.register()` and `AuthService.verifyEmail()` with mocked Prisma and Redis
2. **Integration test**: Hit `POST /api/auth/register` → verify user created in DB with hashed password and `isVerified = false`
3. **E2E flow**: Register → check email (use Mailtrap in dev) → click link → verify `isVerified = true` in DB
4. **Edge cases**: Duplicate email, weak password, expired token, already verified user
5. **Swagger verification**: Open `http://localhost:3000/api/docs` → confirm Register and Verify Email endpoints appear with correct request/response schemas
6. **Prisma verification**: Run `npx prisma studio` → confirm User table structure and inserted records
