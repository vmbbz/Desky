import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const profileId = process.argv[2];
const releaseMode = process.argv[3];
const artifactPaths = process.argv.slice(4).map((value) => resolve(value));
if (!profileId || !['development', 'production'].includes(releaseMode) || artifactPaths.length === 0) {
  throw new Error('Usage: generate-release-evidence.mjs <profile> <development|production> <artifact...>');
}

const budgets = JSON.parse(readFileSync(resolve('release', 'artifact-budgets.json'), 'utf8'));
const bundledNpmRoot = resolve(process.execPath, '..', 'node_modules', 'npm');
const bundledNpmCli = resolve(bundledNpmRoot, 'bin', 'npm-cli.js');
const npmPrefix = spawnSync(process.execPath, [resolve(bundledNpmRoot, 'bin', 'npm-prefix.js')], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
const prefixedNpmCli = npmPrefix.status === 0
  ? resolve(npmPrefix.stdout.trim(), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : '';
const npmCli = process.env.npm_execpath && existsSync(process.env.npm_execpath)
  ? process.env.npm_execpath
  : prefixedNpmCli && existsSync(prefixedNpmCli)
    ? prefixedNpmCli
    : bundledNpmCli;
const npmLauncher = { command: process.execPath, prefix: [npmCli] };
const profileBudgets = budgets.profiles?.[profileId];
if (!profileBudgets) throw new Error(`No artifact budget exists for ${profileId}.`);

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const artifactEvidence = artifactPaths.map((path) => {
  const extension = extname(path).toLowerCase();
  const budget = profileBudgets[extension];
  if (!budget) throw new Error(`No ${profileId} artifact budget exists for ${extension || basename(path)}.`);
  const bytes = statSync(path).size;
  if (bytes > budget.maximumBytes) {
    throw new Error(`${basename(path)} is ${bytes} bytes, above its ${budget.maximumBytes}-byte product budget.`);
  }
  return {
    filename: basename(path),
    bytes,
    sha256: sha256(path),
    maximumBytes: budget.maximumBytes,
    remainingBytes: budget.maximumBytes - bytes,
    purpose: budget.purpose,
  };
});

const evidenceRoot = resolve('out', 'release-evidence', profileId);
mkdirSync(evidenceRoot, { recursive: true });

const cyclonedxRoot = resolve('node_modules', '@cyclonedx', 'cyclonedx-npm');
const cyclonedxPackage = JSON.parse(readFileSync(resolve(cyclonedxRoot, 'package.json'), 'utf8'));
const cyclonedxCli = resolve(cyclonedxRoot, cyclonedxPackage.bin['cyclonedx-npm']);
const sbomPath = resolve(evidenceRoot, 'source-runtime.sbom.cdx.json');
const sbom = spawnSync(process.execPath, [
  cyclonedxCli,
  '--package-lock-only',
  '--omit', 'dev',
  '--output-reproducible',
  '--spec-version', '1.6',
  '--output-format', 'JSON',
  '--output-file', sbomPath,
  '--validate',
  'package.json',
], { cwd: process.cwd(), encoding: 'utf8' });
if (sbom.status !== 0) throw new Error(`CycloneDX SBOM generation failed: ${sbom.stderr || sbom.stdout}`);

const bom = JSON.parse(readFileSync(sbomPath, 'utf8'));
const flattened = [];
const visit = (components = []) => {
  for (const component of components) {
    flattened.push(component);
    visit(component.components);
  }
};
visit(bom.components);
const dependencyRows = [...new Map(flattened
  .filter((component) => component.name !== 'desky')
  .map((component) => {
    const licenses = (component.licenses ?? [])
      .map((entry) => entry.license?.id ?? entry.license?.name ?? entry.expression)
      .filter(Boolean);
    const row = {
      name: component.name,
      version: component.version ?? 'unknown',
      license: licenses.join(' OR ') || 'NOASSERTION',
      reference: component.purl ?? component.externalReferences?.[0]?.url ?? '',
    };
    return [`${row.name}@${row.version}`, row];
  })).values()].sort((left, right) => left.name.localeCompare(right.name));

const assetNotices = readFileSync(resolve('THIRD_PARTY_NOTICES.md'), 'utf8').trim();
const notices = [
  '# Desky third-party notices',
  '',
  'This generated release notice combines reviewed asset notices with a conservative source-runtime dependency inventory from the lockfile. Store-free artifact policy is verified separately and may physically exclude optional source dependencies.',
  '',
  assetNotices.replace(/^# Third-party asset notices\s*/u, '## Third-party asset notices\n\n'),
  '',
  '## Source-runtime dependency inventory',
  '',
  '| Package | Version | Licence | Reference |',
  '| --- | --- | --- | --- |',
  ...dependencyRows.map((row) => `| ${row.name} | ${row.version} | ${row.license} | ${row.reference} |`),
  '',
].join('\n');
const noticesPath = resolve(evidenceRoot, 'THIRD-PARTY-NOTICES.md');
writeFileSync(noticesPath, notices, 'utf8');

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};
const gitStatus = run('git', ['status', '--porcelain=v1', '--untracked-files=all']);
if (releaseMode === 'production' && gitStatus) {
  throw new Error('Production release evidence requires a clean source tree.');
}

const audit = spawnSync(npmLauncher.command, [...npmLauncher.prefix, 'audit', '--omit=dev', '--json'], { cwd: process.cwd(), encoding: 'utf8' });
if (!audit.stdout) throw new Error(`Production dependency audit did not return JSON: ${audit.error ?? audit.stderr}`);
const auditReport = JSON.parse(audit.stdout);
const productionVulnerabilities = auditReport.metadata?.vulnerabilities?.total ?? -1;
if (audit.status !== 0 || productionVulnerabilities !== 0) {
  throw new Error(`Production dependency audit reported ${productionVulnerabilities} vulnerabilities.`);
}

const packageMetadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const forgeMetadata = JSON.parse(readFileSync(resolve('node_modules', '@electron-forge', 'cli', 'package.json'), 'utf8'));
const evidence = {
  schemaVersion: 1,
  evidenceClass: 'desky-build-evidence-not-slsa',
  generatedAt: new Date().toISOString(),
  profileId,
  releaseMode,
  uploadable: releaseMode === 'production',
  commerceMode: 'disabled',
  source: {
    commit: run('git', ['rev-parse', 'HEAD']),
    treeClean: !gitStatus,
    changedPathCount: gitStatus ? gitStatus.split(/\r?\n/u).length : 0,
    packageLockSha256: sha256(resolve('package-lock.json')),
  },
  toolchain: {
    node: process.version,
    npm: run(npmLauncher.command, [...npmLauncher.prefix, '--version']),
    electron: packageMetadata.devDependencies.electron,
    electronForge: forgeMetadata.version,
    cyclonedxNpm: cyclonedxPackage.version,
  },
  verification: {
    productionDependencyVulnerabilities: productionVulnerabilities,
    sbomFormat: 'CycloneDX 1.6 JSON',
    sbomScope: 'conservative source-runtime lockfile inventory',
    signedReleaseMetadata: false,
  },
  artifacts: artifactEvidence,
};

const metadataPath = resolve(evidenceRoot, 'release-metadata.json');
writeFileSync(metadataPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
const artifactVerificationPath = resolve(evidenceRoot, 'artifact-verification.json');
const certificationSummaryPath = resolve(evidenceRoot, 'wack-report.summary.json');
const certificationReportPath = resolve(evidenceRoot, 'wack-report.xml');
const certificationEvidence = [];
if (existsSync(certificationSummaryPath) || existsSync(certificationReportPath)) {
  if (!existsSync(certificationSummaryPath) || !existsSync(certificationReportPath)) {
    throw new Error('Windows certification evidence is incomplete. Both the report and summary are required.');
  }
  const certificationSummary = JSON.parse(readFileSync(certificationSummaryPath, 'utf8'));
  const certifiedArtifact = artifactPaths.find((path) => path === resolve(certificationSummary.package));
  if (!certifiedArtifact || certificationSummary.packageSha256 !== sha256(certifiedArtifact)) {
    throw new Error('Windows certification evidence does not bind the current artifact digest.');
  }
  if (certificationSummary.overallResult !== 'PASS' || certificationSummary.requiredFailedTestCount !== 0) {
    throw new Error('Windows certification evidence did not pass required tests.');
  }
  certificationEvidence.push(certificationSummaryPath, certificationReportPath);
}
const digestTargets = [
  ...artifactPaths,
  sbomPath,
  noticesPath,
  metadataPath,
  ...(existsSync(artifactVerificationPath) ? [artifactVerificationPath] : []),
  ...certificationEvidence,
];
const digestLines = digestTargets.map((path) => `${sha256(path)}  ${basename(path)}`).sort().join('\n');
writeFileSync(resolve(evidenceRoot, 'SHA256SUMS'), `${digestLines}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generated: true,
  profileId,
  releaseMode,
  evidenceRoot,
  artifacts: artifactEvidence,
  productionVulnerabilities,
  treeClean: !gitStatus,
})}\n`);
