---
name: Earth Shield resilience
description: Earth Shield must keep its dashboard usable when NASA providers are temporarily unavailable.
---

Provider outages should degrade to explicit cached Tahta data rather than blanking the dashboard. API responses carry a data status, cached FIRMS detections retain the expected map count, and the client shows an update banner while retrying.

**Why:** NASA POWER and FIRMS are external feeds and transient failures should not prevent farmers or operators from seeing the last known field picture.

**How to apply:** Preserve the typed cached response shape when adding feeds, keep provider failures in structured logs, and make new UI states partial/cached instead of full-page interruption screens.