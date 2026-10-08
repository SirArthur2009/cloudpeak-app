# Cloudpeak backup audit and recovery procedure

Audit: October 5, 2026 (America/Denver), October 6 UTC.

**Result: no Railway volume backups exist for production Postgres.** The authenticated production Postgres Backups page explicitly reports “No Backups” and “This service's volume does not have any backups.” It also states that creating backups and enabling point-in-time recovery (PITR) are available only on the Pro plan. No schedule controls or recovery points are available on the inspected page. Independent database dumps, file backups and a successful restore drill remain unverified. No production restore, deployment, subscription upgrade, backup schedule change or data deletion was performed.

## Verified scope

| Resource | Verified identity |
| --- | --- |
| Project | Cloudpeak / `ba2498be-e030-473a-81b4-a14d05dd8120` |
| Environment | production / `bd380cbe-c04c-4174-a8b7-5e126c99dc06` |
| Database service | Postgres / `c2b280ec-eed2-4ec5-9ef5-bcf820bb3ae8` |
| Database image | `ghcr.io/railwayapp-templates/postgres-ssl:18` |
| Database volume | postgres-volume / `c5893073-f4aa-4fb2-9d6e-a05261bf1597`, 5000 MB, `/var/lib/postgresql/data`, us-west2 |
| File bucket | cloudpeak-files / `1d687b5e-0671-481e-99a0-a7c09c6db107`, sjc |
| App service | cloudpeak-hosted-test / `11612220-77f2-4c35-85c9-dd99d1b0cb1b` |

