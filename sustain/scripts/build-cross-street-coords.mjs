/**
 * Regenerates public/data/cross_street_coords.json from the Efficiency Navigator workbook.
 * Run from repo: node scripts/build-cross-street-coords.mjs
 */
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    geocodeCrossStreetIntersection,
    sleep,
} from "../src/lib/madisonGeocode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const TARGET_SHEETS = [
    "OEI by Measure",
    "CDBG and ARPA by Measure",
    "Madison Capital 2024",
    "Madison Capital & EECBG 2025",
];

function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function resolveCrossStreetHeader(headers) {
    for (const header of headers) {
        const lower = String(header).toLowerCase().trim();
        if (lower.includes("cross street")) return header;
        if (lower.includes("cross") && lower.includes("street")) return header;
    }
    return null;
}

function collectStreetsFromWorkbook(wb) {
    const streets = new Set();
    for (const sheetName of TARGET_SHEETS) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json(sheet, {
            defval: "",
            raw: true,
        });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]);
        const crossH = resolveCrossStreetHeader(headers);
        if (!crossH) continue;
        let current = "";
        for (const row of rows) {
            const cell = normalizeText(row[crossH]);
            if (cell) current = cell;
            if (current) streets.add(current);
        }
    }
    return [...streets].sort();
}

const xlsxPath = path.join(
    root,
    "public",
    "Efficiency Navigator Program - Data Support Group.xlsx"
);
if (!fs.existsSync(xlsxPath)) {
    console.error("Missing workbook:", xlsxPath);
    process.exit(1);
}

const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
const list = collectStreetsFromWorkbook(wb);
console.log("Cross streets to geocode:", list.length);

const out = {};
for (let i = 0; i < list.length; i++) {
    const street = list[i];
    process.stdout.write(`[${i + 1}/${list.length}] ${street} … `);
    try {
        const c = await geocodeCrossStreetIntersection(street);
        if (c) {
            out[street] = c;
            console.log("OK", c.lat.toFixed(5), c.lng.toFixed(5));
        } else {
            console.log("MISS");
        }
    } catch (e) {
        console.log("ERR", e.message);
    }
    await sleep(280);
}

const outDir = path.join(root, "public", "data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "cross_street_coords.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
    "Wrote",
    Object.keys(out).length,
    "/",
    list.length,
    "to",
    path.relative(root, outPath)
);
