import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type S3Settings = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  prefix?: string;
  retention?: number;
  curlBinary?: string;
};

export type S3RecoveryTransport = {
  put(key: string, path: string, contentType: string): void;
  headSize(key: string): number;
  getText(key: string): string;
  list(prefix: string): string[];
  delete(key: string): void;
};

export type S3UploadResult = {
  ok: true;
  action: "uploaded";
  bucket: string;
  region: string;
  bundle: string;
  remotePrefix: string;
  retained: number;
  pruned: string[];
  checksumVerified: true;
  sizeVerified: true;
};

const bundlePattern = /^kurami-recovery-\d{8}T\d{6}Z\.tar\.zst\.age$/;

function fail(message: string): never {
  throw new Error(message);
}

function validateSettings(settings: S3Settings): Required<Omit<S3Settings, "sessionToken">> & {
  sessionToken?: string;
} {
  const prefix = settings.prefix ?? "recovery/";
  const retention = settings.retention ?? 3;
  const curlBinary = settings.curlBinary ?? "curl";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(settings.bucket)) {
    fail("KURAMI_S3_BUCKET is invalid");
  }
  if (!/^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/.test(settings.region)) {
    fail("KURAMI_S3_REGION is invalid");
  }
  if (!/^[A-Z0-9]{16,128}$/.test(settings.accessKeyId)) {
    fail("AWS_ACCESS_KEY_ID is invalid");
  }
  if (!/^[A-Za-z0-9/+=]{20,256}$/.test(settings.secretAccessKey)) {
    fail("AWS_SECRET_ACCESS_KEY is invalid");
  }
  if (settings.sessionToken && /[\r\n"]/.test(settings.sessionToken)) {
    fail("AWS_SESSION_TOKEN contains unsafe characters");
  }
  if (!/^[a-z0-9][a-z0-9/_-]*\/$/.test(prefix) || prefix.includes("//")) {
    fail("KURAMI_S3_PREFIX must be a safe non-empty prefix ending in /");
  }
  if (!Number.isInteger(retention) || retention < 2 || retention > 30) {
    fail("KURAMI_S3_RETENTION must be an integer between 2 and 30");
  }
  return { ...settings, prefix, retention, curlBinary };
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export function createCurlS3Transport(input: S3Settings): S3RecoveryTransport {
  const settings = validateSettings(input);
  const baseUrl = `https://${settings.bucket}.s3.${settings.region}.amazonaws.com`;
  const config = [
    `aws-sigv4 = "aws:amz:${settings.region}:s3"`,
    `user = "${settings.accessKeyId}:${settings.secretAccessKey}"`,
    "silent",
    "show-error",
    "fail-with-body",
    settings.sessionToken
      ? `header = "x-amz-security-token: ${settings.sessionToken}"`
      : "",
  ]
    .filter(Boolean)
    .join("\n") + "\n";

  const curl = (args: string[]): string => {
    const result = spawnSync(settings.curlBinary, ["--config", "-", ...args], {
      encoding: "utf8",
      env: process.env,
      input: config,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.error) fail(result.error.message);
    if (result.status !== 0) {
      fail(
        result.stderr?.trim() ||
          result.stdout?.trim() ||
          `curl failed with status ${result.status}`,
      );
    }
    return result.stdout;
  };

  const objectUrl = (key: string): string => `${baseUrl}/${encodeKey(key)}`;
  return {
    put(key, path, contentType) {
      curl([
        "--request",
        "PUT",
        "--header",
        `content-type: ${contentType}`,
        "--header",
        "x-amz-server-side-encryption: AES256",
        "--upload-file",
        path,
        objectUrl(key),
      ]);
    },
    headSize(key) {
      const headers = curl(["--head", objectUrl(key)]);
      const match = headers.match(/^content-length:\s*(\d+)\s*$/im);
      if (!match) fail(`S3 HEAD response has no content-length: ${key}`);
      return Number(match[1]);
    },
    getText(key) {
      return curl(["--request", "GET", objectUrl(key)]);
    },
    list(prefix) {
      const query = `?list-type=2&prefix=${encodeURIComponent(prefix)}`;
      const xml = curl(["--request", "GET", `${baseUrl}/${query}`]);
      if (xml.includes("<IsTruncated>true</IsTruncated>")) {
        fail("S3 recovery listing unexpectedly exceeded one page");
      }
      return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) =>
        decodeXml(match[1]!),
      );
    },
    delete(key) {
      curl(["--request", "DELETE", objectUrl(key)]);
    },
  };
}

async function requirePrivateRegularFile(path: string): Promise<number> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`S3 upload source must be a regular non-symlink file: ${path}`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    fail(`S3 upload source permissions are too broad: ${path}`);
  }
  return metadata.size;
}

