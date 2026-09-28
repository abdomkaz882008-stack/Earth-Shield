---
name: NASA Earth feeds
description: Provider-specific constraints encountered while powering Earth Shield with NASA POWER and FIRMS.
---

NASA POWER can return `-999` sentinel values for dates that have not finalized; filter invalid parameter rows before presenting charts or current readings. NASA FIRMS Area CSV requests accept a maximum five-day range, and product sources should be requested separately rather than comma-joined.  

**Why:** The dashboard initially rendered unavailable values as real measurements and treated a valid FIRMS request as a provider error.  

**How to apply:** Keep feed normalization in the server route, preserve honest layer statuses, and validate provider response shapes before they reach the UI.