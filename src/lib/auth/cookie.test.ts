import { describe, expect, it } from "vitest";
import { isLocalAddress } from "./cookie";

describe("the address a request was made to, in local mode", () => {
  it("is this computer's own name, with or without a port", () => {
    for (const host of ["localhost", "localhost:3100", "127.0.0.1:3100", "[::1]:3100", "app.localhost:3100", "LOCALHOST:3100"]) expect(isLocalAddress(host, "")).toBe(true);
  });
  it("is not another machine's way in: a network address, a name pointed here, nothing at all", () => {
    for (const host of ["192.168.1.20:3100", "macbook.local:3100", "evil.example", "localhost.evil.example", "", null, undefined]) expect(isLocalAddress(host, "")).toBe(false);
  });
  it("accepts only the other names the owner listed", () => {
    expect(isLocalAddress("ufficio.lan:3100", "ufficio.lan, altro.lan")).toBe(true);
    expect(isLocalAddress("terzo.lan:3100", "ufficio.lan, altro.lan")).toBe(false);
  });
});
