import { describe, expect, test } from "bun:test";

import {
  formatClock,
  formatDuration,
  mergePollResults,
  percentOf,
  secondsLeft,
  serverOffsetMs,
  transportFromStats,
} from "../components/Objects/Live/liveMath.ts";

// LiveBridge timers run against the SERVER clock (quiz deadlines, poll
// closes_at). These pin the skew correction and the live-results merge that
// keeps poll counts hidden from learners who haven't voted.

describe("serverOffsetMs", () => {
  test("measures how far the server clock is ahead", () => {
    const received = Date.parse("2026-09-23T10:00:00.000Z");
    expect(serverOffsetMs("2026-09-23T10:00:05.000Z", received)).toBe(5000);
    expect(serverOffsetMs("2026-09-23T09:59:58.000Z", received)).toBe(-2000);
  });

  test("falls back to no offset", () => {
    expect(serverOffsetMs(null)).toBe(0);
    expect(serverOffsetMs("not a date")).toBe(0);
  });
});

describe("secondsLeft", () => {
  const now = Date.parse("2026-09-23T10:00:00.000Z");

  test("counts down to the deadline, rounding up", () => {
    expect(secondsLeft("2026-09-23T10:00:30.000Z", 0, now)).toBe(30);
    expect(secondsLeft("2026-09-23T10:00:29.100Z", 0, now)).toBe(30);
  });

  test("applies the server offset (device clock behind the server)", () => {
    // Server is 10s ahead, so only 20s of a 30s window remain.
    expect(secondsLeft("2026-09-23T10:00:30.000Z", 10_000, now)).toBe(20);
  });

  test("never goes negative and handles missing deadlines", () => {
    expect(secondsLeft("2026-09-23T09:59:00.000Z", 0, now)).toBe(0);
    expect(secondsLeft(null, 0, now)).toBeNull();
    expect(secondsLeft("garbage", 0, now)).toBeNull();
  });
});

describe("formatting", () => {
  test("formatClock", () => {
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(-3)).toBe("0:00");
  });

  test("formatDuration", () => {
    expect(formatDuration(3900)).toBe("1h 5m");
    expect(formatDuration(125)).toBe("2m");
    expect(formatDuration(20)).toBe("<1m");
  });

  test("percentOf", () => {
    expect(percentOf(61, 84)).toBe(73);
    expect(percentOf(3, 0)).toBe(0);
  });
});

describe("mergePollResults", () => {
  const visible = { poll_uuid: "p1", counts: [1, 0], total_votes: 1, my_vote: 0 };
  const hidden = { poll_uuid: "p1", counts: null, total_votes: 0, my_vote: null };
  const other = { poll_uuid: "p2", counts: [0, 0], total_votes: 0, my_vote: null };
  const update = { poll_uuid: "p1", counts: [3, 5], total_votes: 8 };

  test("updates counts the viewer can already see", () => {
    const [merged, untouched] = mergePollResults([visible, other], update);
    expect(merged.counts).toEqual([3, 5]);
    expect(merged.total_votes).toBe(8);
    expect(untouched).toBe(other);
  });

  test("keeps results hidden from a learner who hasn't voted", () => {
    const [merged] = mergePollResults([hidden], update);
    expect(merged.counts).toBeNull();
    expect(merged.total_votes).toBe(0);
  });

  test("passes through an empty cache", () => {
    expect(mergePollResults(undefined, update)).toBeUndefined();
  });
});

// Which transport a browser really used: direct UDP, LiveKit's TCP fallback,
// or TURN relay. Feeds the live_connected diagnostics event.
describe("transportFromStats", () => {
  const report = (stats) => new Map(stats.map((s) => [s.id, s]));

  test("reads the selected pair via the transport stat", () => {
    const stats = report([
      { id: "T", type: "transport", selectedCandidatePairId: "P" },
      { id: "P", type: "candidate-pair", localCandidateId: "L" },
      { id: "L", type: "local-candidate", candidateType: "srflx", protocol: "udp" },
    ]);
    expect(transportFromStats(stats)).toBe("srflx/udp");
  });

  test("detects TCP fallback and TURN relay", () => {
    const tcp = report([
      { id: "P", type: "candidate-pair", state: "succeeded", nominated: true, localCandidateId: "L" },
      { id: "L", type: "local-candidate", candidateType: "host", protocol: "tcp" },
    ]);
    expect(transportFromStats(tcp)).toBe("host/tcp");
    const relay = report([
      { id: "T", type: "transport", selectedCandidatePairId: "P" },
      { id: "P", type: "candidate-pair", localCandidateId: "L" },
      { id: "L", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tls" },
    ]);
    expect(transportFromStats(relay)).toBe("relay/tls");
  });

  test("returns null without a usable pair", () => {
    expect(transportFromStats(undefined)).toBeNull();
    expect(transportFromStats(report([{ id: "P", type: "candidate-pair", state: "failed", localCandidateId: "L" }]))).toBeNull();
  });
});
