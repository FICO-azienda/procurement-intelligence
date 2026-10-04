import { describe, expect, it } from "vitest";
import { ago } from "./activity";

describe("how long ago", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const before = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  it("speaks in minutes, hours, days — then gives the date", () => {
    expect(ago(before(0), now)).toBe("just now");
    expect(ago(before(1), now)).toBe("1 minute ago");
    expect(ago(before(10), now)).toBe("10 minutes ago");
    expect(ago(before(120), now)).toBe("2 hours ago");
    expect(ago(before(60 * 24 * 5), now)).toBe("5 days ago");
    expect(ago(before(60 * 24 * 60), now)).toBe("03/08/2026");
  });
});
