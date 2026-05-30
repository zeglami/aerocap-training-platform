# ADR-006: Schedule Availability As Booking Control

Status: Proposed  
Date: 2026-05-30

## Context

The booking service creates raw simulator slots and reservations. The schedule service defines operating schedules, blocked periods, maintenance windows, facility closures, holidays, and availability overrides.

The simulator time management specification requires booking availability to respect schedule rules.

Current implementation status:

- `schedule-service` exposes calendar and availability APIs.
- The frontend filters slot visibility using schedule calendar data.
- Booking cancellation checks schedule availability before restoring a slot.
- Blocked period propagation to booking slots is not fully implemented yet.

## Decision

Booking creation must treat schedule availability as a backend control, not only a frontend display filter.

Preferred options:

1. Synchronous check: `booking-service` calls `schedule-service` availability before confirming a reservation.
2. Event-driven propagation: `schedule-service` emits blocked-period events and a booking worker marks affected slots unavailable.
3. Hybrid: event propagation for performance, synchronous availability check as final guard.

Recommended target: hybrid.

## Consequences

Benefits:

- Pilots cannot book during maintenance or closures.
- Frontend and backend behavior align.
- Schedule service remains source of truth for facility availability.
- Event-driven propagation supports calendar performance.

Trade-offs:

- Booking service gains dependency on schedule availability.
- Availability service outages need a clear fallback rule.
- Event consumers must be idempotent.
- Tests must cover both stale slot state and real-time schedule blocks.

Required controls:

- Reservation creation verifies schedule availability.
- Blocked period create/delete emits tenant-scoped events.
- Slot propagation is idempotent.
- Maintenance completion restores only slots that are not otherwise blocked.
