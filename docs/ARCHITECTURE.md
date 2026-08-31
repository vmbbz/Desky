# System architecture

## Architectural objective

Desky must render one consistent companion experience while integrating runtimes with incompatible transports, permissions, and lifecycle models. The architecture keeps runtime-specific behavior behind adapters and keeps privileged operating-system access outside the renderer.

## Technology decision

Desky uses Electron, TypeScript, React, Three.js, and `@pixiv/three-vrm`.

- Electron supplies transparent frameless windows on Windows and macOS and has an established Mac App Store build.
- Three.js and `three-vrm` provide one VRM renderer across both operating systems.
- React owns accessible UI composition, not the render loop.
- Electron Forge owns development packaging; store signing and identity remain release-environment concerns.

The rejected Tauri approach is recorded in ADR 0001. The deciding constraint was Mac App Store compatibility for a transparent companion window.

## Runtime topology

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron main process                                       │
│ window lifecycle | tray | secure storage | adapter host     │
│ companion snapshot | session draft | distribution policy    │
└───────────────────────────┬──────────────────────────────────┘
                            │ narrow, typed IPC
┌───────────────────────────▼──────────────────────────────────┐
│ Sandboxed renderer                                           │
│ React UI | snapshot consumer | avatar state machine | Three.js│
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS asset requests
┌───────────────────────────▼──────────────────────────────────┐
│ Avatar registries / explicitly user-selected local files     │
└──────────────────────────────────────────────────────────────┘

Adapter host connections:
  Store profile  -> authenticated HTTPS/WSS gateways
  Direct profile -> HTTPS/WSS plus supervised local processes
