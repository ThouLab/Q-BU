import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_PATHS = new Set(["/", "/favicon.ico", "/robots.txt", "/sitemap.xml"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (ALLOWED_PATHS.has(pathname) || pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex"
    }
  });
}

export const config = {
  matcher: "/:path*"
};
