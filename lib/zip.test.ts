import { describe, expect, it } from "vitest";
import { buildZip, crc32, uniqueNames } from "./zip";

describe("zip", () => {
  it("computes CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes stored entries a reader can walk", () => {
    const a = new TextEncoder().encode("hello");
    const zip = buildZip([
      { name: "a.txt", data: a, date: new Date(2026, 9, 27, 12, 30, 10) },
      { name: "b.txt", data: new Uint8Array([1, 2, 3]) },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(crc32(a));
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe("a.txt");
    expect(new TextDecoder().decode(zip.slice(35, 40))).toBe("hello");
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const centralStart = v.getUint32(end + 16, true);
    expect(v.getUint32(centralStart, true)).toBe(0x02014b50);
    expect(buildZip([]).length).toBe(22);
  });

  it("keeps names unique and safe", () => {
    expect(uniqueNames(["before.jpg", "Before.jpg", "a/b.jpg", "", "x"])).toEqual([
      "before.jpg",
      "Before-2.jpg",
      "a-b.jpg",
      "file",
      "x",
    ]);
  });
});
