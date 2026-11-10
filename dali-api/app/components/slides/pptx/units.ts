import { STAGE_W } from "~/components/slides/deck/layouts";

export const SLIDE_WIDTH_EMU = 12192000;
export const EMU_PER_UNIT = SLIDE_WIDTH_EMU / STAGE_W;
export const EMU_PER_INCH = 914400;
export const EMU_PER_POINT = 12700;

export const unitsToEmu = (units: number): number => Math.round(units * EMU_PER_UNIT);
export const unitsToInches = (units: number): number => (units * EMU_PER_UNIT) / EMU_PER_INCH;
export const unitsToPoints = (units: number): number => (units * EMU_PER_UNIT) / EMU_PER_POINT;
export const pointsToUnits = (points: number): number => (points * EMU_PER_POINT) / EMU_PER_UNIT;
