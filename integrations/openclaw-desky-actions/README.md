# Desky Actions for OpenClaw

This tool-only plugin gives OpenClaw agents one bounded tool, `desky_avatar_action`, with an enum of `wave` or `jump`. It does not run commands, access files, contact the network, or claim that an animation was rendered. OpenClaw publishes the structured tool call to the selected session stream; an eligible connected Desky client decides whether it can perform the request.

## Local development install

Requires OpenClaw 2026.5.17 or newer and a compatible Node release.

```powershell
Set-Location integrations/openclaw-desky-actions
npm install --omit=dev --omit=peer
openclaw plugins install --link .
openclaw plugins enable desky-actions
openclaw gateway restart
openclaw plugins inspect desky-actions --json
```

OpenClaw installations with `plugins.allow` configured must admit `desky-actions`. Tool policy can also remove the tool from a particular agent. Installation or policy changes are operator setup, not conversation prompt changes.

The plugin also registers the operator-read-scoped `desky.actions.capabilities` Gateway method. Desky uses it to distinguish an installed typed action schema from a Gateway that merely supports generic tool events.

## Agent instructions

No manual system-prompt, `AGENTS.md`, `CLAUDE.md`, or per-chat instruction is required. The tool name, schema, and usage guidance are published by OpenClaw's normal tool catalog. An operator may add optional style guidance such as “use Desky gestures sparingly,” but Desky must never depend on that text for protocol correctness.
