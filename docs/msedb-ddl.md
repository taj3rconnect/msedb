# msedb-ddl.md — empty-database rebuild snapshot

Complete, ordered DDL that recreates an **empty** copy of the MSEDB database
(collections, validators, indexes — no data). Executable top-to-bottom in
`mongosh msedb` against an empty database, so a rebuild never depends on a
migration chain replaying (MSEDB has no migration framework — see `data.md`).

| Field | Value |
|---|---|
| Generated | 2026-08-08 (`/tdbaudit`) |
| Source env | **prod** — DGX, container `msedb-mongo`, database `msedb` |
| Engine | MongoDB **8.2.7** (standalone, no replica set) |
| Collections | 14 |
| Indexes | 54 (incl. `_id_`) |

`_id_` indexes are omitted — MongoDB creates them automatically.

```javascript
db.createCollection("auditlogs", {});
db.getCollection("auditlogs").createIndex({"userId":1,"action":1,"createdAt":-1}, {"name":"userId_1_action_1_createdAt_-1"});
db.getCollection("auditlogs").createIndex({"userId":1,"mailboxId":1,"createdAt":-1}, {"name":"userId_1_mailboxId_1_createdAt_-1"});
db.getCollection("auditlogs").createIndex({"targetType":1,"targetId":1}, {"name":"targetType_1_targetId_1"});
db.getCollection("auditlogs").createIndex({"action":1,"mailboxId":1,"createdAt":-1}, {"name":"action_1_mailboxId_1_createdAt_-1"});
db.getCollection("auditlogs").createIndex({"createdAt":1}, {"name":"createdAt_1","expireAfterSeconds":15552000});

db.createCollection("calendarsyncmaps", {});
db.getCollection("calendarsyncmaps").createIndex({"sourceMailboxId":1,"sourceEventId":1}, {"name":"sourceMailboxId_1_sourceEventId_1","unique":true});
db.getCollection("calendarsyncmaps").createIndex({"mirrors.mailboxId":1,"mirrors.eventId":1}, {"name":"mirrors.mailboxId_1_mirrors.eventId_1"});
db.getCollection("calendarsyncmaps").createIndex({"userId":1,"isDeleted":1,"startDateTime":1}, {"name":"userId_1_isDeleted_1_startDateTime_1"});

db.createCollection("emailevents", {});
db.getCollection("emailevents").createIndex({"userId":1,"sender.domain":1,"timestamp":-1}, {"name":"userId_1_sender.domain_1_timestamp_-1"});
db.getCollection("emailevents").createIndex({"userId":1,"eventType":1,"timestamp":-1}, {"name":"userId_1_eventType_1_timestamp_-1"});
db.getCollection("emailevents").createIndex({"userId":1,"mailboxId":1,"messageId":1,"eventType":1}, {"name":"userId_1_mailboxId_1_messageId_1_eventType_1","unique":true});
db.getCollection("emailevents").createIndex({"timestamp":1}, {"name":"timestamp_1","expireAfterSeconds":7776000});
db.getCollection("emailevents").createIndex({"messageId":1,"timestamp":-1}, {"name":"messageId_1_timestamp_-1"});
db.getCollection("emailevents").createIndex({"userId":1,"timestamp":-1}, {"name":"userId_1_timestamp_-1"});
db.getCollection("emailevents").createIndex({"receivedAt":1}, {"name":"receivedAt_1"});
db.getCollection("emailevents").createIndex({"eventType":1,"isDeleted":1,"timestamp":1}, {"name":"eventType_1_isDeleted_1_timestamp_1"});

db.createCollection("mailboxes", {});
db.getCollection("mailboxes").createIndex({"userId":1,"email":1}, {"name":"userId_1_email_1","unique":true});
db.getCollection("mailboxes").createIndex({"userId":1}, {"name":"userId_1"});
db.getCollection("mailboxes").createIndex({"homeAccountId":1}, {"name":"homeAccountId_1","unique":true,"sparse":true});

db.createCollection("notifications", {});
db.getCollection("notifications").createIndex({"userId":1,"isRead":1,"createdAt":-1}, {"name":"userId_1_isRead_1_createdAt_-1"});
db.getCollection("notifications").createIndex({"createdAt":1}, {"name":"createdAt_1","expireAfterSeconds":2592000});

db.createCollection("patterns", {});
db.getCollection("patterns").createIndex({"userId":1,"mailboxId":1,"status":1}, {"name":"userId_1_mailboxId_1_status_1"});
db.getCollection("patterns").createIndex({"userId":1,"patternType":1,"condition.senderDomain":1}, {"name":"userId_1_patternType_1_condition.senderDomain_1"});
db.getCollection("patterns").createIndex({"rejectionCooldownUntil":1}, {"name":"rejectionCooldownUntil_1","sparse":true});

db.createCollection("rules", {});
db.getCollection("rules").createIndex({"userId":1,"mailboxId":1,"isEnabled":1,"priority":1}, {"name":"userId_1_mailboxId_1_isEnabled_1_priority_1"});
db.getCollection("rules").createIndex({"graphRuleId":1}, {"name":"graphRuleId_1","sparse":true});
db.getCollection("rules").createIndex({"userId":1,"conditions.senderEmail":1}, {"name":"userId_1_conditions.senderEmail_1"});

db.createCollection("scheduledemails", {});
db.getCollection("scheduledemails").createIndex({"userId":1,"status":1,"scheduledAt":1}, {"name":"userId_1_status_1_scheduledAt_1"});
db.getCollection("scheduledemails").createIndex({"cleanupAt":1}, {"name":"cleanupAt_1","expireAfterSeconds":0});

db.createCollection("settings", {});

db.createCollection("stagedemails", {});
db.getCollection("stagedemails").createIndex({"userId":1,"status":1,"expiresAt":1}, {"name":"userId_1_status_1_expiresAt_1"});
db.getCollection("stagedemails").createIndex({"expiresAt":1}, {"name":"expiresAt_1","expireAfterSeconds":0});
db.getCollection("stagedemails").createIndex({"cleanupAt":1}, {"name":"cleanupAt_1","expireAfterSeconds":0});

db.createCollection("trackedemails", {});
db.getCollection("trackedemails").createIndex({"trackingId":1}, {"name":"trackingId_1","unique":true});
db.getCollection("trackedemails").createIndex({"sentAt":1}, {"name":"sentAt_1"});
db.getCollection("trackedemails").createIndex({"mailboxId":1,"subject":1,"sentAt":1}, {"name":"mailboxId_1_subject_1_sentAt_1"});

db.createCollection("tunnelconfigs", {});

db.createCollection("users", {});
db.getCollection("users").createIndex({"email":1}, {"name":"email_1","unique":true});
db.getCollection("users").createIndex({"microsoftId":1}, {"name":"microsoftId_1","unique":true,"sparse":true});

db.createCollection("webhooksubscriptions", {});
db.getCollection("webhooksubscriptions").createIndex({"subscriptionId":1}, {"name":"subscriptionId_1","unique":true});
db.getCollection("webhooksubscriptions").createIndex({"userId":1,"mailboxId":1}, {"name":"userId_1_mailboxId_1"});
db.getCollection("webhooksubscriptions").createIndex({"expiresAt":1,"status":1}, {"name":"expiresAt_1_status_1"});

```