```

## Process responsibilities

### Main process

- Create and restore companion/control windows.
- Enforce the active distribution capability profile.
- Own adapter processes and network sockets requiring secrets.
- Store tokens through operating-system credential facilities; never plain settings files.
- Validate all IPC inputs and expose explicit commands only.
- Record redacted diagnostics.
- Coordinate shutdown, cancellation, and child-process cleanup.
- Reduce normalized adapter events into one revisioned companion snapshot shared by every window.
- Hold the unsent composer draft only for the current application process.

### Preload bridge

- Expose a frozen, minimal API through `contextBridge`.
- Carry serializable values only.
- Never expose raw `ipcRenderer`, filesystem, shell, environment, or process objects.

### Renderer

- Render character and accessible controls.
- Render revisioned normalized companion snapshots supplied by main; simulation fixtures may apply the same pure reducer locally.
- Never receive long-lived secrets.
- Never construct shell commands.
- Treat avatar metadata, model files, and agent text as untrusted input.

## Domain modules

### Companion protocol

A versioned discriminated union represents runtime-independent events. The protocol is the seam between adapters and product behavior. See `docs/ADAPTERS.md`.

### Companion state machine

The shared reducer maps events to visible state. It is pure and exhaustively tested. `CompanionStateHost` applies it once in the main process and exposes a revisioned snapshot, preventing independently mounted ambient and control-center renderers from disagreeing about current text or approval state. Animation selection is a second mapping from visible state plus avatar capabilities, which prevents gateway quirks from leaking into render code.

Each renderer consumes that snapshot through the UI and motion arbiter. The implemented foundation owns one full-body state plan, resolves priority and exact registered-clip selection, and emits a procedural fallback when no admitted clip can run. Its controller owns the VRM mixer, loop/one-shot policy, file-defined multi-step programs, fades, reduced-motion suppression, baseline restoration, and disposal. A bounded priority/FIFO cue queue adds conversational, ambient, user, and agent actions: the active cue temporarily becomes the body owner, interrupts a lower state clip, and resumes the current accepted state afterward. Higher state priorities interrupt it; approval, cancellation, disconnection, and error clear it. Conversation entry, explicit UI actions, admitted typed commands, and the validated built-in catalogue create cues, never raw model text. Terminal success/error and disconnected status keep their semantic priority but inherit the admitted idle body loop when they lack a purpose-authored clip. This makes the current full-body action crossfade into living idle instead of stopping the mixer and exposing the imported bind pose.

Blink, gaze, and expressions are an additive capability-gated controller rather than another body owner. It manipulates only advertised presets/look-at, follows a deterministic bounded schedule, neutralizes gaze under reduced motion, and restores authored baselines on disposal. Missing optional capabilities are no-ops. Speech visemes remain open.

Agent actions use a separate ephemeral command because an action must not replay when a renderer opens or reconnects. OpenClaw's exact `desky_avatar_action` tool-start event is reduced in main to a versioned Wave/Jump command, filtered to the selected session/live turn, deduplicated by tool-call identity, then sent through narrow preload IPC. Only the normalized enum reaches the renderer. `AgentAdapterCapabilities` separately normalizes discovery of sessions, streaming, tools, approvals, cancellation, reconnect, and typed action availability. OpenClaw fills it through negotiated methods plus `desky.actions.capabilities`; future Claude/Hermes adapters must map supported native discovery into the same object. Runtime setup and the cross-provider policy are specified in `docs/AGENT-ACTIONS.md`.

### Companion window composition

The experience uses separate coordinated windows rather than one permanent card:

- The ambient companion is a tightly bounded transparent window for the avatar and transient anchored bubble/composer UI. It does not activate when state changes.
- The control center is an ordinary accessible window for setup, transcripts, approvals, settings, licences, and diagnostics.
- The main process owns placement, work-area clamping, always-on-top policy, full-screen policy, and click-through state. Renderer code reports measured visible bounds and requests semantic window actions through typed IPC.
- Main also owns desired visibility independently from native `isVisible()`. Unexpected hide/minimize is non-activatingly recovered, while deliberate Hide and system suspend suppress recovery. Display-topology bursts are debounced before arrangement restore/clamp/persist. Electron's all-workspaces API is used only on supported macOS/Linux platforms; it is explicitly not claimed on Windows.
- Interactive regions remain explicit. Transparent ambient regions pass pointer input where the platform permits, and a tray/menu/global escape route can disable full click-through.

The behavior and acceptance matrix are specified in `docs/COMPANION-EXPERIENCE.md`.

`DeskyWindowManager` implements this separation and owns all native desktop policy. Each renderer receives a typed `ambient` or `control-center` identity from main-process ownership rather than selecting its own privileges. The ambient window is transparent, fixed-size, and taskbar-free; the control center is an ordinary resizable window. Geometry-keyed placement and the always-on-top preference live in a bounded, validated, atomically replaced application-data record. The main process clamps the real native window against current Electron `Display.workArea` values after moves and display topology/metric events.

The ambient renderer reports only `interactive` or `transparent` pointer intent through typed IPC. Interactive DOM regions are explicit, and the avatar uses projected scene bounds rather than its full canvas. Main applies Electron mouse-event forwarding for selective hit testing and owns the stronger full-window click-through mode. Full click-through is not persisted across launch and cannot enable without a live tray or global-shortcut recovery surface. Tray and native context menus also expose show, hide, position reset, always-on-top, control-center, and quit actions. Runtime state broadcasts never call `show` or `focus`; ambient restoration uses `showInactive`, while an explicit character click may focus the composer.

The contextual composer uses a separate typed companion bridge. Main holds one bounded, revisioned draft in memory, broadcasts changes to existing windows, and returns it to windows opened later. It is cleared only after an accepted send or explicit user deletion; collapsing, reconnecting, or recreating a renderer does not discard it. The draft is intentionally absent from `desktop-state.json`, the secure credential vault, and transcript persistence. Main also broadcasts the revisioned companion snapshot after every normalized adapter event. The ambient projection converts provider Markdown into bounded readable plain text before truncation, while the full control-center projection renders GitHub-flavored Markdown without raw HTML. Response links cross a separate main-owned HTTPS/HTTP-only IPC validator; provider text cannot pass a protocol or executable to Electron. Successful ambient responses auto-dismiss after a bounded length-aware reading interval while the authoritative transcript remains available.

The **Open conversation** action is also main-owned and takes no renderer argument. A fixed provider-route registry may prefer an installed official client only when that exact OS protocol has been reviewed and Electron confirms a handler. OpenClaw is currently admitted through its documented credential-free `openclaw://chat` route. Provider/session identifiers, endpoints, prompt text, and secrets are never interpolated into the URI. Claude Agent SDK session ids are not assumed to be Claude Desktop conversation ids; Hermes documents shared sessions but no public session-opening URI; Codex documents no admitted desktop deep link. Those adapters therefore open Deskiii's synchronized control-center transcript until their stable route contracts are proved. Missing handlers and launch failures also fall back to Deskiii.

