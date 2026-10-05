# Cloudpeak cutover preparation — updated October 5, 2026

Status: user approved live cutover October 5. Live Railway deployment eb671aa5-80c3-4a4a-967d-a7996ff6ed3f is healthy and admin access is verified; the test banner is removed and normal customer email/Auth actions are enabled. The existing Resend inbound receiver has moved to Railway with its ID and signing secret preserved. Signed no-send webhook verification passed, unsigned requests were rejected. Website/portal DNS now points to Railway. Both certificates are valid and both custom domains returned HTTPS 200, live health, and 20 Railway puppy records. Actual inbound delivery and user checks remain pending. No Git commits or pushes were made.

## Verified

- Website: https://cloudpeaksilverlabradors.com
- Portal: https://portal.cloudpeaksilverlabradors.com
- DNS authority: Namecheap (`dns1.registrar-servers.com`, `dns2.registrar-servers.com`).
- Current apex A record: `75.2.60.5`. Current portal CNAME: `sprightly-sunflower-a68b82.netlify.app`. Export the complete Namecheap zone before editing; these lookup results are not a complete rollback backup.
- Reviewed source updates copied on October 5: one dog note, one new application, one email. The follow-up read-only comparison shows all source business records present and matching. Railway-only records are the two authorized test emails and 16 test analytics events. Private before/after backups and comparisons are ignored by Git under `database-service/reconciliation/2026-10-05T20-16-33-507Z/` and `2026-10-05T20-18-17-600Z/`.
- Resend domain verified; hosted credentials configured. Actual hosted UI delivery to the approved recipient was reported delivered. Signing secrets remain server-only. The existing receiver now routes to Railway; the additional prepared Railway receiver remains disabled.
- Two Railway custom-domain entries route to port 8080. Railway recognizes ownership of both; certificate status still reports pending. Creating the entries did not change DNS routing.
- `www.cloudpeaksilverlabradors.com` points to `cloudpeak-web.netlify.app` and already returns a 301 redirect to `https://cloudpeaksilverlabradors.com/`. Keep the old Netlify site/domain active for this redirect during the transition. Review its certificate renewal before eventual Netlify removal.

## Prepared Namecheap records — do not switch traffic yet

| Type | Host | Value | Purpose |
| --- | --- | --- | --- |
| ALIAS | @ | n6h6c1fz.up.railway.app | Website routing, only at approved cutover |
| CNAME | portal | vabzy1z4.up.railway.app | Portal routing, only at approved cutover |
| TXT | _railway-verify | railway-verify=e1d2421cf22d9a1fff493404c56db245e7978398dad24a9eb02499ad698a3dc1 | Website ownership |
| TXT | _railway-verify.portal | railway-verify=24b1d456c4a1af876b453df16a065f45901098772c583c0f54f79df009dcc45c | Portal ownership |

Railway supplied a CNAME target for the apex. Use [Namecheap's apex ALIAS support](https://www.namecheap.com/support/knowledgebase/article.aspx/10128/2237/how-to-create-an-alias-record/) rather than an ordinary apex CNAME. Keep existing MX, SPF, DKIM, DMARC, receiving-email and other TXT records. Keep the existing `www` CNAME and Netlify redirect for now. Both ownership TXT records are correct and visible. The live Railway release is now ready for the two routing changes.

## Remaining release work, in order

### Controlled integration checks completed

The first authorized email ran locally and the user confirmed receipt. A second authorized email, “Cloudpeak hosted Railway verification,” was sent through the actual hosted admin UI. It appeared in Sent, was stored in Railway, and Resend reported delivered. Receipt metadata is in `hosted-verification.json`; the hosted app is now staging, not preview-only.

The authorized disposable account was tested locally and again from the hosted Railway container. Creation/deletion used real application action handlers and Supabase Auth. Client profile access and password change were also verified through the public hosted HTTPS API. The old password failed; the new password worked and cleared the first-password-change flag. Deletion denied fresh login, the existing session, and the hosted data API. Auth/profile cleanup was verified and the temporary Railway Auth-ID stub was removed; a deletion tombstone remains to deny stale access. No account-test email was sent. Existing accounts remain protected by the staging allowlist. Temporary SSH verification access was revoked and its local private key deleted.

1. Obtain coordinated cutover approval and pause edits through the old app. Export the complete Namecheap zone, preserve current Netlify deploys, and repeat the comparison immediately before switching. Reconcile any further changes without overwriting Railway-only data. Public forms on the old site may still receive submissions during DNS propagation, so compare again afterward.
2. Activate the prepared live build. It removes the test banner and supports both production hosts plus the original generated Railway host aliases. The build succeeded; its output was checked to contain neither test banner. Configure with `node deployment/configure-hosted.mjs --live --approve-live-cutover` and deploy the matching live bundle. This removes the recipient/account allowlists and enables normal customer email and Auth actions, so do not activate it independently of the cutover.
3. Production storage origins have been added and verified while preserving existing bucket CORS rules. Supabase remains the Auth provider; ordinary password login needs no Site URL change. Existing provider URL settings remain intact.
4. After the verified live deployment is healthy, move the existing inbound webhook with `node deployment/switch-inbound.mjs --approve-live-cutover`. This changes its endpoint to Railway while preserving its existing signing secret and webhook ID. The additional staged receiver stays disabled, avoiding duplicate subscriptions. Preserve the script's previous endpoint metadata for rollback. Inbound handling is tested with signed provider doubles, including previously copied inbox records; actual incoming delivery must be checked after the receiver switch.
5. Replace only the apex routing A record with the ALIAS and update the portal CNAME shown above. Keep ownership TXT, email records and `www` unchanged. Verify Railway certificate issuance and both live domains; the domain status currently remains pending.
6. Verify login, private files, public pages, newest hero photos, forms, email receipt and the actual inbound email path. Keep DNS-era source submissions reconciled so none are lost during propagation. Do not manually replay saved previews. Background campaigns queue durably, rate-limit provider calls and retry provider 429 responses with stable idempotency keys; delivery failures can be reviewed in Email queue and previews.
7. Retain Netlify and Supabase copies during the rollback period. Once Railway receives real writes, rolling DNS back requires reconciling those writes first. Keep Supabase Auth; do not delete the Supabase project or copied originals during cutover. Netlify currently also supplies the `www` redirect.

Validation: 15 backend/gateway/runtime tests passed with real Railway rollback transactions and injected Auth/Resend doubles. Targeted follow-up tests for copied inbound emails and hostname aliases also passed. Changed modules passed focused ESLint. The previous restricted deployment was `77b4877a-29b0-4e21-b4cb-523868b8625e`. The live bundle `deployment/bundle/2026-10-05T20-23-44-915Z` is deployed as `eb671aa5-80c3-4a4a-967d-a7996ff6ed3f`; live configuration and inbound receiver cutover scripts completed successfully. A fresh pre-activation reconciliation is saved under `database-service/reconciliation/2026-10-05T23-10-34-003Z/`. Domain DNS/TLS and actual incoming delivery remain to be verified.

No final DNS or customer-facing action is authorized by this document itself.

Post-DNS verification: both custom domains passed HTTPS and Railway API checks. Source reconciliation at `database-service/reconciliation/2026-10-05T23-19-51-920Z/` still shows all source business rows matching; no source-only rows. Existing Netlify deployments, Supabase Auth and original data/files remain retained.
