import assert from "node:assert/strict";

import { auditOutcome, serializeSafeAuditBody } from "../src/lib/audit.js";

const serialized = serializeSafeAuditBody({
  password: "never-log-this",
  smsCode: "123456",
  authorization: "Bearer secret",
  phone: "17721384897",
  email: "person@example.test",
  receiverName: "Test Person",
  addressLine: "Test street",
  trackingNo: "TRACK-SECRET",
  objectKey: "private/user/file.png",
  signedUrl: "https://example.test/private?token=secret",
  nested: { accessToken: "nested-secret", harmless: "kept" },
});

assert.ok(serialized);
assert.equal(serialized.includes("never-log-this"), false);
assert.equal(serialized.includes("123456"), false);
assert.equal(serialized.includes("Bearer secret"), false);
assert.equal(serialized.includes("17721384897"), false);
assert.equal(serialized.includes("person@example.test"), false);
assert.equal(serialized.includes("Test Person"), false);
assert.equal(serialized.includes("Test street"), false);
assert.equal(serialized.includes("TRACK-SECRET"), false);
assert.equal(serialized.includes("private/user/file.png"), false);
assert.equal(serialized.includes("https://example.test/private"), false);
assert.equal(serialized.includes("nested-secret"), false);
assert.equal(serialized.includes("harmless"), true);
assert.equal(serialized.includes("177****4897"), true);

assert.equal(auditOutcome(200), "SUCCESS");
assert.equal(auditOutcome(400), "FAILED");
assert.equal(auditOutcome(401), "DENIED");
assert.equal(auditOutcome(403), "DENIED");
assert.equal(auditOutcome(500), "FAILED");

console.log(
  "PASS audit safety: sensitive values are redacted and outcomes are classified",
);
