# Open Design AI — GitLab Duo setup checklist

Use this checklist once when configuring a deployment. Secrets belong in your hosting provider's server-side environment settings, not in the browser and not in Git.

## 1. Required server environment

- `REPOSITORY_CONNECTION_SECRET`: a unique random secret of at least 32 characters.
- `GITLAB_OAUTH_CLIENT_ID` and `GITLAB_OAUTH_CLIENT_SECRET`: credentials from a GitLab OAuth application.
- `GITLAB_BASE_URL=https://gitlab.com` for GitLab.com, or the base URL for your supported self-managed instance.
- Your existing AI provider configuration: `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, and the corresponding server-side provider key (for the current default, `NEBIUS_API_KEY`).

**There is no separate GitLab Duo API-key environment variable in this implementation.** Open Design AI calls the Duo Agent Platform API using the connected GitLab account's OAuth token. A valid OAuth token alone does not guarantee that the account/project has Duo Agent Platform access.

## 2. Register the GitLab OAuth application

Set its redirect URI to exactly:

```text
https://YOUR_APP_HOST/api/integrations/gitlab/callback
```

For local development, use the local app origin and port instead. Request the scopes the app documents: `read_user`, `read_repository`, `write_repository`, and `api`. Review these broad permissions before production deployment.

## 3. Connect and preflight

1. Deploy the feature branch and confirm the app's required Supabase environment variables are set.
2. Sign in to Open Design AI.
3. Open **Settings → Third-Party Integrations** and connect GitLab.
4. Run full-app UI mapping/testing until the job is **completed** and the plan contains screens.
5. In the **GitLab Duo · Prepare fixes for review** panel, click **Check Duo setup**.
6. Confirm the OAuth, Duo Agent Platform API, and safe-agent-capability checks pass.
7. Select the GitLab project that contains the code to inspect, then click **Prepare fixes with Duo**.

The preflight is read-only: it checks the connected GitLab identity and whether the Duo Agent Platform privilege endpoint is accessible. It does not start a workflow or change repository files.

## 4. Review and apply safely

- Inspect each proposal and its complete file content.
- Click **Approve this fix** or **Approve all remaining** only when you agree with the changes.
- Approved changes are committed to `open-design-ai/duo-fixes-<workflow-id>` in GitLab. The default branch is not changed.
- Review CI and the resulting branch before opening a merge request. Merge/deploy is a separate human decision.

## 5. If setup checks fail

- **OAuth connection fails:** check the client ID/secret, exact callback URI, `GITLAB_BASE_URL`, and `REPOSITORY_CONNECTION_SECRET`; reconnect GitLab after changing credentials.
- **Duo API returns 403:** check the account's Duo Agent Platform entitlement, any identity-verification requirement, project configuration, and the GitLab tier/feature availability for the account. Do not assume adding an API key fixes an entitlement error.
- **Required capabilities missing:** the endpoint intentionally refuses to start a workflow if GitLab does not advertise the safe capabilities the integration needs.
- **Repository list is empty:** verify the connected GitLab user can access the target project and reconnect if access changed.
- **Proposals cannot be applied:** the apply endpoint verifies workflow/project ownership and checks that approved proposal content matches the server-side trace. A non-verifiable trace is rejected rather than applied.

## Important current limitation

The Duo workflow operates on a **GitLab project**. GitHub remains a supported separate repository connection, but this workflow does not automatically mirror/import a GitHub repository into GitLab. If the code currently exists only on GitHub, import or mirror it into a GitLab project before selecting it in this panel.

Reference: [GitLab Duo Agent Platform Flows API](https://docs.gitlab.com/api/duo_agent_platform_flows/).
