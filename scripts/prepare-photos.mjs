import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceDir = path.join(root, "Photos");
const publicDir = path.join(root, "public", "photos");
const thumbDir = path.join(publicDir, "thumb");
const smallDir = path.join(publicDir, "small");
const largeDir = path.join(publicDir, "large");
const manifestFile = path.join(root, "src", "generated", "photos.js");

// thumb feeds the grid, small the ring textures, large the viewer and downloads.
const sizes = [
  { dir: thumbDir, suffix: "", maxEdge: 900, quality: 80, key: "thumb" },
  { dir: smallDir, suffix: "", maxEdge: 1600, quality: 84, key: "src" },
  { dir: largeDir, suffix: "-large", maxEdge: 2600, quality: 86, key: "srcLarge" },
];
const supportedImagePattern = /\.(jpe?g|png|webp)$/i;

/** The ring's curated set. Its files are copies of country photos, not a country. */
const RING_ALBUM_ID = "best";

/**
 * Folder name -> country. Folder names are typed by hand, so this is where
 * spelling gets fixed and where the ISO code the world map will need lives.
 * A folder missing here still works; it just shows its own name and no code.
 */
const COUNTRIES = {
  netherlands: { name: "Netherlands", iso: "NL" },
  kazakhstan: { name: "Kazakhstan", iso: "KZ" },
  germany: { name: "Germany", iso: "DE" },
  switzerland: { name: "Switzerland", iso: "CH" },
  morocco: { name: "Morocco", iso: "MA" },
  morrocco: { name: "Morocco", iso: "MA" },
};

function toSlug(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isCoverFile(fileName) {
  return path.basename(fileName, path.extname(fileName)).toLowerCase() === "cover";
}

function toTitleCase(value) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function toAlbumLabel(folderName) {
  const cleaned = folderName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned ? toTitleCase(cleaned) : "Untitled Album";
}

function parseCapturedDate(fileName) {
  const match = fileName.match(/(20\d{2})(\d{2})(\d{2})(?:[^\d]?(\d{2})(\d{2})(\d{2}))?/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours = "00", minutes = "00", seconds = "00"] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

async function collectSourcePhotos() {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const sources = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const albumDir = path.join(sourceDir, entry.name);
      const albumEntries = await fs.readdir(albumDir, { withFileTypes: true });
      const albumId = toSlug(entry.name) || "album";
      const country = COUNTRIES[albumId] ?? null;

      for (const albumEntry of albumEntries) {
        if (!albumEntry.isFile() || !supportedImagePattern.test(albumEntry.name)) {
          continue;
        }

        sources.push({
          file: albumEntry.name,
          absolutePath: path.join(albumDir, albumEntry.name),
          albumId,
          albumLabel: country?.name ?? toAlbumLabel(entry.name),
          countryCode: country?.iso ?? null,
        });
      }

      continue;
    }

    if (!entry.isFile() || !supportedImagePattern.test(entry.name)) {
      continue;
    }

    sources.push({
      file: entry.name,
      absolutePath: path.join(sourceDir, entry.name),
      albumId: "unsorted",
      albumLabel: "Unsorted",
      countryCode: null,
    });
  }

  return sources;
}

/** Re-encoding 60+ photos three times is slow; only redo what changed. */
async function isFresh(target, sourceMtimeMs) {
  try {
    const stat = await fs.stat(target);
    return stat.mtimeMs >= sourceMtimeMs;
  } catch {
    return false;
  }
}

async function prepare() {
  for (const size of sizes) {
    await fs.mkdir(size.dir, { recursive: true });
  }
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });

  const sourcePhotos = await collectSourcePhotos();
  const preparedPhotos = [];
  const written = new Set();

  for (const sourcePhoto of sourcePhotos) {
    const { file, absolutePath, albumId, albumLabel, countryCode } = sourcePhoto;
    const buffer = await fs.readFile(absolutePath);
    const stats = await fs.stat(absolutePath);
    const capturedDate = parseCapturedDate(file) ?? stats.mtime;
    const slug = `${albumId}-${toSlug(file)}`;

    // Dimensions after EXIF rotation - the raw metadata reports the sensor's
    // orientation, which turns a portrait phone shot into a landscape box.
    const metadata = await sharp(buffer).metadata();
    const rotated = (metadata.orientation ?? 1) >= 5;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;

    const paths = {};
    for (const size of sizes) {
      const name = `${slug}${size.suffix}.jpg`;
      const target = path.join(size.dir, name);
      written.add(target);
      paths[size.key] = `photos/${path.basename(size.dir)}/${name}`;
      if (await isFresh(target, stats.mtimeMs)) {
        continue;
      }
      await sharp(buffer)
        .rotate()
        .resize({ width: size.maxEdge, height: size.maxEdge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: size.quality, mozjpeg: true })
        .toFile(target);
    }

    preparedPhotos.push({
      id: slug,
      file,
      hash: createHash("sha1").update(buffer).digest("hex"),
      capturedAt: capturedDate.toISOString(),
      capturedTimestamp: capturedDate.getTime(),
      ...paths,
      width,
      height,
      aspect: Number((width / height).toFixed(4)),
      orientation: width >= height ? "landscape" : "portrait",
      albumId,
      albumLabel,
      countryCode,
      isCover: isCoverFile(file),
    });
  }

  // A ring photo is a copy of a country photo; point it at the original so the
  // viewer can say where it was taken, and so likes are shared between the two.
  const byHash = new Map(
    preparedPhotos.filter((photo) => photo.albumId !== RING_ALBUM_ID).map((photo) => [photo.hash, photo]),
  );
  for (const photo of preparedPhotos) {
    if (photo.albumId !== RING_ALBUM_ID) {
      continue;
    }
    const original = byHash.get(photo.hash);
    photo.originalId = original?.id ?? null;
    photo.countryLabel = original?.albumLabel ?? null;
    photo.countryCode = original?.countryCode ?? null;
  }

  preparedPhotos.sort(
    (left, right) => right.capturedTimestamp - left.capturedTimestamp || left.file.localeCompare(right.file),
  );

  const manifest = preparedPhotos.map(({ file, hash, capturedTimestamp, countryLabel, ...photo }, index) => {
    const country = photo.albumId === RING_ALBUM_ID ? countryLabel : photo.albumLabel;
    return {
      ...photo,
      country: country ?? null,
      order: index,
      alt: country ? `Photograph taken in ${country}` : "Photograph",
    };
  });

  // Outputs of photos that were removed or renamed since the last run.
  let removed = 0;
  for (const size of sizes) {
    for (const name of await fs.readdir(size.dir)) {
      const target = path.join(size.dir, name);
      if (!written.has(target)) {
        await fs.rm(target);
        removed += 1;
      }
    }
  }

  const contents = `/** @typedef {{ id: string, order: number, capturedAt: string, thumb: string, src: string, srcLarge: string, width: number, height: number, aspect: number, orientation: "portrait" | "landscape", albumId: string, albumLabel: string, country: string | null, countryCode: string | null, originalId?: string | null, isCover: boolean, alt: string }} PhotoAsset */\n\n/** @type {PhotoAsset[]} */\nexport const photoManifest = ${JSON.stringify(manifest, null, 2)};\n`;
  await fs.writeFile(manifestFile, contents, "utf8");

  console.log(
    `Prepared ${manifest.length} photos into public/photos${removed ? ` (${removed} stale files removed)` : ""} and updated src/generated/photos.js`,
  );
}

prepare().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
