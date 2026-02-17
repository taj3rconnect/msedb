# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MSEDB, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please send a detailed report including:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Supported Versions

| Version | Supported |
|---|---|
| Latest | Yes |

## Security Considerations

MSEDB handles sensitive data including email content and Microsoft 365 credentials. The following measures are in place:

- **OAuth 2.0** — No user passwords are stored; authentication is handled via Microsoft Identity Platform
- **Token Storage** — Access and refresh tokens are stored securely and never exposed to the frontend
- **Scoped Permissions** — Only the minimum required Microsoft Graph API permissions are requested
- **Environment Variables** — All secrets (client IDs, client secrets, session keys) are stored in environment variables, never in source code
- **No Email Content Storage** — MSEDB analyzes patterns in real-time; email content is not persisted beyond what is needed for pattern detection
