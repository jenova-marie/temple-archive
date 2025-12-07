import { describe, it, expect } from "vitest";
import { PIIDetector, type PIIMatch } from "../../src/detectors/PIIDetector.js";

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: "span-123",
  traceId: "trace-123",
});

describe("PIIDetector", () => {
  const detector = new PIIDetector();

  describe("SSN detection", () => {
    it("should detect SSN with dashes", () => {
      const matches = detector.detect("My SSN is 123-45-6789");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("ssn");
      expect(matches[0].value).toBe("123-45-6789");
    });

    it("should detect SSN with spaces", () => {
      const matches = detector.detect("SSN: 123 45 6789");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("ssn");
    });

    it("should detect SSN without separators", () => {
      const matches = detector.detect("SSN is 123456789");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("ssn");
    });

    it("should reject invalid SSN starting with 000", () => {
      const matches = detector.detect("SSN: 000-12-3456");
      expect(matches).toHaveLength(0);
    });

    it("should reject invalid SSN starting with 666", () => {
      const matches = detector.detect("SSN: 666-12-3456");
      expect(matches).toHaveLength(0);
    });

    it("should reject invalid SSN starting with 900+", () => {
      const matches = detector.detect("SSN: 900-12-3456");
      expect(matches).toHaveLength(0);
    });

    it("should reject SSN with 00 group", () => {
      const matches = detector.detect("SSN: 123-00-4567");
      expect(matches).toHaveLength(0);
    });

    it("should reject SSN with 0000 serial", () => {
      const matches = detector.detect("SSN: 123-45-0000");
      expect(matches).toHaveLength(0);
    });
  });

  describe("phone detection", () => {
    it("should detect phone with dashes", () => {
      const matches = detector.detect("Call me at 555-123-4567");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
      expect(matches[0].value).toBe("555-123-4567");
    });

    it("should detect phone with parentheses", () => {
      const matches = detector.detect("Phone: (555) 123-4567");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("should detect phone with dots", () => {
      const matches = detector.detect("Number: 555.123.4567");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("should detect phone with country code", () => {
      const matches = detector.detect("International: +1-555-123-4567");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("should detect 10-digit phone without formatting", () => {
      const matches = detector.detect("Phone 5551234567");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });
  });

  describe("email detection", () => {
    it("should detect standard email", () => {
      const matches = detector.detect("Email me at john.doe@example.com");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("email");
      expect(matches[0].value).toBe("john.doe@example.com");
    });

    it("should detect email with plus sign", () => {
      const matches = detector.detect("Contact: user+tag@gmail.com");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("email");
    });

    it("should detect email with subdomain", () => {
      const matches = detector.detect("Email: admin@mail.company.org");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("email");
    });

    it("should have high confidence for emails", () => {
      const matches = detector.detect("test@example.com");
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("credit card detection", () => {
    it("should detect valid credit card with spaces", () => {
      // Valid Luhn: 4111 1111 1111 1111
      const matches = detector.detect("Card: 4111 1111 1111 1111");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("credit_card");
    });

    it("should detect valid credit card with dashes", () => {
      const matches = detector.detect("Card: 4111-1111-1111-1111");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("credit_card");
    });

    it("should reject invalid credit card (bad Luhn)", () => {
      const matches = detector.detect("Card: 1234 5678 9012 3456");
      expect(matches).toHaveLength(0);
    });

    it("should detect valid 15-digit Amex", () => {
      // Valid Amex: 378282246310005 (Luhn valid)
      // The regex expects groups of 4 digits, so we use standard formatting
      const matches = detector.detect("Amex: 3782-8224-6310-005");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("credit_card");
    });
  });

  describe("bank account detection", () => {
    it("should detect account number with keyword", () => {
      const matches = detector.detect("Account: 12345678901");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("bank_account");
    });

    it("should detect checking account", () => {
      const matches = detector.detect("My checking 9876543210");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("bank_account");
    });

    it("should detect savings account", () => {
      const matches = detector.detect("Savings #12345678901234");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("bank_account");
    });

    it("should not detect random numbers without context", () => {
      const matches = detector.detect("The number is 12345678901");
      // No bank_account match because no keyword context
      const bankMatches = matches.filter((m) => m.type === "bank_account");
      expect(bankMatches).toHaveLength(0);
    });
  });

  describe("routing number detection", () => {
    it("should detect routing number with keyword", () => {
      // Valid routing: 021000021 (Chase)
      const matches = detector.detect("Routing: 021000021");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("routing_number");
    });

    it("should detect ABA number", () => {
      const matches = detector.detect("ABA# 021000021");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("routing_number");
    });

    it("should reject invalid routing checksum", () => {
      const matches = detector.detect("Routing: 123456789");
      // Invalid checksum - but this number may also match SSN pattern
      // Filter to routing_number type only
      const routingMatches = matches.filter((m) => m.type === "routing_number");
      expect(routingMatches).toHaveLength(0);
    });
  });

  describe("medical identifier detection", () => {
    it("should detect NPI with keyword", () => {
      // Valid NPI: 1234567893 (passes Luhn with 80840 prefix)
      const matches = detector.detect("NPI: 1234567893");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("npi");
    });

    it("should detect provider ID", () => {
      const matches = detector.detect("Provider# 1234567893");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("npi");
    });

    it("should detect DEA number", () => {
      const matches = detector.detect("DEA: AB1234567");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("dea");
    });

    it("should detect MRN with keyword", () => {
      const matches = detector.detect("MRN: 12345678");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("mrn");
    });

    it("should detect medical record number", () => {
      const matches = detector.detect("Medical record #ABC123456");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("mrn");
    });
  });

  describe("address detection", () => {
    it("should detect street address", () => {
      const matches = detector.detect("I live at 123 Main Street");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("address");
    });

    it("should detect avenue address", () => {
      const matches = detector.detect("Office: 456 Park Avenue");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("address");
    });

    it("should detect abbreviated street types", () => {
      const matches = detector.detect("Send to 789 Oak Dr");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("address");
    });

    it("should detect multi-word street names", () => {
      const matches = detector.detect("Location: 100 North First Street");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("address");
    });
  });

  describe("redaction", () => {
    it("should redact single PII", () => {
      const text = "My SSN is 123-45-6789";
      const matches = detector.detect(text);
      const redacted = detector.redact(text, matches);
      expect(redacted).toBe("My SSN is [SSN REDACTED]");
      expect(redacted).not.toContain("123-45-6789");
    });

    it("should redact multiple PII of same type", () => {
      const text = "Call 555-123-4567 or 555-987-6543";
      const matches = detector.detect(text);
      const redacted = detector.redact(text, matches);
      expect(redacted).toBe("Call [PHONE REDACTED] or [PHONE REDACTED]");
    });

    it("should redact multiple PII of different types", () => {
      const text = "SSN 123-45-6789, email test@example.com";
      const matches = detector.detect(text);
      const redacted = detector.redact(text, matches);
      expect(redacted).toContain("[SSN REDACTED]");
      expect(redacted).toContain("[EMAIL REDACTED]");
      expect(redacted).not.toContain("123-45-6789");
      expect(redacted).not.toContain("test@example.com");
    });

    it("should handle empty matches", () => {
      const text = "No PII here";
      const matches = detector.detect(text);
      const redacted = detector.redact(text, matches);
      expect(redacted).toBe("No PII here");
    });

    it("should preserve surrounding text", () => {
      const text = "Before 123-45-6789 after";
      const matches = detector.detect(text);
      const redacted = detector.redact(text, matches);
      expect(redacted).toBe("Before [SSN REDACTED] after");
    });
  });

  describe("detectViolations", () => {
    it("should return SafetyViolation format", async () => {
      const ctx = createTraceContext();
      const violations = await detector.detectViolations(
        "SSN: 123-45-6789",
        ctx,
      );

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        type: "pii",
        severity: "critical",
        position: expect.any(Object),
      });
      expect(violations[0].description).toContain("SSN");
    });

    it("should return empty for no PII", async () => {
      const ctx = createTraceContext();
      const violations = await detector.detectViolations("Hello world", ctx);
      expect(violations).toHaveLength(0);
    });
  });

  describe("overlapping matches", () => {
    it("should deduplicate overlapping matches", () => {
      // This could match both SSN and phone patterns
      const text = "Number: 123-45-6789";
      const matches = detector.detect(text);
      // Should only have one match (higher confidence wins)
      expect(matches.length).toBeLessThanOrEqual(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const matches = detector.detect("");
      expect(matches).toHaveLength(0);
    });

    it("should handle string with no PII", () => {
      const matches = detector.detect(
        "Just some regular text without any personal information",
      );
      expect(matches).toHaveLength(0);
    });

    it("should handle multiple PII in paragraph", () => {
      const text = `
        Patient John Doe
        SSN: 123-45-6789
        Phone: 555-123-4567
        Email: john@example.com
        Address: 123 Main Street
      `;
      const matches = detector.detect(text);
      expect(matches.length).toBeGreaterThanOrEqual(4);

      const types = matches.map((m) => m.type);
      expect(types).toContain("ssn");
      expect(types).toContain("phone");
      expect(types).toContain("email");
      expect(types).toContain("address");
    });
  });
});