The companion surfaces now use the executable provider-neutral adapter contract. `AgentAdapterRegistry` owns active-runtime selection and forwards only the selected runtime's safe state, events, actions, and lifecycle commands. Shared descriptors and connection/session/turn state use generic identifiers; provider authentication remains an opaque configuration envelope until the selected main-process runtime validates it. Preload exposes only `desky.adapters` over `desky:adapter:*` channels. The renderer-local Simulation harness remains visibly separate and cannot satisfy a production adapter gate.

Codex is the admitted second production adapter for direct-download packages. Profile-aware runtime construction instantiates OpenClaw and `CodexRuntime` in direct builds, but instantiates only OpenClaw in Store builds; Store safety is therefore structural rather than a hidden-button convention. The Control Center enumerates cloned registry descriptors and lets the user inspect a provider-specific form without mutating the live runtime. Pressing Connect submits the selected provider's opaque configuration; the registry then owns bounded teardown and the atomic active-runtime switch. Codex's provider layer owns executable/version admission, account state, threads/turns, approval request correlation, native decision mapping, private-reasoning rejection, redacted tool lifecycle, terminal deduplication, and process failure. A committed metadata-only schema baseline binds runtime version admission to a reproducible canonical digest of the CLI-generated protocol; generated schemas stay ephemeral. Safe projection validators fail closed for malformed native fields that can affect Desky state while unknown unconsumed notifications remain forward-compatible.

Codex does not currently participate in the provider-neutral typed Desky-action lane. The app-server's client-local registration contract (`dynamicTools` and `item/tool/call`) is experimental, so production initialization omits `capabilities.experimentalApi`, thread creation omits `dynamicTools`, and `codexFoundationCapabilities.agentActions` remains `unsupported`. An unexpected server request outside admitted command/file approval methods receives JSON-RPC method-not-found. Stable MCP discovery is deliberately modeled as a separate future topology because it requires an independently configured server/helper, executable trust, containment, authentication/configuration and release-profile review; it cannot be silently substituted for client-local registration.

That future topology is explicitly deferred, not scheduled. Provider protocols may require a separate MCP process boundary, but Desky's product requirement is one installed application: any admitted helper would have to be bundled, signed, automatically configured and supervised as a Desky sidecar. Codex and Hermes do not need it for their core adapter features, so agent-requested avatar actions remain unavailable rather than imposing another installation or instruction-file setup. Reconsideration requires a stable native registration API or product evidence strong enough to justify the additional executable and release-policy surface.

Codex lifecycle recovery is process replacement, never transport replay. A recoverable app-server exit closes the old connection identity, expires approvals, emits one failure for any lost active turn, and enters a three-attempt bounded backoff. Every attempt repeats workspace-grant, executable/version/schema, initialize, account and thread-list admission. It may resume the prior thread only when that thread remains in the new authoritative list; it never reissues `turn/start`. Malformed framing, malformed consumed protocol, failed tree termination and explicit disconnect are terminal/non-reconnectable. Listener identity and a lifecycle generation prevent stale clients or delayed retries from reclaiming state after user disconnect.

