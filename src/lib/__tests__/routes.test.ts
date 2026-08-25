// A route is a DNS record, an ingress entry and sometimes a garage setting.
// These test the decisions — parse, validate, plan — with no network, no tunnel
// and no Cloudflare, so the logic that will later rewrite a live config is
// proven before it can do any damage.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIngress,
  renderIngress,
  replaceIngressBlock,
  certificateCoverage,
  validateHostname,
  portOf,
  planPublish,
  planUnpublish,
  RouteError,
} from "../routes";

const REAL_CONFIG = `tunnel: cdcd77c2-f1b7-4d48-8c60-03b450cae1be
credentials-file: /home/ubuntu/.cloudflared/cdcd77c2.json
protocol: http2

ingress:
  - hostname: neevpanel.bitroot.club
    service: http://localhost:3210
  - hostname: pocketbase.bitroot.club
    service: http://localhost:8090
  - service: http_status:404
`;

test("parses a real config", () => {
  const e = parseIngress(REAL_CONFIG);
  assert.equal(e.length, 3);
  assert.deepEqual(e[0], {
    hostname: "neevpanel.bitroot.club",
    service: "http://localhost:3210",
  });
  assert.deepEqual(e[2], { service: "http_status:404" });
});

test("comments are not mistaken for entries", () => {
  // The installer seeds this file with commented examples.
  const e = parseIngress(`ingress:
  # - hostname: example.com
  #   service: http://localhost:1
  - hostname: real.example.com
    service: http://localhost:2
  - service: http_status:404
`);
  assert.equal(e.length, 2);
  assert.equal(e[0].hostname, "real.example.com");
});

test("the catch-all is forced last however it arrives", () => {
  // cloudflared matches top to bottom, so a catch-all above a hostname swallows
  // it: the route exists, the config looks right, every request returns 404.
  const out = renderIngress([
    { service: "http_status:404" },
    { hostname: "a.example.com", service: "http://localhost:1" },
  ]);
  assert.ok(out.indexOf("a.example.com") < out.indexOf("http_status:404"));
});

test("a config with no ingress block gains one", () => {
  const out = replaceIngressBlock("tunnel: abc\n", [
    { hostname: "a.example.com", service: "http://localhost:1" },
  ]);
  assert.match(out, /^tunnel: abc$/m);
  assert.match(out, /hostname: a\.example\.com/);
});

test("rewriting ingress leaves the rest of the file alone", () => {
  const out = replaceIngressBlock(REAL_CONFIG, [
    { hostname: "only.bitroot.club", service: "http://localhost:9" },
  ]);
  assert.match(out, /^tunnel: cdcd77c2/m, "tunnel id survived");
  assert.match(out, /^credentials-file:/m, "credentials survived");
  assert.match(out, /^protocol: http2$/m, "protocol survived");
  assert.ok(!out.includes("neevpanel"), "old entry gone");
  assert.equal(parseIngress(out).length, 2, "one host plus the catch-all");
});

test("parse and render round-trip", () => {
  const once = renderIngress(parseIngress(REAL_CONFIG));
  assert.deepEqual(parseIngress(once), parseIngress(REAL_CONFIG));
});

// ─── the certificate rule that cost an afternoon ─────────────────────────────

test("one level below the zone is covered", () => {
  assert.equal(
    certificateCoverage("pocketbase.bitroot.club", "bitroot.club").covered,
    true,
  );
});

test("the apex is covered", () => {
  assert.equal(
    certificateCoverage("bitroot.club", "bitroot.club").covered,
    true,
  );
});

test("two levels below the zone is refused, with the reason", () => {
  // Proven against Cloudflare: sslv3 alert handshake failure. A route that
  // cannot serve TLS is not a working route, so this refuses rather than warns.
  const r = certificateCoverage("test.neevpanel.bitroot.club", "bitroot.club");
  assert.equal(r.covered, false);
  assert.match(r.reason!, /2 levels below/);
  assert.match(
    r.reason!,
    /Advanced Certificate Manager/,
    "says how to lift the limit",
  );
});

test("a hostname outside the zone is refused", () => {
  const r = certificateCoverage("thing.example.org", "bitroot.club");
  assert.equal(r.covered, false);
  assert.match(r.reason!, /not inside the zone/);
});

// ─── validation ──────────────────────────────────────────────────────────────

test("bad hostnames are rejected", () => {
  for (const bad of [
    "",
    "no-dot",
    "UPPER.example.com",
    "a..b.com",
    "-lead.example.com",
    "sp ace.com",
  ]) {
    assert.throws(
      () => validateHostname(bad),
      RouteError,
      `should reject ${JSON.stringify(bad)}`,
    );
  }
});

test("good hostnames pass", () => {
  for (const ok of [
    "a.example.com",
    "test-stag.bitroot.club",
    "a.b.c.example.com",
  ]) {
    assert.doesNotThrow(() => validateHostname(ok));
  }
});

test("the port is read out of a service URL", () => {
  assert.equal(portOf("http://localhost:3210"), 3210);
  assert.equal(portOf("http://127.0.0.1:8090/"), 8090);
  assert.equal(
    portOf("http_status:404"),
    404,
    "reads a number even here — callers check hostname",
  );
  assert.equal(portOf("unix:/tmp/sock"), null);
});

