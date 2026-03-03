import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { downloadFromBlob } from "@/lib/azure-storage";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schemaId = req.nextUrl.searchParams.get("schemaId");
  if (!schemaId) {
    return NextResponse.json({ error: "schemaId is required" }, { status: 400 });
  }

  // Find the current user's organizationId
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    return NextResponse.json({ rows: [] });
  }

  // Fetch schema columns so we can normalize row keys to their exact names
  const schema = await prisma.schema.findUnique({
    where: { id: schemaId },
    select: { columns: { select: { name: true }, orderBy: { order: "asc" } } },
  });

  if (!schema) {
    return NextResponse.json({ rows: [] });
  }

  // Latest *valid* upload by anyone in the same org for this schema
  const upload = await prisma.fileUpload.findFirst({
    where: {
      schemaId,
      status: "VALID",
      blobUrl: { not: null },
      user: { organizationId: currentUser.organizationId },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!upload?.blobUrl) {
    return NextResponse.json({ rows: [] });
  }

  try {
    const buffer = await downloadFromBlob(upload.blobUrl);
    const isExcel = /\.(xlsx|xls)$/i.test(upload.fileName);

    let rawRows: Record<string, string>[];

    if (isExcel) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = XLSX.utils
        .sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [k.trim(), String(v).trim()])
          )
        );
    } else {
      const text = buffer.toString("utf-8");
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
        transform: (v) => v.trim(),
      });
      rawRows = result.data;
    }

    // Normalize each row's keys to match the schema column names exactly
    // (case-insensitive lookup so uploaded files with any casing work correctly)
    const rows = rawRows.map((raw) => {
      const byLower = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v])
      );
      return Object.fromEntries(
        schema.columns.map((col) => [col.name, byLower[col.name.toLowerCase()] ?? ""])
      );
    });

    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json({ rows: [] });
  }
}