Hermes lifecycle recovery follows the same no-replay invariant over a different topology. The external API Server owns every tool process and removes a run's event buffer when its SSE consumer disconnects, so Desky cannot truthfully resume that run. Active transport loss therefore expires its approval routes and emits one lost-turn failure before closing the old connection identity. Idle loss is detected by a bounded admission heartbeat. Three fresh HTTP admissions revalidate health, server-agent/tool topology, authentication, exact routes, runtime version/model continuity, and the authoritative session list; only the selected session identity may be restored. Protocol/authentication/drift failures are terminal, and explicit disconnect invalidates every delayed retry.

Hermes is constructed only by the direct distribution profile. Store construction never calls either local Codex or Hermes factories, so a descriptor or UI mistake cannot accidentally make those runtimes available in a sandboxed package. Direct Hermes shares the main-process OS-encrypted connection vault but owns a distinct `hermes:active-profile` record. Renderer configuration carries an optional one-use bearer plus a remember decision; the runtime resolves saved access only against the exact canonical endpoint and mutates the vault only after full server admission. Reconnect retains the resolved bearer in main memory only for the active lifecycle and releases it after disconnect or exhausted recovery.

The Claude admission candidate follows a stricter delayed-authentication transaction because local SDK session listing does not prove an Anthropic key. Its optional one-use key is resolved in main from a provider-specific encrypted record and held in memory for the connection. The SDK query runs with reviewed environment/settings isolation, strict empty MCP configuration, and an opaque workspace grant. Only a successful terminal turn whose init frame proves API-key source, exact bundled CLI version, effective workspace and permission mode may commit a new credential or an opt-out deletion. Every earlier failure preserves the prior vault entry. Claude remains unregistered until the authenticated source and packaged matrices pass.

Remote Hermes is a two-hop topology: Desky speaks validated HTTPS to an operator-owned TLS ingress, and that ingress reaches the Hermes API Server on its protected network. Hermes `0.20.5` does not terminate TLS in its aiohttp listener. Desky neither accepts remote HTTP nor disables platform certificate validation. Separately, Hermes tool discovery is server-owned. Its stable API advertises toolsets read-only, while dynamic tools come from process-wide MCP configuration and reload rather than a client callback. A future Desky action bridge must therefore be an explicit helper/MCP subsystem with its own trust, IPC, lifecycle, and distribution contract; it cannot be smuggled through the ordinary adapter connection or system prompt.

Cancellation has a stronger containment contract than ordinary logical interruption. Live evidence against the admitted CLI showed that `turn/interrupt` could produce an interrupted terminal event while an approved command descendant continued running. After the interrupt acknowledgement, `CodexRuntime` therefore resolves pending approvals as cancelled, emits at most one cancelled terminal event, moves to a visible reconnecting state, terminates the complete app-server process tree while the root identity remains live, and performs fresh admission before resuming the selected thread. Stop consequently means the underlying tool process has ended, not only that model streaming stopped.

The stdio client owns the OS containment boundary. Windows uses a fixed absolute `taskkill.exe` invocation with `/T /F`, no shell and a five-second command bound. Unix app-server is placed in a detached process group; shutdown signals the group and escalates from `SIGTERM` to `SIGKILL` after 500 ms. Normal Electron quit is intercepted once and awaits the registry's asynchronous adapter disposal behind a ten-second ceiling before the final quit. This makes explicit disconnect, adapter switching, protocol shutdown, and normal application exit share one teardown path.

Codex workspace authority is separate from generic adapter configuration. `CodexWorkspaceGrantBroker` is main-process-only: the direct-profile Control Center can open a native directory picker, but receives only a label, expiry, maximum sandbox and opaque grant id. The broker canonicalizes and revalidates the directory, rejects filesystem roots, bounds grants to eight and fifteen minutes, prevents read-only-to-write upgrades, and prevents a home directory or its ancestor from becoming workspace-write. Workspace-write issuance additionally requires a native main-process warning confirmation. `CodexRuntime` accepts only an opaque grant id plus the finite `read-only`/`workspace-write` choice; a resolver dependency must produce the canonical path before executable discovery.

### OpenClaw adapter host

The first production adapter is owned entirely by the main process:

