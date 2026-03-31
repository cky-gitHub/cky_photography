import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceDir = path.join(root, "Photos");
const publicDir = path.join(root, "public", "photos");
const smallDir = path.join(publicDir, "small");
const largeDir = path.join(publicDir, "large");
const manifestFile = path.join(root, "src", "generated", "photos.js");

const smallMaxEdge = 1600;
const largeMaxEdge = 2600;
const jpegQuality = 84;

function toSlug(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toLabel(index, orientation) {
  return `Frame ${String(index + 1).padStart(2, "0")} - ${orientation === "landscape" ? "Horizon" : "Portrait"}`;
}

function parseMonthParts(fileName) {
  const match = fileName.match(/(20\d{2})(\d{2})(\d{2})/);
  if (!match) {
    return {
      monthId: "unknown",
      monthLabel: "Unknown Month",
    };
  }

  const [, year, month] = match;
  const date = new Date(`${year}-${month}-01T00:00:00`);
  return {
    monthId: `${year}-${month}`,
    monthLabel: new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(date),
  };
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function prepare() {
  await ensureDir(smallDir);
  await ensureDir(largeDir);
  await ensureDir(path.dirname(manifestFile));

  const files = (await fs.readdir(sourceDir))
    .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
    .sort((left, right) => left.localeCompare(right));

  const manifest = [];

  for (const [index, file] of files.entries()) {
    const absolutePath = path.join(sourceDir, file);
    const slug = toSlug(file);
    const metadata = await sharp(absolutePath).metadata();
    const orientation = metadata.width >= metadata.height ? "landscape" : "portrait";
    const smallName = `${slug}.jpg`;
    const largeName = `${slug}-large.jpg`;
    const monthParts = parseMonthParts(file);

    await sharp(absolutePath)
      .rotate()
      .resize({ width: smallMaxEdge, height: smallMaxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toFile(path.join(smallDir, smallName));

    await sharp(absolutePath)
      .rotate()
      .resize({ width: largeMaxEdge, height: largeMaxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toFile(path.join(largeDir, largeName));

    manifest.push({
      id: slug,
      order: index,
      src: `/photos/small/${smallName}`,
      srcLarge: `/photos/large/${largeName}`,
      width: metadata.width,
      height: metadata.height,
      aspect: Number((metadata.width / metadata.height).toFixed(4)),
      orientation,
      monthId: monthParts.monthId,
      monthLabel: monthParts.monthLabel,
      alt: `Photograph ${String(index + 1).padStart(2, "0")}, ${orientation} composition from the Project Photography collection.`,
      label: toLabel(index, orientation),
    });
  }

  const contents = `/** @typedef {{ id: string, order: number, src: string, srcLarge: string, width: number, height: number, aspect: number, orientation: "portrait" | "landscape", monthId: string, monthLabel: string, alt: string, label: string }} PhotoAsset */\n\n/** @type {PhotoAsset[]} */\nexport const photoManifest = ${JSON.stringify(manifest, null, 2)};\n`;
  await fs.writeFile(manifestFile, contents, "utf8");

  console.log(`Prepared ${manifest.length} photos into public/photos and updated src/generated/photos.js`);
}

prepare().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
