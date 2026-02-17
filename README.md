# MSEDB — Microsoft Email Dashboard

An intelligent email management dashboard that monitors Microsoft 365 mailboxes, detects behavioral patterns, and automates email rules based on user approval.

## Overview

MSEDB watches your mail folders and learns from your repetitive actions — such as always deleting emails from a specific sender, moving newsletters to a folder, or marking certain messages as read. Once a pattern is detected, the system suggests an automation rule. Upon your approval, MSEDB creates the rule so you never have to do it manually again.

### Key Features

- **Pattern Detection** — Analyzes mailbox activity to identify repetitive user actions
- **Rule Suggestions** — Proposes automation rules based on detected patterns
- **User Approval Workflow** — No rule is created without explicit user consent
- **Microsoft 365 Integration** — Connects via Microsoft Graph API for mailbox access and rule management
- **Dashboard UI** — Visual interface to review patterns, manage rules, and monitor mailbox activity

## Tech Stack

- **Framework:** Next.js (React) with TypeScript
- **Backend API:** Express.js on Node.js
- **API Integration:** Microsoft Graph API (Mail, MailFolder, MessageRule)
- **Authentication:** Microsoft Identity Platform (OAuth 2.0 / MSAL)

## Prerequisites

- Node.js >= 18
- npm or yarn
- A Microsoft 365 account
- An Azure AD app registration with Mail.Read and MailboxSettings.ReadWrite permissions

## Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd MSEDB

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Azure AD app credentials

# Start development server
npm run dev
```

## Environment Variables

| Variable | Description |
|---|---|
| `AZURE_CLIENT_ID` | Azure AD application (client) ID |
| `AZURE_CLIENT_SECRET` | Azure AD client secret |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `REDIRECT_URI` | OAuth redirect URI |
| `SESSION_SECRET` | Session encryption secret |

## License

This project is licensed under the MIT License — see [LICENSE.md](LICENSE.md) for details.
