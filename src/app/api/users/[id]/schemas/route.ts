import { NextResponse } from "next/server";

const gone = () =>
  NextResponse.json(
    { error: "Schema access is now managed via Projects. Assign schemas to projects and users to organizations." },
    { status: 410 }
  );

export const GET = gone;
export const POST = gone;
export const DELETE = gone;
