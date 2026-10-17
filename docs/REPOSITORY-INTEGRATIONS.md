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

## Duo review and approval workflow

After full-app testing completes, the report view can launch a GitLab Duo Agent Platform flow for a selected GitLab project. The flow is called through GitLab's documented Flows API at `/api/v4/ai/duo_workflows/workflows`. It receives the test findings and is deliberately limited to `read_only_gitlab`, `read_write_files`, and `run_commands` privileges; GitLab-write and git-push privileges are excluded. See the [GitLab Flows API documentation](https://docs.gitlab.com/api/duo_agent_platform_flows/).

The panel reads the workflow trace and looks for structured proposals with complete replacement content. A user must explicitly approve an individual proposal or the remaining batch. Approved content is committed to a dedicated `open-design-ai/duo-fixes-<workflow-id>` branch; the default branch is never modified by this flow.

GitHub and GitLab OAuth connections and repository listing are implemented. The current Duo workflow is GitLab-project based: the GitHub connector is not yet wired into the Duo execution/apply path. The workflow requires GitLab Duo Agent Platform access, API availability, and appropriate project configuration; an OAuth connection alone does not guarantee that GitLab will permit flow execution.

## Token storage note

Tokens are encrypted using AES-256-GCM in secure, HTTP-only cookies bound to the signed-in Open Design AI user. This is an MVP storage choice; for a multi-device or team deployment, migrate encrypted credentials to a server-side database with per-user ownership, expiry, rotation, and audit logging.
