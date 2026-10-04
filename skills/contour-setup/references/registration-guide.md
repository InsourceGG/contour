# Register and verify the project

Registration is an external write. Before any Cloud request, print checkpoint 4, present name/company, app origin, approved surfaces, Cloud origin, and authorization method, and obtain the owner's answer. A prior explicit yes covers only those details. Never send credentials to an inferred Cloud URL.

Use the owner's `CONTOUR_CLOUD_URL` and `CONTOUR_PROJECT_TOKEN` if provided. Otherwise follow the installed Cloud console/device authorization flow with the owner's Cloud session. Inspect Cloud's current documented registration API or local route/CLI source for exact endpoints, request fields, and device flow. The task-2 SDK contract does not define a Cloud registration client or device-code command, so do not invent one.

For the scripted Northwind owner, both env names must be set to use token registration. When either is missing, state **"Registration skipped: CONTOUR_CLOUD_URL or CONTOUR_PROJECT_TOKEN is missing."** Do not attempt sign-in, provision a project, or fabricate a receipt. An unavailable Cloud API is a concrete blocker, not permission to register elsewhere.

1. Create the project through the confirmed owner API/console: product name, company, HTTPS app base URL, and approved surface IDs. Retain the returned project ID and one-time verification nonce. Never log the project token.
2. After checkpoint 4, create `src/contour/project.json` containing `{ "projectId": "<returned ID>", "nonce": "<returned nonce>" }`. The receipt has no owner token. Pass these values as `projectId` and `wellKnownNonce` into `createContourHandlers(contour, { broker, projectId, wellKnownNonce })`. Treat the nonce as verification material and omit it from reports, even though it is intentionally served at the public origin.
3. Confirm the existing rewrite serves `GET /.well-known/contour-project.json` with exactly the SDK response shape:

```json
{
  "projectId": "<returned ID>",
  "nonce": "<returned nonce>",
  "agentApiResource": "https://<host>/api/mcp",
  "authorizationServer": "https://<host>"
}
```

4. Request Cloud verification using the confirmed API/console. Cloud fetches the HTTPS origin with address pinning, no redirects, bounded size/time, checks project ID/nonce, and reads AS metadata. Report verified only from its success response.
5. Trust the configured Cloud CIMD (`<CONTOUR_CLOUD_URL>/oauth/client.json`) via `trustedClients`. Keep OAuth PKCE S256, resource binding, live company membership, and host consent. Linking grants only read/propose scopes, never commit.

Registration approval does not authorize deploying the nonce to a production app. If the approved origin cannot yet serve the updated file, record **created, verification pending deployment** and wait for checkpoint 5 before deploying. Local HTTP smoke checks prove route availability only; they do not prove Cloud domain verification. An unverified project must remain unlisted/unlinkable.

A future registration implementation must supply the owner/device-code interface and verification endpoints. Keep their absence explicit. Do not embed undocumented HTTP paths or use the consumer's Contour identity as the company identity.