// ─── planning ────────────────────────────────────────────────────────────────

test("publishing a new hostname appends it above the catch-all", () => {
  const plan = planPublish(
    parseIngress(REAL_CONFIG),
    "new.bitroot.club",
    "http://localhost:5000",
  );
  assert.equal(plan.changesIngress, true);
  const last = plan.ingress[plan.ingress.length - 1];
  assert.equal(last.hostname, undefined, "catch-all still last");
  assert.ok(plan.ingress.some((e) => e.hostname === "new.bitroot.club"));
});

test("publishing the same thing twice changes nothing", () => {
  // Idempotence matters: `project clone` re-runs, and a second publish must not
  // duplicate an entry or trigger a needless tunnel reload.
  const plan = planPublish(
    parseIngress(REAL_CONFIG),
    "neevpanel.bitroot.club",
    "http://localhost:3210",
  );
  assert.equal(plan.changesIngress, false);
  assert.equal(plan.ingress.length, 3);
});

test("repointing an existing hostname keeps its position and records what it replaced", () => {
  const plan = planPublish(
    parseIngress(REAL_CONFIG),
    "neevpanel.bitroot.club",
    "http://localhost:9999",
  );
  assert.equal(plan.changesIngress, true);
  assert.equal(
    plan.ingress[0].hostname,
    "neevpanel.bitroot.club",
    "position kept",
  );
  assert.equal(plan.ingress[0].service, "http://localhost:9999");
  assert.equal(
    plan.replaces?.service,
    "http://localhost:3210",
    "rollback knows the old value",
  );
  assert.equal(plan.ingress.length, 3, "no duplicate");
});

test("publishing refuses an invalid hostname before planning anything", () => {
  assert.throws(
    () => planPublish([], "NOT VALID", "http://localhost:1"),
    RouteError,
  );
});

test("unpublishing removes only that hostname", () => {
  const plan = planUnpublish(
    parseIngress(REAL_CONFIG),
    "pocketbase.bitroot.club",
  );
  assert.equal(plan.changesIngress, true);
  assert.equal(plan.removed?.service, "http://localhost:8090");
  assert.ok(
    !plan.ingress.some((e) => e.hostname === "pocketbase.bitroot.club"),
  );
  assert.ok(
    plan.ingress.some((e) => e.hostname === "neevpanel.bitroot.club"),
    "others kept",
  );
  assert.ok(
    plan.ingress.some((e) => !e.hostname),
    "catch-all kept",
  );
});

test("unpublishing something absent is a no-op, not an error", () => {
  const plan = planUnpublish(parseIngress(REAL_CONFIG), "never.bitroot.club");
  assert.equal(plan.changesIngress, false);
  assert.equal(plan.ingress.length, 3);
});

// ─── preserving what tunnel-add wrote ────────────────────────────────────────
// The first live run against a throwaway hostname produced a working config
// that had quietly lost every comment and its trailing newline. Nothing failed,
// and the file was markedly less readable than the one it replaced.

const ANNOTATED = `tunnel: abc
credentials-file: /home/u/.cloudflared/abc.json

ingress:
  # Routes are inserted above the catch-all, which must stay last.

  # neevpanel (port 3210)
  - hostname: neevpanel.bitroot.club
    service: http://localhost:3210

  # pocketbase (port 8090)
  - hostname: pocketbase.bitroot.club
    service: http://localhost:8090

  # Catch-all
  - service: http_status:404
`;

test("each route keeps the comment naming its service and port", () => {
  const e = parseIngress(ANNOTATED);
  assert.equal(e[0].comment, "neevpanel (port 3210)");
  assert.equal(e[1].comment, "pocketbase (port 8090)");
});

test("rewriting an annotated config keeps the annotations", () => {
  const out = replaceIngressBlock(ANNOTATED, parseIngress(ANNOTATED));
  for (const c of [
    "neevpanel (port 3210)",
    "pocketbase (port 8090)",
    "Catch-all",
  ]) {
    assert.ok(out.includes(`# ${c}`), `lost the comment: ${c}`);
  }
});

test("a rewritten file still ends with a newline", () => {
  // Invisible until something diffs the file, and then it is noise in every diff.
  const out = replaceIngressBlock(ANNOTATED, parseIngress(ANNOTATED));
  assert.ok(out.endsWith("\n"));
});

test("a new route is added without disturbing the existing comments", () => {
  const plan = planPublish(
    parseIngress(ANNOTATED),
    "new.bitroot.club",
    "http://localhost:5000",
  );
  const out = replaceIngressBlock(ANNOTATED, plan.ingress);
  assert.ok(
    out.includes("# neevpanel (port 3210)"),
    "existing annotation survived",
  );
  assert.ok(out.includes("new.bitroot.club"), "new route present");
  assert.equal(parseIngress(out).length, 4);
});

test("routes survive a rewrite unchanged", () => {
  const before = parseIngress(ANNOTATED);
  const after = parseIngress(replaceIngressBlock(ANNOTATED, before));
  assert.deepEqual(
    after.map((e) => [e.hostname, e.service]),
    before.map((e) => [e.hostname, e.service]),
  );
});
