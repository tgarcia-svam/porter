import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  const upload = await prisma.fileUpload.findFirst({
    where: { userId: session.user.id, schemaId, blobUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  if (!upload?.blobUrl) {
    return NextResponse.json({ rows: [] });
  }

  try {
    const blobRes = await fetch(upload.blobUrl);
    if (!blobRes.ok) return NextResponse.json({ rows: [] });

    const buffer = Buffer.from(await blobRes.arrayBuffer());
    const isExcel = /\.(xlsx|xls)$/i.test(upload.fileName);

    let rows: Record<string, string>[];

    if (isExcel) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils
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
      rows = result.data;
    }

    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json({ rows: [] });
  }
}