```text
connection UI -> generic adapter IPC -> AgentAdapterRegistry -> OpenClawRuntime
                                                           -> OpenClawAdapterHost
                                                           -> secure vault
                                                           -> protocol-v4 WebSocket client
Gateway frame -> provider validation/redaction -> AdapterEvent -> registry -> companion snapshot -> renderers
Structured action tool -> provider validation/session filter -> registry -> ephemeral AgentActionCommand -> motion queue
```

- `gateway-client.ts` owns the challenge-first wire exchange and request correlation.
- `protocol.ts` owns the pinned v4 constants, Ed25519 device proof, URL policy, native frame guards, and redacted event mapping.
- `secure-vault.ts` stores encrypted opaque values only; it has no plaintext fallback.
- `host.ts` owns profiles, sessions, terminal-event deduplication, approval routing, cancellation, reconciliation, and bounded reconnect.
- `openclaw-runtime.ts` owns exact provider configuration validation, safe state normalization, and provider error redaction.
- `registry.ts` owns active-runtime selection, command routing, inactive-runtime event isolation, and bounded disposal.
- Preload exposes generic semantic commands, safe descriptors, read-only normalized runtime state/events, and revisioned companion snapshot/draft methods. It never exposes sockets, native frames, credentials, native provider state, or `ipcRenderer`.

The packaged renderer is served from the secure custom `desky://` scheme. This lets the file-protocol privilege fuse remain disabled without making packaged assets unavailable.

### Avatar catalog

The main-process avatar asset broker fetches `projects.json`, then collection-specific avatar files. It joins per-project licences to avatar metadata before any avatar can be selected, restricts model download to HTTPS on an explicit registry-host policy, enforces catalog/model byte limits and a timeout, and returns only validated metadata plus bounded bytes through typed IPC. The sandboxed renderer has no arbitrary avatar-fetch surface. Network data is never treated as executable content.

Admitted model and thumbnail caching is main-owned and content-addressed. Exact bytes and their provenance sidecars are written through temporary files and renamed into separate object/record paths. Every read revalidates revision identity, pinned registry commit and record hash, byte length, SHA-256, media signature/VRM envelope, licence, and source URL. Missing or invalid pairs are reacquired only through the bounded broker. Valid cached active assets load without network access. The catalog-aware cache has a 256 MiB ceiling and least-recently-used access ordering; it considers only exact catalog-derived paths, reference-counts shared content objects, and refuses to evict the active, rollback, acquisition, or pending revision. The control center exposes a read-only inventory projection and can remove only an unprotected model record/object through typed IPC. Removal never changes entitlement or selection, and catalog thumbnails remain cached because the visible catalog needs them.

The upstream registry is a candidate source, not Desky's commercial catalog. The planned admission pipeline pins the source commit and exact record/model hashes, reviews project plus embedded VRM permissions, executes the compatibility matrix, and emits an immutable admitted revision. A separately signed presentation catalog maps those revisions to localized metadata, release-profile availability, motion-safety profiles, and opaque offer IDs. Price labels are never charge authority.

The first executable catalog boundary is deliberately local and payment-free. `src/shared/avatar-marketplace.ts` strictly parses a bounded `bundled-foundation` catalog, rejects locked entries while commerce is disabled, rejects candidates presented as available, and evaluates only free grants. Main owns catalog, thumbnail, acquisition, preview, activation, and exact-source IPC; the renderer receives no arbitrary URL-opening or fetching primitive. Milk, CoolBanana, and Astronaut are immutable admitted revisions. A Marketplace 3D preview loads verified bytes into an isolated control-center scene with its own renderer, validation, disposal, and rotation state; it never creates pending selection or agent motion. Activation remains two-phase: main verifies/cache-stages a pending revision, the ambient renderer performs full runtime admission, and only a matching ready report commits active plus rollback revision. An error restores the previous revision. Remote catalog signatures and production CDN delivery remain open.

