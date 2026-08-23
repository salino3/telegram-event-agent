# Agent Architecture & Business Rules

## Telegram Bot Commands

- `/start` - Register or update user account in Neon DB.
- `/new_event` - Trigger step-by-step state machine to create an events.
- `/upcoming_events` - Query and display upcoming events sorted by date.
- `/all_events` - Query and display events sorted by date.
- `/cancel` - Cancel the current active process.

## Database Rules

- Schema is managed in Neon DB (PostgreSQL).
- Emails (if added later) are uniquely constrained only for active users via partial unique index.
- Account soft-deletion sets `is_active = FALSE` and `deleted_at = NOW()`.
- Read-only queries for AI assistants (e.g., Grok) must use restricted database role credentials.

## Priority Enum

- `low` (🟢)
- `medium` (🟡)
- `high` (🔴)
