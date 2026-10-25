import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditActorAvatar, AuditActorName } from "~/admin/components/AuditActor";

const ada = { name: "Ada Lovelace", photoUrl: "https://s3.example/signed" };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("AuditActorAvatar", () => {
  it("shows the actor's photo when they have one", () => {
    const out = html(createElement(AuditActorAvatar, { actor: ada, actorId: "u1" }));
    expect(out).toContain('src="https://s3.example/signed"');
    expect(out).toContain('alt="Ada Lovelace"');
  });

  it("shows initials when the actor has no photo", () => {
    const out = html(createElement(AuditActorAvatar, { actor: { ...ada, photoUrl: null }, actorId: "u1" }));
    expect(out).not.toContain("<img");
    expect(out).toContain(">AL<");
  });

  it("shows ? for an actor whose user row is gone", () => {
    const out = html(createElement(AuditActorAvatar, { actor: null, actorId: "deadbeef-1234" }));
    expect(out).toContain('aria-label="?"');
  });

  it("shows System when there is no actor at all", () => {
    const out = html(createElement(AuditActorAvatar, { actor: null, actorId: null }));
    expect(out).toContain('aria-label="System"');
  });

  it("never shrinks in a flex row", () => {
    expect(html(createElement(AuditActorAvatar, { actor: ada, actorId: "u1" }))).toContain("shrink-0");
    expect(html(createElement(AuditActorAvatar, { actor: null, actorId: null }))).toContain("shrink-0");
  });
});

describe("AuditActorName", () => {
  it("shows the actor's name", () => {
    expect(html(createElement(AuditActorName, { actor: ada, actorId: "u1" }))).toContain("Ada Lovelace");
  });

  it("shows a dash for an actor with no name or email", () => {
    expect(html(createElement(AuditActorName, { actor: { name: null, photoUrl: null }, actorId: "u1" }))).toContain("—");
  });

  it("shows a short id for an actor whose user row is gone", () => {
    const out = html(createElement(AuditActorName, { actor: null, actorId: "deadbeef-1234" }));
    expect(out).toContain("deadbeef…");
    expect(out).not.toContain("1234");
  });

  it("shows system when there is no actor at all", () => {
    expect(html(createElement(AuditActorName, { actor: null, actorId: null }))).toContain(">system<");
  });
});
