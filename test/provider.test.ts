import { afterEach, describe, expect, it, vi } from "vitest";
import { detectProvider } from "../src/worker/provider";

afterEach(() => vi.restoreAllMocks());

function mockMx(records: Record<string, string[]>) {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const name = url.searchParams.get("name") ?? "";
    asked.push(name);
    return Response.json({ Answer: (records[name] ?? []).map((data) => ({ type: 15, data })) });
  });
  return asked;
}

describe("mail provider detection", () => {
  it("knows the big providers by their domain without a lookup", async () => {
    const asked = mockMx({});
    expect(await detectProvider("a@gmail.com")).toBe("gmail");
    expect(await detectProvider("a@hotmail.co.uk")).toBe("outlook");
    expect(await detectProvider("a@yahoo.com.mx")).toBe("yahoo");
    expect(await detectProvider("a@me.com")).toBe("icloud");
    expect(await detectProvider("a@pm.me")).toBe("proton");
    expect(asked).toEqual([]);
  });

  it("looks up the mail servers of custom domains", async () => {
    mockMx({
      "work.example": ["1 aspmx.l.google.com."],
      "corp.example": ["0 corp-example.mail.protection.outlook.com."],
      "live.example.org": ["10 route1.mx.cloudflare.net."],
    });
    expect(await detectProvider("a@work.example")).toBe("gmail");
    expect(await detectProvider("a@corp.example")).toBe("office365");
    expect(await detectProvider("a@live.example.org")).toBeNull();
    expect(await detectProvider("a@nothing.example")).toBeNull();
  });
});
