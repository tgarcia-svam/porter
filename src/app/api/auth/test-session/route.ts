import { NextRequest, NextResponse } from "next/server";
import { encode } from "@auth/core/jwt";
import { prisma } from "@/lib/prisma";

const TEST_SECRET = process.env.PLAYWRIGHT_TEST_SECRET;
const COOKIE_NAME = "authjs.session-token";

export async function POST(req: NextRequest) {
  if (!TEST_SECRET || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const body = await req.json();
  const { secret, email, role } = body as { secret: string; email: string; role?: string };

  if (secret !== TEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedRole = (role ?? "ADMIN") as "ADMIN" | "UPLOADER";

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, role: resolvedRole, name: "Playwright Test" },
    });
  } else if (user.role !== resolvedRole) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: resolvedRole },
    });
  }

  const token = await encode({
    token: {
      sub: user.id,
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      uaHash: null, // no session binding — tests run without UA constraint
    },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: 60 * 60,
    salt: COOKIE_NAME,
  });

  const response = NextResponse.json({ ok: true, userId: user.id });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return response;
}
