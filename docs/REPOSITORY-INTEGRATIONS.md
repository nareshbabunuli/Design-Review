# Repository integrations

Open Design AI supports GitHub and GitLab OAuth connections from **Settings → Third-Party Integrations**.

## OAuth app setup

Register OAuth applications with these exact callback URLs for each deployment:

- GitHub: `https://YOUR_APP_HOST/api/integrations/github/callback`
- GitLab: `https://YOUR_APP_HOST/api/integrations/gitlab/callback`

For local development, replace the host with the local app origin, for example `http://localhost:3000`. The callback URL must exactly match the OAuth application's configured redirect URI.

Set the following server-side environment variables:

- `REPOSITORY_CONNECTION_SECRET`: a random secret of at least 32 characters used to encrypt connection tokens.
- `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.
- `GITLAB_OAUTH_CLIENT_ID` and `GITLAB_OAUTH_CLIENT_SECRET`.
- `GITLAB_BASE_URL`: `https://gitlab.com`, or the base URL for a supported self-managed GitLab instance.

Do not expose these values with a `NEXT_PUBLIC_` prefix or commit real secrets to the repository.

## Permissions requested

- GitHub: `read:user repo`. The `repo` scope enables access to private repositories and write operations. The app must still ask for explicit approval before any push.
- GitLab: `read_user read_repository write_repository api`. The `api` scope is broad; review the requested permissions in the OAuth consent screen and narrow the scopes if the deployed workflow does not need all of them.

Users can disconnect from Settings. They can also revoke the app from GitHub or GitLab's own authorized-app settings.

## Current implementation boundary

The OAuth flow, encrypted HTTP-only token cookies, repository listing, and disconnect endpoints are implemented. The repository list currently fetches the first 100 accessible projects per provider. Tokens are encrypted using AES-256-GCM and kept out of browser JavaScript, but this cookie-based storage is an MVP choice; for a multi-device or team deployment, migrate encrypted credentials to a server-side database with per-user ownership, expiry, rotation, and audit logging.

**GitLab Duo agent execution is not implied by connecting GitLab.** Duo Agent Platform availability and its supported programmatic interface must be verified for the actual GitLab account. Do not send code to an undocumented endpoint. The next stage is a provider-specific agent adapter that returns proposed diffs for review, applies nothing until approval, reruns tests, and requires a separate explicit approval before every push.