Production premium delivery uses content-addressed immutable object storage/CDN with short-lived authorization and exact hash verification. GitHub, Arweave, and IPFS may remain provenance/source locations; no GitHub PAT proxy or renderer-accessible general fetch surface becomes the entitlement boundary. The full catalog contract is in `docs/AVATAR-MARKETPLACE.md`.

### Commerce and entitlements

Commerce is a provider-neutral service boundary, separate from gateway adapters and avatar rendering:

```text
verified offer -> human approval -> commerce provider -> durable order
       -> append-only entitlement grant -> short-lived access JWT
       -> authorized immutable asset -> main-process verification/cache
```

Free, StoreKit, Microsoft commerce, x402 Base/Solana, promotion, and support grants project into the same product entitlement model. Payment settlement never writes access directly, and a JWT is never the durable purchase record. The entitlement service owns idempotent orders, reconciliation, refunds/revocations, restore, key rotation, and bounded offline leases. Main owns OS-vault credentials and release-profile enforcement; the renderer receives only typed catalog, quote, order, and install projections.

F4x.1a–b make the contract and repository semantics executable without enabling commerce. Strict shared parsers admit products, offers, authoritative quotes, quote-bound atomic-string orders/payment attempts, append-only entitlement events, and exact revision-bound asset grants. Pure state machines reject skipped/backwards transitions. Main has a dependency-free strict Ed25519 access-token verifier. A service-only SQLite conformance adapter proves immutable identifiers, uniqueness, compare-and-swap transitions, atomic verified-settlement-to-grant, rollback, exact replay, and close/reopen durability; it is not imported into Electron and is not the hosted production database. The four release policies still expose only the free provider. Production service/API/database operations, JWKS/refresh/offline lease, reconciliation, and every payment route remain gated.

F4x.1c adds the provider-disabled recovery boundary: exact restore/refresh/reconciliation schemas, fixed HTTPS routes, production repository interfaces, strict rotating JWKS, OS-encrypted rotating refresh state, installation-bound offline leases with pinned verification key/trusted-time checks, and an online-before-persist reconciliation coordinator. Service-only code remains outside Electron; main receives no price/payment authority and exposes no commerce IPC. ADR 0004 records the boundary and its offline-clock limitation.

F4x.2a–d pin the provider-disabled Base Sepolia x402 v2 exact/EIP-3009 boundary, make indeterminate settlement durable, and establish a non-custodial hosted checkout/browser runtime. Verification produces immutable authorization evidence, never a transaction claim. Append-only observations monotonically reconcile timeout/callback loss through unknown/pending to settled or failed, with transaction reuse blocked across authorizations. Granting requires one exact durable settled observation; unknown/pending/settled-but-ungranted orders cannot close or retry. Main coordinates a single-use exact-terms human approval, a PKCE-style browser challenge, and a short-lived hosted session. The hosted page exchanges a fragment verifier for a `__Host-` HttpOnly/SameSite cookie and rotating CSRF token, renders terms that must exactly equal the EIP-712 signing request, and uses EIP-1193 only after explicit user action. Opening the page creates no payment attempt. A signed payload is strictly admitted, retained only in memory, and protected by a digest-bound processing lease plus F4x.2c's atomic one-shot `/settle` claim. ADRs 0005–0007 record reconciliation, custody, and browser security.

F4x.2e.1 adds a separately built Netlify checkout workspace, hardened static wallet shell, five fixed Functions, PostgreSQL migration, and an asynchronous transactional `PostgresCheckoutLedger`. F4x.2e.2 connects that isolated service to a dedicated Supabase PostgreSQL 17 project through the TLS-verified Supavisor transaction pooler. Commerce state lives only in the private `desky_commerce` schema behind a least-privilege login; Supabase Data API roles have no access. Project/host/port/database and the Supabase Root 2021 CA are pinned, SSL enforcement is enabled, and two real instances proved atomic settlement-dispatch exclusion. Database-only liveness is healthy while payment readiness remains sanitized 503 because no merchant/facilitator is admitted. ADRs 0008–0009 record the deployment and database split.

