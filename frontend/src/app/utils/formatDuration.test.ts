import { describe, expect, it } from "vitest";
import { formatDurationMs } from "./formatDuration";

describe("formatDurationMs", () => {
  it("keeps millisecond precision under a second", () => {
    expect(formatDurationMs(0)).toBe("0 ms");
    expect(formatDurationMs(842)).toBe("842 ms");
    expect(formatDurationMs(999.6)).toBe("1000 ms");
  });

  it("uses one decimal of seconds under a minute", () => {
    expect(formatDurationMs(1000)).toBe("1.0 s");
    expect(formatDurationMs(12_340)).toBe("12.3 s");
    expect(formatDurationMs(59_949)).toBe("59.9 s");
  });

  it("switches to minutes and seconds", () => {
    expect(formatDurationMs(60_000)).toBe("1m 0s");
    expect(formatDurationMs(72_000)).toBe("1m 12s");
    expect(formatDurationMs(119_800)).toBe("2m 0s"); // 59.8s rounds up, never "1m 60s"
    expect(formatDurationMs(3_600_000)).toBe("60m 0s");
  });
});
