import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

async function readImagePaths(relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(process.cwd(), "public", relativeDir);

  try {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => `/${relativeDir}/${name}`);
  } catch {
    return [];
  }
}

export async function GET() {
  const [full, face] = await Promise.all([
    readImagePaths("images/laki/full"),
    readImagePaths("images/laki/face"),
  ]);

  return NextResponse.json({
    full,
    face,
  });
}
