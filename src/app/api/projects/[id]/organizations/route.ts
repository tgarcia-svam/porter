import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";

export const GET = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const assignments = await prisma.projectOrganization.findMany({
      where: { projectId: id },
      include: { organization: true },
    });

    return NextResponse.json(assignments.map((a) => a.organization));
  }
);

const AssignBody = z.object({ organizationId: z.string() });

export const POST = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = AssignBody.safeParse(body);
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    const assignment = await prisma.projectOrganization.upsert({
      where: {
        projectId_organizationId: {
          projectId: id,
          organizationId: parsed.data.organizationId,
        },
      },
      create: { projectId: id, organizationId: parsed.data.organizationId },
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
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) return apiBadRequest("organizationId required");

    await prisma.projectOrganization.delete({
      where: {
        projectId_organizationId: { projectId: id, organizationId },
      },
    });

    return new NextResponse(null, { status: 204 });
  }
);
