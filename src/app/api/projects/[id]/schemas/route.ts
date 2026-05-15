import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";

const AssignBody = z.object({ schemaId: z.string() });

export const POST = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = AssignBody.safeParse(body);
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    const assignment = await prisma.schemaProject.upsert({
      where: {
        schemaId_projectId: { schemaId: parsed.data.schemaId, projectId: id },
      },
      create: { schemaId: parsed.data.schemaId, projectId: id },
      update: {},
    });

    return NextResponse.json(assignment, { status: 201 });
  }
);

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const schemaId = searchParams.get("schemaId");
    if (!schemaId) return apiBadRequest("schemaId required");

    await prisma.schemaProject.delete({
      where: { schemaId_projectId: { schemaId, projectId: id } },
    });

    return new NextResponse(null, { status: 204 });
  }
);
