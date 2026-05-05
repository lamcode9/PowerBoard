import { describe, expect, it } from "vitest";
import { screenToWorld, zoomCameraAroundPoint, type Camera, type ViewportPoint } from "./canvasCamera";

function expectPointClose(actual: ViewportPoint, expected: ViewportPoint) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe("canvas camera", () => {
  it("keeps the world point under the cursor invariant while zooming", () => {
    const camera: Camera = { x: -17180, y: -11420, zoom: 0.72 };
    const cursor = { x: 640, y: 420 };
    const worldBefore = screenToWorld(cursor, camera);

    const next = zoomCameraAroundPoint(camera, 1.18, cursor, 0.25, 2);
    const worldAfter = screenToWorld(cursor, next);

    expectPointClose(worldAfter, worldBefore);
  });

  it("uses the clamped zoom level in the same invariant math", () => {
    const camera: Camera = { x: 12, y: -88, zoom: 1 };
    const cursor = { x: 240, y: 160 };
    const worldBefore = screenToWorld(cursor, camera);

    const next = zoomCameraAroundPoint(camera, 9, cursor, 0.25, 2);
    const worldAfter = screenToWorld(cursor, next);

    expect(next.zoom).toBe(2);
    expectPointClose(worldAfter, worldBefore);
  });
});
