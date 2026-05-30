# ADR-004: Authentication And Tenant Claims

Status: Accepted  
Date: 2026-05-30

## Context

AeroCap must authenticate pilots, instructors, managers, country admins, and global admins. Authorization depends on both user role and active tenant.

The current local implementation uses JWTs issued by `user-service`. The target production direction is AWS Cognito/OIDC, with optional SAML SSO for enterprise operators.

## Decision

The authenticated token/session is the authority for:

- User ID
- Active tenant ID
- Role
- Booking authorization
- Manager regions where applicable

Backend services must derive tenant scope from token claims, not request bodies or URL parameters.

Local development can continue using `user-service` JWTs, but production should migrate to Cognito/OIDC and validate issuer, audience, expiry, and signature consistently.

## Consequences

Benefits:

- Tenant filtering is consistent across services.
- Company switching is explicit: managers receive a new active `tenantId`.
- Frontend can stay simple by passing a single Bearer token.

Trade-offs:

- Role definitions must remain consistent across services.
- Local JWT code must not be mistaken for production-grade identity architecture.
- Manager/global-admin access requires careful audit.

Required controls:

- Shared role definitions should be extracted into a common package.
- Admin and manager actions must be audited.
- Tokens must not be logged or stored in localStorage.
- Production token validation must check issuer and audience.
