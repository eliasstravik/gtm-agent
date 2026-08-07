# GTM Agent social preview

Use this specification for the GitHub repository social preview so the shared card matches the README landing page.

## Canvas

- Size: `1280 × 640 px`
- Safe area: keep essential copy inside the centered `1120 × 520 px`
- Background: `#f6f8fa`
- Export: PNG or JPG under GitHub’s upload limit

## Composition

1. Place a cropped Slack conversation panel on the right, based on [`assets/gtm-agent-slack-hero.png`](../assets/gtm-agent-slack-hero.png).
2. Add the eyebrow `GTM AGENT` in small uppercase type on the left.
3. Set the headline to `Open source agent for GTM`.
4. Add the supporting line `Nine GTM workflows. One Slack agent.`
5. Show the visible response cue `Using GTM context` with the green success accent.
6. Use `#2ea44f` for the primary accent and keep all text readable at feed-card size.

## Accessibility

Recommended alt text:

> GTM Agent: an open-source Slack agent that uses shared GTM context to segment, score, research, and recommend the next action.

Check the final image at both full size and approximately `400 px` wide. The product name and headline should remain readable without zooming.

## GitHub repository metadata

Recommended About description:

> Open-source Slack agent for GTM context, segmentation, scoring, research, and approval-gated Git updates.

Recommended topics:

`ai-agents`, `eve`, `gtm`, `marketing`, `revops`, `sales`, `slack`, `vercel`

After review and approval, the description and topics can be applied with:

```sh
gh repo edit eliasstravik/gtm-agent \
  --description "Open-source Slack agent for GTM context, segmentation, scoring, research, and approval-gated Git updates." \
  --add-topic ai-agents \
  --add-topic eve \
  --add-topic gtm \
  --add-topic marketing \
  --add-topic revops \
  --add-topic sales \
  --add-topic slack \
  --add-topic vercel
```

Upload the exported social image in GitHub under **Settings → General → Social preview**.
