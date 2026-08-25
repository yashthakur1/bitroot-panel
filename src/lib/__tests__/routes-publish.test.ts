// Publishing writes DNS at Cloudflare and rewrites the config of a running
// tunnel. The failure paths are the point of these tests: a half-created route
// is what left a bucket with a live DNS record pointing at an ingress rule that
// no longer matched, and every request 404ing.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publish,
  unpublish,
  parseIngress,
  type RouteEffects,
  type VerifyResult,
} from "../routes";

const START = `tunnel: abc
credentials-file: /home/u/.cloudflared/abc.json

ingress:
  - hostname: existing.bitroot.club
    service: http://localhost:3210
  - service: http_status:404
`;

const OK: VerifyResult = {
  ok: true,
  checks: { dns: "ok", ingress: "ok", tunnel: "ok", tls: "ok", origin: "ok" },
};
const BAD: VerifyResult = {
  ok: false,
  checks: {
    dns: "ok",
    ingress: "ok",
    tunnel: "ok",
    tls: "failed",
    origin: "unknown",
  },
  reason: "TLS handshake failed",
};

/** Records what happened, so a test can assert on the sequence, not just the end. */
function fake(over: Partial<RouteEffects> = {}, verify: VerifyResult = OK) {
  const log: string[] = [];
  let config = START;
  const fx: RouteEffects = {
    readConfig: async () => config,
    writeConfig: async (t) => {
      log.push("write");
      config = t;
    },
    reloadTunnel: async () => void log.push("reload"),
    createDns: async () => void log.push("createDns"),
    deleteDns: async () => void log.push("deleteDns"),
    verify: async () => verify,
    ...over,
  };
  return { fx, log, config: () => config };
}

test("a successful publish writes DNS, then config, then reloads", () => {
  const f = fake();
  return publish(f.fx, {
    hostname: "new.bitroot.club",
    service: "http://localhost:5000",
    zone: "bitroot.club",
  }).then((r) => {
    assert.equal(r.ok, true);
    assert.equal(r.unchanged, false);
    assert.deepEqual(
      f.log,
      ["createDns", "write", "reload"],
      "DNS before config",
    );
    assert.ok(
      parseIngress(f.config()).some((e) => e.hostname === "new.bitroot.club"),
    );
  });
});

test("a hostname the certificate cannot cover is refused before anything happens", async () => {
  const f = fake();
  const r = await publish(f.fx, {
    hostname: "deep.sub.bitroot.club",
    service: "http://localhost:1",
    zone: "bitroot.club",
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /levels below/);
  assert.deepEqual(f.log, [], "nothing was touched");
  assert.equal(f.config(), START, "config untouched");
});

test("failed verification rolls back the config AND the DNS record", async () => {
  const f = fake({}, BAD);
  const r = await publish(f.fx, {
    hostname: "new.bitroot.club",
    service: "http://localhost:5000",
    zone: "bitroot.club",
  });
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  assert.match(r.reason!, /TLS handshake failed/);
  assert.equal(f.config(), START, "the exact original text is restored");
  assert.ok(f.log.includes("deleteDns"), "the record it created was removed");
});

test("rolling back a REPOINT keeps the DNS record", async () => {
  // The record predates this attempt. Deleting it would break the route that
  // was working before the failed repoint.
  const f = fake({}, BAD);
  const r = await publish(f.fx, {
    hostname: "existing.bitroot.club",
    service: "http://localhost:9999",
    zone: "bitroot.club",
  });
  assert.equal(r.rolledBack, true);
  assert.ok(!f.log.includes("deleteDns"), "kept the pre-existing record");
  assert.equal(f.config(), START, "the original service is back");
});

test("a throwing effect also rolls back", async () => {
  const f = fake({
    reloadTunnel: async () => {
      throw new Error("cloudflared refused to reload");
    },
  });
  const r = await publish(f.fx, {
    hostname: "new.bitroot.club",
    service: "http://localhost:5000",
    zone: "bitroot.club",
  });
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  assert.match(r.reason!, /refused to reload/);
});

test("rollback continues even when restoring the config throws", async () => {
  // A rollback that stops halfway leaves the split state it exists to prevent.
  let writes = 0;
  const f = fake(
    {
      writeConfig: async () => {
        writes += 1;
        if (writes === 2) throw new Error("disk full");
      },
    },
    BAD,
  );
  const r = await publish(f.fx, {
    hostname: "new.bitroot.club",
    service: "http://localhost:5000",
    zone: "bitroot.club",
  });
  assert.equal(r.rolledBack, true);
  assert.ok(f.log.includes("deleteDns"), "still removed the DNS record");
});

test("publishing an identical route changes nothing but still verifies", async () => {
  // The entry existing is not evidence it works. Reporting "already published"
  // for a broken route is how a problem stays hidden.
  const f = fake({}, BAD);
  const r = await publish(f.fx, {
    hostname: "existing.bitroot.club",
    service: "http://localhost:3210",
    zone: "bitroot.club",
  });
  assert.equal(r.unchanged, true);
  assert.equal(r.ok, false, "a broken existing route is not a success");
  assert.deepEqual(f.log, [], "nothing rewritten");
});

test("unpublish removes the entry and the record", async () => {
  const f = fake();
  const r = await unpublish(f.fx, "existing.bitroot.club");
  assert.equal(r.ok, true);
  assert.deepEqual(f.log, ["write", "reload", "deleteDns"]);
  assert.ok(
    !parseIngress(f.config()).some(
      (e) => e.hostname === "existing.bitroot.club",
    ),
  );
});

test("unpublishing something absent is success, not an error", async () => {
  // It is the state asked for, and a retry after a partial failure must not
  // report a problem.
  const f = fake();
  const r = await unpublish(f.fx, "never.bitroot.club");
  assert.equal(r.ok, true);
  assert.equal(r.unchanged, true);
  assert.deepEqual(f.log, []);
});
