import { promises as fs } from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { Estudiante } from "@/types";

const BRAND = "#c0392b";
const BRAND_DARK = "#7f0000";
const GRAY = "#6b7280";
const ROW_GRAY = "#f7f3f2";

export interface FilaEstudiantePdf {
  estudiante: Estudiante;
  clubNombre: string | null;
}

export interface GenerarPdfOpciones {
  titulo: string;
  subtitulo: string;
}

const MARGIN = 40;
const PAGE_WIDTH = 612; // Letter
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ROW_HEIGHT = 22;
const HEADER_ROW_HEIGHT = 24;

const COLUMNS = [
  { key: "n", label: "#", width: 28 },
  { key: "nombre", label: "Estudiante", width: 170 },
  { key: "curso", label: "Curso", width: 90 },
  { key: "matricula", label: "Matrícula", width: 100 },
  { key: "club", label: "Club actual", width: CONTENT_WIDTH - (28 + 170 + 90 + 100) },
] as const;

function colX(index: number) {
  let x = MARGIN;
  for (let i = 0; i < index; i++) x += COLUMNS[i].width;
  return x;
}

async function cargarLogo(): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(process.cwd(), "public", "branding", "logo-report.png"));
  } catch {
    return null;
  }
}

function dibujarEncabezadoPagina(doc: PDFKit.PDFDocument, logo: Buffer | null, titulo: string, subtitulo: string) {
  const top = MARGIN;
  if (logo) {
    doc.image(logo, MARGIN, top, { width: 90 });
  }
  doc
    .fillColor(BRAND_DARK)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(titulo, MARGIN + 105, top, { width: CONTENT_WIDTH - 105 });
  doc
    .fillColor(GRAY)
    .font("Helvetica")
    .fontSize(9)
    .text(subtitulo, MARGIN + 105, top + 20, { width: CONTENT_WIDTH - 105 });
  doc
    .fillColor(GRAY)
    .fontSize(8)
    .text(
      `Generado el ${new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })}`,
      MARGIN + 105,
      top + 34,
      { width: CONTENT_WIDTH - 105 },
    );

  const headerBottom = top + 52;
  doc
    .moveTo(MARGIN, headerBottom)
    .lineTo(MARGIN + CONTENT_WIDTH, headerBottom)
    .strokeColor(BRAND)
    .lineWidth(1.5)
    .stroke();

  return headerBottom + 14;
}

function dibujarEncabezadoTabla(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(MARGIN, y, CONTENT_WIDTH, HEADER_ROW_HEIGHT).fill(BRAND);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  COLUMNS.forEach((col, i) => {
    doc.text(col.label, colX(i) + 6, y + 7, { width: col.width - 10 });
  });
  return y + HEADER_ROW_HEIGHT;
}

function dibujarPiePagina(doc: PDFKit.PDFDocument, pagina: number, totalPaginas: number) {
  // Escribir tan cerca del borde inferior dispara la paginación automática de
  // pdfkit (cree que el texto no cabe y agrega una página en blanco). Se anula
  // el margen inferior solo mientras se dibuja el pie, y se restaura después.
  const bottomOriginal = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(GRAY)
    .text(`Instituto Técnico Salesiano — Área de Pastoral · Página ${pagina} de ${totalPaginas}`, MARGIN, PAGE_HEIGHT - 26, {
      width: CONTENT_WIDTH,
      align: "center",
      lineBreak: false,
    });
  doc.page.margins.bottom = bottomOriginal;
}

export async function generarPdfEstudiantes(filas: FilaEstudiantePdf[], opciones: GenerarPdfOpciones): Promise<Buffer> {
  const logo = await cargarLogo();

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: MARGIN, bottom: 18, left: MARGIN, right: MARGIN },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  let y = dibujarEncabezadoPagina(doc, logo, opciones.titulo, opciones.subtitulo);
  y = dibujarEncabezadoTabla(doc, y);

  filas.forEach((fila, i) => {
    if (y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN - 20) {
      doc.addPage();
      y = dibujarEncabezadoPagina(doc, logo, opciones.titulo, opciones.subtitulo);
      y = dibujarEncabezadoTabla(doc, y);
    }

    if (i % 2 === 0) {
      doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill(ROW_GRAY);
    }

    const valores = [
      String(i + 1),
      `${fila.estudiante.nombre} ${fila.estudiante.apellido}`,
      fila.estudiante.curso,
      fila.estudiante.matricula,
      fila.clubNombre ?? "Sin club",
    ];

    doc.font("Helvetica").fontSize(9);
    valores.forEach((valor, colIdx) => {
      doc
        .fillColor(colIdx === 4 && !fila.clubNombre ? BRAND : "#1f2937")
        .text(valor, colX(colIdx) + 6, y + 6, { width: COLUMNS[colIdx].width - 10, ellipsis: true });
    });

    doc
      .moveTo(MARGIN, y + ROW_HEIGHT)
      .lineTo(MARGIN + CONTENT_WIDTH, y + ROW_HEIGHT)
      .strokeColor("#e5e7eb")
      .lineWidth(0.5)
      .stroke();

    y += ROW_HEIGHT;
  });

  if (filas.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(GRAY).text("No hay estudiantes que coincidan con este filtro.", MARGIN, y + 10);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    dibujarPiePagina(doc, i + 1, range.count);
  }

  doc.end();
  return done;
}
