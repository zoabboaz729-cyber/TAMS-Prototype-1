import { describe, it, expect } from "vitest";
import { isSameOriginRequest } from "../origin";

describe("isSameOriginRequest", () => {
  it("accepts same origin with port", () => {
    expect(
      isSameOriginRequest({
        origin: "http://localhost:3000",
        host: "localhost:3000",
        secFetchSite: null,
      }),
    ).toBe(true);
  });

  it("accepts a LAN address origin matching the host", () => {
    expect(
      isSameOriginRequest({
        origin: "http://192.168.0.102:3000",
        host: "192.168.0.102:3000",
        secFetchSite: null,
      }),
    ).toBe(true);
  });

  it("rejects a different host", () => {
    expect(
      isSameOriginRequest({
        origin: "http://evil.example.com",
        host: "localhost:3000",
        secFetchSite: null,
      }),
    ).toBe(false);
  });

  it("rejects same host but different port", () => {
    expect(
      isSameOriginRequest({
        origin: "http://localhost:8080",
        host: "localhost:3000",
        secFetchSite: null,
      }),
    ).toBe(false);
  });

  it('rejects the literal string "null" as origin', () => {
    expect(
      isSameOriginRequest({
        origin: "null",
        host: "localhost:3000",
        secFetchSite: null,
      }),
    ).toBe(false);
  });

  it("rejects a garbage origin", () => {
    expect(
      isSameOriginRequest({
        origin: ":::not-a-url:::",
        host: "localhost:3000",
        secFetchSite: null,
      }),
    ).toBe(false);
  });

  it("rejects a present origin with a null host", () => {
    expect(
      isSameOriginRequest({
        origin: "http://localhost:3000",
        host: null,
        secFetchSite: "same-origin",
      }),
    ).toBe(false);
  });

  it("accepts no origin with sec-fetch-site same-origin", () => {
    expect(
      isSameOriginRequest({
        origin: null,
        host: "localhost:3000",
        secFetchSite: "same-origin",
      }),
    ).toBe(true);
  });

  it("accepts no origin with sec-fetch-site none", () => {
    expect(
      isSameOriginRequest({
        origin: null,
        host: "localhost:3000",
        secFetchSite: "none",
      }),
    ).toBe(true);
  });

  it("rejects no origin with sec-fetch-site cross-site", () => {
    expect(
      isSameOriginRequest({
        origin: null,
        host: "localhost:3000",
        secFetchSite: "cross-site",
      }),
    ).toBe(false);
  });

  it("rejects no origin with sec-fetch-site same-site", () => {
    expect(
      isSameOriginRequest({
        origin: null,
        host: "localhost:3000",
        secFetchSite: "same-site",
      }),
    ).toBe(false);
  });

  it("rejects no origin with null sec-fetch-site", () => {
    expect(
      isSameOriginRequest({
        origin: null,
        host: "localhost:3000",
        secFetchSite: null,
      }),
    ).toBe(false);
  });
});