import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import type { S3RecoveryTransport } from "../src/s3-recovery.ts";
import {
  createCurlS3Transport,
  uploadRecoveryBundle,
} from "../src/s3-recovery.ts";

function fail(message: string): never {
  throw new Error(message);
}

class MemoryS3 implements S3RecoveryTransport {
  readonly objects = new Map<string, Buffer>();
  readonly operations: string[] = [];

  put(key: string, path: string): void {
    this.operations.push(`put:${key}`);
    this.objects.set(key, Buffer.from(readFileSync(path)));
  }

  headSize(key: string): number {
    this.operations.push(`head:${key}`);
    const value = this.objects.get(key);
    if (!value) fail(`Missing fake S3 object: ${key}`);
    return value.byteLength;
  }

  getText(key: string): string {
    this.operations.push(`get:${key}`);
    const value = this.objects.get(key);
    if (!value) fail(`Missing fake S3 object: ${key}`);
    return value.toString("utf8");
  }

  list(prefix: string): string[] {
    this.operations.push(`list:${prefix}`);
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  delete(key: string): void {
    this.operations.push(`delete:${key}`);
    this.objects.delete(key);
  }
}

const root = await mkdtemp(resolve(tmpdir(), "kurami-s3-recovery-test-"));
const transport = new MemoryS3();
const settings = {
  bucket: "kurami-orchestrator-recovery-123456789012-eu-west-1-an",
  region: "eu-west-1",
  accessKeyId: "AKIATESTRECOVERY1234",
  secretAccessKey: "testSecretKeyValue1234567890/+=",
  prefix: "recovery/",
  retention: 3,
};

try {
  await mkdir(resolve(root, "recovery"), { recursive: true, mode: 0o700 });
  const fakeCurl = resolve(root, "fake-curl.cjs");
  const fakeCurlLog = resolve(root, "fake-curl-log.json");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env node
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  fs.writeFileSync(process.env.KURAMI_FAKE_CURL_LOG, JSON.stringify({ args: process.argv.slice(2), input }));
});
`,
    { mode: 0o700 },
  );
  await chmod(fakeCurl, 0o700);
  const uploadProbe = resolve(root, "probe.age");
  await writeFile(uploadProbe, "encrypted-probe", { mode: 0o600 });
  process.env.KURAMI_FAKE_CURL_LOG = fakeCurlLog;
  createCurlS3Transport({ ...settings, curlBinary: fakeCurl }).put(
    "recovery/probe.age",
    uploadProbe,
    "application/octet-stream",
  );
  const curlEvidence = JSON.parse(await readFile(fakeCurlLog, "utf8")) as {
    args: string[];
    input: string;
  };
  const renderedArgs = curlEvidence.args.join(" ");
  if (
    renderedArgs.includes(settings.accessKeyId) ||
    renderedArgs.includes(settings.secretAccessKey) ||
    !curlEvidence.input.includes(settings.accessKeyId) ||
    !curlEvidence.input.includes(settings.secretAccessKey)
  ) {
    fail("AWS credentials were not confined to curl stdin configuration");
  }

  let latestResult: Awaited<ReturnType<typeof uploadRecoveryBundle>> | null = null;
  for (let day = 21; day <= 24; day += 1) {
    const name = `kurami-recovery-202608${day}T140000Z.tar.zst.age`;
    const bundle = resolve(root, "recovery", name);
    const content = Buffer.from(`encrypted-${day}`);
    const checksum = createHash("sha256").update(content).digest("hex");
    await writeFile(bundle, content, { mode: 0o600 });
    await writeFile(`${bundle}.sha256`, `${checksum}  ${name}\n`, { mode: 0o600 });
    latestResult = await uploadRecoveryBundle(bundle, settings, transport);
  }
  if (!latestResult || latestResult.retained !== 3 || latestResult.pruned.length !== 1) {
    fail(`Unexpected S3 retention result: ${JSON.stringify(latestResult)}`);
  }
  const keys = [...transport.objects.keys()].sort();
  if (keys.length !== 6 || keys.some((key) => key.includes("20260821"))) {
    fail(`S3 retention did not keep exactly three pairs: ${JSON.stringify(keys)}`);
  }
  const latest = keys.find((key) => key.endsWith("20260824T140000Z.tar.zst.age"));
  if (!latest || !transport.operations.includes(`head:${latest}`)) {
    fail("Latest S3 bundle was not uploaded and size-verified");
  }
  if (!transport.operations.includes(`get:${latest}.sha256`)) {
    fail("Latest S3 checksum was not read back");
  }

  const tamperedName = "kurami-recovery-20260825T140000Z.tar.zst.age";
  const tampered = resolve(root, tamperedName);
  await writeFile(tampered, "encrypted", { mode: 0o600 });
  await writeFile(`${tampered}.sha256`, `${"0".repeat(64)}  ${tamperedName}\n`, {
    mode: 0o600,
  });
  const operationsBefore = transport.operations.length;
  let tamperRejected = false;
  try {
    await uploadRecoveryBundle(tampered, settings, transport);
  } catch {
    tamperRejected = true;
  }
  if (!tamperRejected || transport.operations.length !== operationsBefore) {
    fail("Tampered local bundle reached the S3 transport");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      isolated: true,
      bucket: settings.bucket,
      region: settings.region,
      retainedPairs: keys.length / 2,
      sizeVerified: true,
      checksumReadBack: true,
      credentialsExcludedFromProcessArgs: true,
      tamperRejected,
      exactPrefix: true,
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