async function verifyLocalChecksum(bundle: string, checksumPath: string): Promise<string> {
  const bundleName = basename(bundle);
  const checksum = createHash("sha256").update(await readFile(bundle)).digest("hex");
  const expected = `${checksum}  ${bundleName}\n`;
  if ((await readFile(checksumPath, "utf8")) !== expected) {
    fail("Local recovery checksum does not match the encrypted bundle");
  }
  return expected;
}

export async function uploadRecoveryBundle(
  bundlePath: string,
  input: S3Settings,
  providedTransport?: S3RecoveryTransport,
): Promise<S3UploadResult> {
  const settings = validateSettings(input);
  const bundle = resolve(bundlePath);
  const bundleName = basename(bundle);
  if (!bundlePattern.test(bundleName)) fail(`Unsafe recovery bundle name: ${bundleName}`);
  const checksumPath = `${bundle}.sha256`;
  const bundleSize = await requirePrivateRegularFile(bundle);
  await requirePrivateRegularFile(checksumPath);
  const checksumText = await verifyLocalChecksum(bundle, checksumPath);
  const transport = providedTransport ?? createCurlS3Transport(settings);
  const bundleKey = `${settings.prefix}${bundleName}`;
  const checksumKey = `${bundleKey}.sha256`;

  transport.put(bundleKey, bundle, "application/octet-stream");
  transport.put(checksumKey, checksumPath, "text/plain");
  if (transport.headSize(bundleKey) !== bundleSize) {
    fail("Uploaded recovery bundle size does not match the local file");
  }
  if (transport.getText(checksumKey) !== checksumText) {
    fail("Uploaded recovery checksum does not match the local checksum");
  }

  const listed = transport.list(settings.prefix);
  const remoteBundles = listed
    .filter((key) => key.startsWith(settings.prefix))
    .map((key) => key.slice(settings.prefix.length))
    .filter((name) => bundlePattern.test(name))
    .sort()
    .reverse();
  if (!remoteBundles.includes(bundleName) || !listed.includes(checksumKey)) {
    fail("Uploaded recovery pair is missing from the S3 listing");
  }
  const pruned = remoteBundles.slice(settings.retention);
  for (const oldName of pruned) {
    transport.delete(`${settings.prefix}${oldName}`);
    transport.delete(`${settings.prefix}${oldName}.sha256`);
  }
  const after = transport.list(settings.prefix);
  const retained = after.filter((key) => {
    if (!key.startsWith(settings.prefix)) return false;
    return bundlePattern.test(key.slice(settings.prefix.length));
  }).length;
  if (retained > settings.retention) {
    fail("S3 recovery retention did not converge to the configured limit");
  }
  return {
    ok: true,
    action: "uploaded",
    bucket: settings.bucket,
    region: settings.region,
    bundle: bundleName,
    remotePrefix: settings.prefix,
    retained,
    pruned,
    checksumVerified: true,
    sizeVerified: true,
  };
}

async function latestBundle(orchestratorHome: string): Promise<string> {
  const root = resolve(orchestratorHome, "recovery");
  const names = (await readdir(root, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && !entry.isSymbolicLink() && bundlePattern.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!names[0]) fail("No local encrypted recovery bundle is available");
  return resolve(root, names[0]);
}

function settingsFromEnvironment(): S3Settings {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) fail(`${name} is required`);
    return value;
  };
  return {
    bucket: required("KURAMI_S3_BUCKET"),
    region: required("KURAMI_S3_REGION"),
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
    sessionToken: process.env.AWS_SESSION_TOKEN,
    prefix: process.env.KURAMI_S3_PREFIX,
    retention: process.env.KURAMI_S3_RETENTION
      ? Number(process.env.KURAMI_S3_RETENTION)
      : undefined,
    curlBinary: process.env.KURAMI_CURL_BIN,
  };
}

function formatSummary(result: S3UploadResult): string {
  return [
    "☁️ Kurami recovery bundle uploaded and verified",
    `- Bundle: ${result.bundle}`,
    `- Region: ${result.region}`,
    `- Remote prefix: ${result.remotePrefix}`,
    `- Retained current bundles: ${result.retained}`,
    `- Pruned current bundles: ${result.pruned.length}`,
    "- Size and checksum: verified",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] !== "upload-latest" || args.some((arg) => !["upload-latest", "--summary-text"].includes(arg))) {
    fail("Usage: s3-recovery.ts upload-latest [--summary-text]");
  }
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const result = await uploadRecoveryBundle(
    await latestBundle(orchestratorHome),
    settingsFromEnvironment(),
  );
  process.stdout.write(
    args.includes("--summary-text")
      ? `${formatSummary(result)}\n`
      : `${JSON.stringify(result)}\n`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
