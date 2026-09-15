# Slack capabilities

Eve owns webhook handling, incoming attachments, thread context, and native question/approval controls. GTM Agent adds group-DM mention routing, workflow-thread replies, rich replies, and these model-callable tools:

| Tool | Use |
| --- | --- |
| `slack_context` | Current channel, thread, workspace, and requesting user IDs |
| `slack_find_conversations` | Paginated channel/DM lookup; filters private conversations by requester membership |
| `slack_read_history` | Requested channel history or thread replies, with pagination |
| `slack_fetch_file` | Download an accessible Slack file into the session sandbox |
| `slack_send_file` | Upload a generated sandbox file to Slack, up to 25 MB |
| `slack_send_message` | Additional requested post or DM to a mentioned user |

Here defaults to the current thread. A different channel or a DM defaults to top-level. Explicit `threadTs: ""` selects top-level. Other destinations use Eve's approval card. A normal final answer needs no send tool. File-send results report Slack's file ID only after completion; ambiguous failures should be checked in the conversation before retrying. Message posts use stable client message IDs within a turn.

The selected profile, configuration procedure, and operator checks live in [GTM Agent setup](https://github.com/eliasstravik/gtm-skills/blob/main/skills/gtm-agent/references/slack.md). `GET /eve/v1/gtm/slack-health` checks the installed token's grants. It accepts this project's Vercel OIDC credentials or the existing workflow notification secret and returns no credentials or conversation content.

## Limits

- User IDs come from @mentions or the current conversation; there is no user-directory or global search permission.
- Group DMs must already exist and include the bot. Mention it to start a thread; ordinary chatter stays silent.
- Public-channel posting without membership does not subscribe the bot to replies. Invite it for interactive workflow notifications.
- Downloaded files are session-local. Save durable output in the workspace or workflow storage when it must survive sandbox replacement.
- The 25 MB limit applies to inbound and authored file tools. Reading a document also depends on its format and the selected model's capabilities.

Run `npm test` and `npm run typecheck`. Live smoke checks use an authorized test conversation and cover mentions, private channels, DMs, group DMs, workflow replies, file round trips, long replies, and native approvals.
