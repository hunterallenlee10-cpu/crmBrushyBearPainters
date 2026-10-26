import { describe, expect, it } from "vitest";
import {
  CONTACT_METHOD_MESSAGE,
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  addPhotos,
  fieldForDbMessage,
  homeBuiltFromYear,
  needsLeadSafe,
  photoContentType,
  resolveHomeBuilt,
  stepForField,
  wizardStep1Schema,
  wizardStep3Schema,
} from "./helpers";

const SUBS = [
  { value: "organic", parent: "website", active: true },
  { value: "google_ads", parent: "website", active: true },
  { value: "old_thing", parent: "website", active: false },
  { value: "general", parent: null, active: true },
];

describe("step 1 schema", () => {
  it("requires one contact method, even while names are missing", () => {
    const r = wizardStep1Schema.safeParse({ first_name: "", last_name: "" });
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
    expect(messages).toContain(`mobile:${CONTACT_METHOD_MESSAGE}`);
    expect(messages).toContain("first_name:First name is required.");
  });

  it("accepts a name plus just an email, normalizing it", () => {
    const r = wizardStep1Schema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      email: " Jane@Example.com ",
    });
    expect(r.success && r.data.email).toBe("jane@example.com");
  });

  it("reports a bad email without the contact-method message", () => {
    const r = wizardStep1Schema.safeParse({ first_name: "J", last_name: "S", email: "nope" });
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toEqual(["That email doesn't look right."]);
  });
});

describe("step 3 sub-source rule", () => {
  it("step 3 schema adds the sub-source issue to the full lead check", () => {
    const base = { first_name: "Jane", last_name: "Smith", mobile: "425-555-0100" };
    const schema = wizardStep3Schema(SUBS);
    const missing = schema.safeParse({ ...base, lead_source: "website" });
    expect(missing.success).toBe(false);
    expect(missing.success ? [] : missing.error.issues.map((i) => i.path.join("."))).toEqual([
      "lead_sub_source",
    ]);
    expect(
      schema.safeParse({ ...base, lead_source: "website", lead_sub_source: "organic" }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...base, lead_source: "yelp" }).success).toBe(true);
  });
});

describe("home built", () => {
  it("derives from the year", () => {
    expect(homeBuiltFromYear(1962)).toBe("before_1978");
    expect(homeBuiltFromYear("1977")).toBe("before_1978");
    expect(homeBuiltFromYear("1978")).toBe("1978_or_later");
    expect(homeBuiltFromYear("")).toBeNull();
    expect(homeBuiltFromYear("19")).toBeNull();
    expect(homeBuiltFromYear(null)).toBeNull();
  });

  it("keeps an explicit choice over the year", () => {
    expect(resolveHomeBuilt(2001, "not_sure")).toBe("not_sure");
    expect(resolveHomeBuilt(1950, null)).toBe("before_1978");
    expect(resolveHomeBuilt(null, null)).toBeNull();
  });

  it("flags lead-safe prep for before 1978 and not sure", () => {
    expect(needsLeadSafe("before_1978")).toBe(true);
    expect(needsLeadSafe("not_sure")).toBe(true);
    expect(needsLeadSafe("1978_or_later")).toBe(false);
    expect(needsLeadSafe(null)).toBe(false);
  });
});

describe("error routing", () => {
  it("knows which step shows a field", () => {
    expect(stepForField("mobile")).toBe(1);
    expect(stepForField("zip")).toBe(2);
    expect(stepForField("lead_source")).toBe(3);
    expect(stepForField("services.0")).toBe(3);
  });

  it("maps database guard messages to fields", () => {
    expect(fieldForDbMessage('Lead source "x" is not one of the choices in Field Picklists.')).toBe(
      "lead_source",
    );
    expect(fieldForDbMessage('Sub-source "x" is not one of the choices in Field Picklists.')).toBe(
      "lead_sub_source",
    );
    expect(
      fieldForDbMessage("Only people who can assign leads can create a lead for someone else."),
    ).toBe("owner_id");
    expect(fieldForDbMessage("Owner does not belong to this organization.")).toBe("owner_id");
    expect(fieldForDbMessage("Something went wrong.")).toBeNull();
  });
});

describe("photos", () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it("detects the content type, falling back to the extension", () => {
    expect(photoContentType(file("a.jpg", "image/jpeg"))).toBe("image/jpeg");
    expect(photoContentType(file("a.jpg", "image/jpg"))).toBe("image/jpeg");
    expect(photoContentType(file("IMG_1.HEIC", ""))).toBe("image/heic");
    expect(photoContentType(file("plan.pdf", "application/pdf"))).toBe("application/pdf");
    expect(photoContentType(file("notes.docx", "application/msword"))).toBeNull();
  });

  it("keeps at most 10 and refuses wrong types, big or empty files", () => {
    const eleven = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => file(`p${i}.png`, "image/png"));
    const r = addPhotos(
      [],
      [
        ...eleven,
        file("big.jpg", "image/jpeg", MAX_PHOTO_BYTES + 1),
        file("x.txt", "text/plain"),
        file("empty.png", "image/png", 0),
      ],
    );
    expect(r.files).toHaveLength(MAX_PHOTOS);
    expect(r.problems).toEqual([
      "p10.png: up to 10 files per lead.",
      "big.jpg: bigger than 15 MB.",
      "x.txt: only photos (JPG, PNG, WebP, HEIC) or PDFs.",
      "empty.png: the file is empty.",
    ]);
  });
});
