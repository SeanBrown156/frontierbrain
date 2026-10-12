# Auth email templates

Jade-styled templates for Supabase Auth (Authentication → Emails → Templates in the dashboard, or the Management API
`PATCH /v1/projects/{ref}/config/auth` fields `mailer_templates_*_content`). Inline styles only: email clients drop
stylesheets and web fonts.

| File | Supabase template | Suggested subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | Confirm your Frontier Brain email |
| `reset-password.html` | Reset password | Reset your Frontier Brain password |
| `magic-link.html` | Magic link | Your Frontier Brain sign-in link |
| `change-email.html` | Change email address | Confirm your Frontier Brain email |

A guest who creates an account with email gets **Change email address** (their guest user gains an email), so that
template is worded for both a new account and a later change. Real users only receive these once a custom SMTP sender is configured; Supabase's built-in sender delivers only to
members of the project's team.
