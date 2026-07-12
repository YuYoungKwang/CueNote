# Phase 0 Plan

## Scope

Implement only ROADMAP Phase 0:

- Monorepo foundation
- SwiftUI iOS/iPadOS app skeleton
- Java 21 Spring Boot backend skeleton
- PostgreSQL local development environment
- Flyway V1 migration
- Health API
- Common success/error response shape
- Testcontainers integration test
- K3s manifest draft
- Sample environment variables
- Backend test GitHub Actions workflow
- Core iOS service protocols

## Out of Scope

- Real OMR
- Real score rendering
- WebSocket ensemble sync
- Note editor
- Sign in with Apple
- Score CRUD beyond interfaces

## Implementation Order

1. Create backend Maven/Spring Boot project.
2. Add common API envelope, request ID metadata, and global error response.
3. Add `/api/v1/health` and Actuator health.
4. Add Flyway V1 migration and Testcontainers integration test.
5. Add PostgreSQL Docker Compose and K3s draft manifests.
6. Add SwiftUI app shell and domain/service protocols.
7. Update README and CI workflow.
8. Run feasible validation commands and record any unavailable checks.

## Decisions

### Health Response Shape

The API spec defines a global success envelope, while the health section shows a direct health payload.
For Phase 0, `/api/v1/health` will use the global envelope:

```json
{
  "data": {
    "status": "UP",
    "version": "0.1.0"
  },
  "meta": {
    "requestId": "..."
  }
}
```

Reason: Phase 0 explicitly requires both Health API and common success/error responses, and health is the only public API in this phase.

Impact: Clients must read `data.status` for the app health endpoint. Kubernetes probes should use `/actuator/health/readiness` or `/actuator/health/liveness`.

Alternative: Return the direct payload for `/api/v1/health` and leave the common response unused until later phases.

### Build Tool

Use Maven for the backend.

Reason: No Gradle wrapper exists in the repository and creating a Maven Spring Boot project keeps CI and Docker-based local validation straightforward.

Impact: Local host validation requires Maven and JDK 21, or a Docker Maven/JDK 21 image.

Alternative: Add Gradle wrapper later if the team standardizes on Gradle.

## Risks

- The current host has Java 17, no Maven/Gradle, and no Xcode/Swift toolchain.
- iOS build validation cannot be executed in this Windows environment.
- Testcontainers requires Docker availability and image pulls during test execution.
