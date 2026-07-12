# Phase 0 Plan

## Scope

Implement only ROADMAP Phase 0 for the current Web PWA-first repository:

- Monorepo foundation
- `web-app` React + TypeScript + Vite
- PWA manifest and Service Worker
- `src/app`, `src/core`, `src/domain`, `src/features`, `src/ai`, `src/workers`
- IndexedDB adapter interface
- `MockOMRService`
- Vitest basic tests
- Playwright basic E2E
- Java 21 Spring Boot backend
- PostgreSQL Docker Compose
- Flyway V1
- Testcontainers integration test
- K3s namespace, Deployment, Service, Ingress, Secret example
- `.env.example`
- GitHub Actions frontend/backend test

## Out of Scope

- Real OMR
- Real ONNX model connection
- Real score rendering
- Real ensemble WebSocket
- Note editor
- Authentication provider implementation
- Native iOS implementation in the active product path

## Implementation Order

1. Create the web-app workspace and shared monorepo scaffolding.
2. Add PWA manifest, Service Worker, capability detection, storage adapter, and mock OMR service.
3. Add Vitest unit coverage and Playwright E2E smoke coverage.
4. Keep the existing Spring Boot backend, health API, common responses, Flyway migration, and Testcontainers test aligned.
5. Add Docker Compose, K3s drafts, `.env.example`, and frontend/backend GitHub Actions workflows.
6. Validate build, tests, compose, and YAML parsing.

## Decisions

### Frontend Stack

Use React + TypeScript + Vite for the first implementation.

Reason: The roadmap now treats Web PWA as the first platform, and Vite keeps the workspace small and fast to iterate on.

Impact: The repository becomes a real monorepo with a browser-first application entrypoint instead of an iOS app shell.

Alternative: Keep the legacy iOS app as the active path. Rejected because the current product direction is Web PWA-first.

### Legacy iOS Placement

Move the previous iOS Phase 0 output into `legacy/ios-app`.

Reason: Preserve the old implementation for long-term Phase 11 reference without mixing it into the active product path.

Impact: Active development, docs, and CI should not treat the legacy iOS code as a build target.

Alternative: Keep `ios-app` at the root and mark it as unused. Rejected because it continues to imply active support.

### Backend Build Validation

Use a Dockerized Maven 21 image for backend validation in this environment.

Reason: The host has no Maven installed and only Java 17 locally.

Impact: Backend tests remain reproducible without changing the source tree.

Alternative: Add a Maven wrapper. Rejected for Phase 0 because the repo already has a working Docker path for validation.

## Risks

- Testcontainers inside Docker needs host override settings in this environment.
- iOS build validation cannot be run here.
- The repository still contains legacy iOS source for reference, but it is intentionally excluded from active development.
