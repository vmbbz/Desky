# Desky release engineering

The committed files in this directory are policy inputs. Generated installers,
SBOMs, notices, digests, and build evidence are written below ignored `out/`
directories and are never committed.

- `artifact-budgets.json` is Desky's product budget, intentionally far below
  storefront maximums. A build that exceeds its profile budget fails.
- `windows-store-free` produces an MSIX whose exact Partner Center identity is
  required in production. It physically excludes local agent processes and all
  commerce capability.
- `windows-direct` produces the separately signed website installer. Its
  production build requires an external Authenticode certificate and password.

Development maker commands use isolated identities and are not uploadable
release candidates. Generated metadata says so explicitly.

After WACK completes, rerun `npm run release:evidence -- <profile>
<development|production> <artifact...>` with the same artifact path. The
evidence generator admits the report only when its summary binds the current
artifact SHA-256, reports overall PASS, and has zero required failures.
