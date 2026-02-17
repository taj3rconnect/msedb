# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

MSEDB (Microsoft Email Dashboard) monitors Microsoft 365 mailboxes via the Microsoft Graph API, detects repetitive user actions (e.g., always deleting emails from a sender), and upon user approval creates mailbox rules to automate those actions.

## Tech Stack

- **Framework:** Next.js (React) + TypeScript
- **Backend API:** Express.js on Node.js
- **API Integration:** Microsoft Graph API (Mail, MailFolder, MessageRule resources)
- **Auth:** Microsoft Identity Platform via MSAL (OAuth 2.0)

## Architecture

- The backend connects to Microsoft Graph API to read mail folders and user activity
- A pattern detection engine analyzes user behavior to find repetitive actions
- Detected patterns are surfaced to users via the React dashboard for review
- Approved patterns are converted into Microsoft Graph MailboxSettings message rules
- No rule is ever created without explicit user approval

## Microsoft Graph API

- Mail access requires `Mail.Read` and `Mail.ReadWrite` permissions
- Rule management requires `MailboxSettings.ReadWrite` permission
- Authentication flows use MSAL with OAuth 2.0 authorization code grant
- All Graph calls target `https://graph.microsoft.com/v1.0/`

## Key Conventions

- Environment variables for Azure AD credentials are stored in `.env` (never committed)
- TypeScript strict mode is used across both frontend and backend