F4x.2e.3 adds the hosted issuer side of the existing client trust model. Supabase Auth proves a human subject but never grants a product; Desky maps it to an opaque account, transactionally issues the three permanent free grants, and signs short access/offline authorization with a Netlify-scoped Ed25519 key exposed only through strict JWKS. Refresh and one-time recovery credentials are deterministic HMAC outputs for exact replay, but only keyed digests persist. An optional server-only offer policy owns paid quote terms; because none is configured, the deployed quote/payment boundary stays unavailable. Shared PostgreSQL rate windows, secret operator status/reconciliation/backup routes, AES-256-GCM logical export, DPAPI pilot escrow, and a fifteen-minute scheduled monitor establish the pre-funded operations boundary. ADR 0010 records the decision and its remaining external paging, off-device escrow, real-user, and automated reconciliation gates.

F4x.2e.4 closes automated testnet observation and paid-grant projection without opening payment. The public facilitator remains the one-shot verifier/settler, while a separate HTTPS Base RPC observer finds the exact USDC EIP-3009 authorization event, verifies the successful receipt and exact transfer, waits three confirmations, and appends monotonic chain evidence. It never retries settlement and never interprets absence as failure. Only the existing transactional settled-observation-to-entitlement commit can grant the exact quote revision. Toothpaste is pinned as the sole 0.10 test-USDC paid-pilot revision outside the bundled free catalog and every Store profile. ADR 0011 records the failure-domain split. Real Supabase app identity, merchant address, offer enablement and funded matrix remain open.

An agent-facing commerce capability is read-mostly and provider-neutral. Agents may search the catalog, inspect entitlement status, and prepare a trusted checkout deep link. They cannot supply price/network/asset/recipient authority, sign a wallet transaction, or bypass the local human approval surface. See `docs/COMMERCE-ENTITLEMENTS.md`.

### Avatar renderer

- WebGL renderer with alpha enabled.
- VRM 0.x and VRM 1.0 detection from parsed metadata, with legacy coordinate rotation restricted to VRM 0.x.
- Preflight capability inventory for normalized humanoid bones, expressions/visemes, blink, look-at, and spring-bone joints.
- Fail-closed core humanoid and embedded usage-permission checks before a model enters the scene.
- SHA-256 provenance over the exact downloaded model bytes, joined to reviewed catalog licence metadata and retained with the loaded scene.
- Fixed timestep where animation correctness requires it; render interpolation for display refresh.
- Use a provider-neutral 30 FPS ambient/idle target and 60 FPS for live semantic work, explicit cues, and local previews; lifecycle suspension still stops the loop rather than merely throttling it.
- Stop the animation-frame loop when the native surface is hidden, Chromium reports the document hidden/occluded, Electron reports OS power suspend, or WebGL is unavailable. Motion time advances only while rendering is active.
- Pause or reduce work when battery-saving mode or reduced-motion is enabled.
- Dispose geometries, materials, textures, mixers, and object URLs on replacement.
- Measure the character's projected visible bounds for safe bubble/composer placement without treating the full transparent canvas as occupied.
- Preserve the relaxed-pose presentation size while live skinned-vertex bounds remain safe; smoothly contract the perspective-camera envelope only for poses that would cross the transparent surface, then ease back. Framing policy consumes geometry, not avatar or clip names.

### Animation pipeline

The source registry contains avatars, not animation clips. Desky maintains a reproducible offline conversion pipeline:

1. Record source animation, author, licence, and checksum.
2. Select an exact animation from a reviewed Mixamo or universal-humanoid FBX and convert it to a canonical intermediate representation.
3. Retarget by normalized humanoid bone names with explicit VRM-version handling.
4. Validate hips translation scale, rest-pose rotations, handedness, and foot contact.
5. Emit versioned clips plus provenance metadata.
6. Test clips against a representative VRM 0.x/1.0 compatibility suite.

Runtime prompt-generated conversions are not release inputs. Conversion scripts and deterministic outputs are reviewed and versioned.