Postgres and the app had successful deployments; there were no staged changes at inventory inspection. Neither proves backup readiness. The connector offers no backup-list operation. Initial browser and local API/CLI access failed; the user subsequently opened and authenticated the in-app browser. Direct inspection of [production Postgres Backups](https://railway.com/project/ba2498be-e030-473a-81b4-a14d05dd8120/service/c2b280ec-eed2-4ec5-9ef5-bcf820bb3ae8/backups?environmentId=bd380cbe-c04c-4174-a8b7-5e126c99dc06) resolved the earlier uncertainty and confirmed the absence of backups and the Pro-plan restriction. Native recovery cannot currently be performed because there is no recovery point.

Local `database-service/reconciliation/` exports are migration comparison data, not full PostgreSQL recovery archives. They do not establish preservation of roles, schema, policies, functions, sequences or all private application tables. The storage migration manifest and URL backup contain metadata, not a current independent copy of object bytes. Older source copies cannot substitute for backups of post-cutover writes.

## Complete the backup verification

Open [Cloudpeak on Railway](https://railway.com/project/ba2498be-e030-473a-81b4-a14d05dd8120), select **production**, then **Postgres → Backups**.

Before native backups can be configured, the workspace owner must review and approve the Pro subscription upgrade. The audit does not authorize a purchase. Once that is complete, enable the chosen schedules, create an initial backup and verify that it completes. Alternatively, establish independent logical database dumps and file archives without relying on native snapshots. Either approach still needs a successful isolated recovery drill.

1. Record the active volume identity and enabled schedules. Railway documents daily retention of 6 days, weekly 27 days and monthly 89 days. Record actual settings; do not assume defaults. Daily/weekly/monthly together are a proposed baseline, not verified configuration.
2. Record each available backup's ID, UTC timestamp and completion state; require a recent completed recovery point. Investigate any failed/missing expected run. Record the observed recovery-point age and business-accepted data-loss window.
3. Inspect PITR separately: confirm supported image/configuration, archiver health and actual earliest/latest restorable timestamps. Do not infer PITR from the PostgreSQL version or the existence of a file bucket. Do not switch images merely to complete an audit.
4. Locate independent PostgreSQL dumps and file archives, their schedules, destinations, retention and successful job logs. A separate backup destination must survive deletion of the source project. Restrict access and keep credentials out of source control.
5. Complete the isolated restore drill below and record archive hashes, start/end UTC timestamps, tool versions, validation results and measured recovery time. Until then, recovery time and end-to-end recoverability remain unverified.

Railway volume snapshots cover the database volume. Verify the **cloudpeak-files** bucket independently: enumerate every object with pagination, preserve full keys and content metadata, copy bytes to an independent destination, calculate SHA-256, and verify the archive against a fresh inventory. Do not rely on ETags as universal content hashes. Include private admin files as well as public photos. Coordinate DB/file snapshots or freeze writes to obtain a consistent pair. Do not run the old migration scripts as a backup or restore: they target the former source and can rewrite live metadata.

## Isolated PostgreSQL restore drill

Use PostgreSQL 18 client tools and a disposable, isolated PostgreSQL 18 server. Confirm the source is production and the target is disposable before any restore. No app, mail worker, inbound webhook or Auth mutation handler should connect to the drill database.

1. Create a custom-format archive using `pg_dump --format=custom --file=cloudpeak.dump` with connection details supplied through protected PostgreSQL environment variables/password file. Use the pinned CA and verified TLS connection settings; never paste a credential URL into command history. Dump the complete application database, including `public` and `cloudpeak_internal`. Separately preserve necessary cluster roles/grants securely with `pg_dumpall --globals-only`; its output can contain credential material.
2. Hash and archive the dump; check `pg_restore --list cloudpeak.dump` for both application schemas. Listing an archive only checks readability, not successful recovery.
3. Provision required roles on the isolated server after reviewing the globals file. Create an empty drill database. Restore with `pg_restore --exit-on-error --single-transaction --dbname=cloudpeak_restore_drill cloudpeak.dump` using target-only connection settings. Do not use `--clean` against production. Preserve owners and grants when testing faithful recovery.
4. Compare schema objects, table counts and representative row hashes against evidence collected from the same source snapshot. Verify functions, policies, role grants, foreign keys and sequences. Test next-value/write behavior only in the isolated target with rollback. A fresh production count may differ because live writes continued.
5. Verify private user directory, access-deletion tombstones, email outbox/idempotency records and storage metadata as well as ordinary business tables. Validate public reads, admin/client permissions, signed-out denial and forged-session denial using an isolated app with preview emails and blocked Auth writes.
6. Restore file archives to an isolated destination, compare byte hashes and test representative public and private file downloads. Reconcile database file references against restored object keys.

A drill passes only when restore exits successfully and data, permissions, private state and file checks pass. Keep a dated record without customer data or secrets. This procedure is reviewed against documentation; it has not been executed in this audit.

## Production volume recovery

This is an incident procedure requiring an explicitly selected recovery point and authorization to deploy the database restore. Do not restore production solely to test backups.

1. Identify the incident boundary and record the desired recovery timestamp in UTC. Inventory writes after that point and accept/reconcile the resulting data loss. Pause app writes, public forms, uploads, email dispatch/retries and inbound webhook processing using an agreed maintenance plan; pause automatic deployments too. Preserve inbound events for later processing.
2. Capture current database and file state independently before recovery where feasible. Record current volume/mount, app revision, variables and credential references securely. Preserve the original volume throughout the recovery window.
3. In **production → Postgres → Backups**, select the known completed backup by UTC timestamp and click **Restore**. Railway stages a replacement volume. Inspect **Details**: same service and `/var/lib/postgresql/data`, replacement volume named for the backup, original volume unmounted and retained. Review all pending changes to avoid deploying unrelated changes.
4. After approval, click **Deploy** to apply the staged restoration and redeploy PostgreSQL. Wait for database health and inspect logs. Verify schema, records, roles, policies, sequences and application access before reopening writes.
5. Check both `https://portal.cloudpeaksilverlabradors.com/health` and `https://cloudpeaksilverlabradors.com/health`; verify gallery, admin data, client restrictions and private-file denial. Reconcile bucket keys with restored DB references. A volume restore does not restore the separate bucket or Supabase Auth accounts/passwords.
6. Reconcile email/inbound state against provider history before enabling sends or retries. A restored outbox can revive previously sent jobs after the provider idempotency window; restored webhook state can permit already processed events to run again. Verify access-deletion tombstones against actual Auth account state before enabling account actions.
7. Reopen processing in a controlled order, observe errors and record elapsed recovery time. Retain the former volume and independent pre-recovery archives until the recovery is accepted.

If validation fails before writes resume, review reattaching the retained original volume to the same service/mount and redeploying with explicit incident approval. If writes have resumed, first preserve and reconcile those writes; switching volumes again can lose them. Never wipe/delete either volume during investigation.

Backups restore within the same project/environment. Wiping a volume deletes its backups. Railway's detailed backup reference says newer backups remain on the retained original volume; verify this in the incident rather than relying on them being copied onto the restored volume.

## File recovery

Restore only from a verified byte archive. First preserve current objects and freeze uploads/deletes. Prefer an isolated replacement bucket for validation. Retain exact object keys and content types used by storage-service policy. Compare SHA-256 and database references, then review the destination switch and required server credential/CORS configuration. Do not delete or overwrite production objects as a drill. Reconcile any files uploaded after the database recovery point before reopening access.

## Sources

- [Railway volume backups and restore lifecycle](https://docs.railway.com/volumes/backups)
- [Railway PostgreSQL backup layers and logical recovery](https://docs.railway.com/guides/postgres-backups-restores)
- [Railway PITR](https://docs.railway.com/volumes/point-in-time-recovery)
- [PostgreSQL 18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)
- [PostgreSQL 18 pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)
