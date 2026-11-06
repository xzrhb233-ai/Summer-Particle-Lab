# Security boundaries and reporting

Summer is a local research application. It has no multi-user authentication, authorization, tenancy isolation or hardened remote job scheduler. Keep the web and native services bound to loopback; do not expose them through a public interface, reverse proxy or tunnel as though they were a production service.

## Local service boundaries

- The web server serves a narrow list of browser entrypoints, JavaScript/CSS modules, the Rapier browser module and the checked-in CAD example. Four named local validation/replay JSON files are deliberately readable by their UI. Other reports, logs, source-service files, Python workers, credentials and repository metadata are not public assets.
- Host and Origin checks reduce cross-origin and DNS-rebinding access. The application still trusts the local user and their browser environment. These checks do not isolate another process already running under that user's account.
- CAD invokes a fixed local Python worker with structured requests, size/time/output limits and controlled error responses. Native geometry libraries are not a security sandbox. Treat imported geometry as untrusted input and keep the dependencies current.
- Optional Taichi WebSocket services have separate protocol and resource limits. This release-preparation review is not a complete audit of their native solvers, GPU drivers or all denial-of-service cases.

## AI and credentials

The assistant sends the user's prompt and a bounded project summary to the **user-selected** provider when the user invokes it. The model can propose allowlisted modeling changes, request simulation controls and read bounded results. It cannot edit software source or execute arbitrary code, shell commands or filesystem operations through that interface.

Keys are not project data. Do not put credentials in project JSON, examples, tests, issue reports, screenshots or version history. Use the application's credential field for an authorized provider and inspect its displayed destination. Custom public HTTPS providers and explicitly supported local model endpoints have different trust boundaries; a local model server must also remain local.

`pnpm check:repo` checks current publication candidates for several high-confidence secret patterns and reports only rule/path/line. It is not a complete credential detector and does not inspect historical commit contents. Before first publication and subsequent releases, use a dedicated secret scanner over all Git history and manually review data, configuration files and reports. If a live credential was committed or exposed, revoke/rotate it with the provider; deleting the current file does not invalidate it.

## Reporting

Use the [repository Security page](https://github.com/xzrhb233-ai/Summer-Particle-Lab/security) and **Report a vulnerability** when GitHub private vulnerability reporting is enabled. The maintainer must enable and verify that channel during public launch; this file alone does not enable it. If that option is unavailable, request a private contact channel without including vulnerability details. Do not publish credentials, confidential data or sensitive exploit details in an issue.

There is currently no promised security support window, response SLA or independent security certification. Record the affected version, impact, minimal reproduction and proposed mitigation in a private report. Never test against another user's service without authorization.