Animation admission is separate from conversion. `src/shared/animation-manifest.ts` rejects clips without validated source/output provenance, the pinned retargeting profile, deterministic sampling/root-motion parameters, and an approved rights review. No runtime clip loader may bypass this parser.

The canonical clip stores rest-corrected rotations in VRM 1.0 normalized-humanoid coordinates and hips translation in source-rest-height units. `src/renderer/avatar/create-vrm-animation-clip.ts` scales hips to the selected avatar and performs the VRM 0.x axis conversion only while binding. This separates deterministic offline conversion from target-specific runtime mechanics. Operational detail is in `docs/ANIMATION-PIPELINE.md`.

`src/renderer/avatar/animation-library-runtime.ts` first reparses and hashes every generated catalogue clip, validates CC0 rights consistency, resolves exact state registrations, and validates each program's layer. `motion-arbiter.ts` then maps normalized state to an admitted clip and playback contract. A disconnected companion inherits the admitted idle loop when no disconnected-specific clip exists, while retaining disconnected priority and semantics; network state must never reveal an imported bind pose. `avatar-motion-controller.ts` owns the per-avatar mixer, deterministic procedural fallback, the only full-body cue queue, and sequenced catalogue playback. `autonomous-motion-scheduler.ts` selects only file-declared ambient programs by eligible mode and quiet interval. It supports validated exact cycles as well as weighted/cooldown policy, and contains no animation filenames. A mode cannot mix cycle and weighted policy or admit incomplete/competing cycles. Local user Wave/Jump remains available without a selected session unless reduced motion or an authoritative state blocks it. `avatar-expression-controller.ts` owns optional additive blink, look-at, and preset expressions. Cancellation never depends on clip availability, and an invalid library, target binding, or missing optional facial capability degrades without failing the render loop or turn.

## Persistence

Initial persistence is split by sensitivity:

- OS credential encryption (`safeStorage`): gateway credentials, Ed25519 private identity, and paired device tokens in an opaque application-data vault.
- Application data directory: validated settings, bounded display-arrangement placement records, selected avatar reference, redacted session index. Full click-through is intentionally not persisted.
- Main-process memory only: the current unsent composer draft and revisioned live companion snapshot; both end when the application exits.
- Optional transcript store: disabled until encryption, retention controls, and deletion semantics are implemented.
- Cache directory: catalog JSON, previews, and avatar binaries with licence/provenance sidecars and bounded size.

## Capability profiles

Build-time profile selection is security-sensitive and cannot be toggled by renderer code.

| Capability | `store` | `direct` |
| --- | ---: | ---: |
| HTTPS/WSS gateway | yes | yes |
| User-selected avatar import | yes | yes |
| Arbitrary local agent CLI | no on MAS | yes |
| Bundled sandbox-inheriting helper | where reviewed | yes |
| In-app self-update | no on MAS | yes |
| Store-managed update | yes | no |

Windows Store may support more than the least-common `store` profile. Platform capability manifests can refine permissions, but product copy must remain accurate per package.

## Failure model

- Gateway loss enters `disconnected`, preserves unsent user input, and offers explicit reconnect.
- Malformed events are quarantined and reported without crashing the render loop.
- Avatar failure displays an accessible status and permits catalog replacement.
- WebGL loss pauses the loop while restoration remains possible. After a bounded deadline it exposes an accessible terminal fallback; explicit retry replaces the canvas and renderer before re-admitting the selected avatar.
- Adapter crashes use bounded exponential restart with a visible stop option.
- Approval events never auto-resolve after reconnection.

## Performance budgets

Budgets will be enforced in CI/device testing as instrumentation lands:

- Visible idle: target below 3% CPU on reference laptop and 30 FPS default.
- Active animation: target below 10% CPU and adaptive 30/60 FPS.
- Hidden/occluded: render loop suspended.
- Renderer working set: target below 350 MB with one normal-complexity avatar.
- Avatar download: default maximum 100 MB, user-confirmed override.
- Catalog JSON cache: one-hour freshness, stale-on-error behavior.
